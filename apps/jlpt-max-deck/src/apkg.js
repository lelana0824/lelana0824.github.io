import { inflateSync } from 'fflate';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 131_072;

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findSignatureBackwards(bytes, signature) {
  const view = dataView(bytes);
  for (let offset = bytes.length - 4; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

export async function parseZipIndex(file) {
  if (!file || typeof file.slice !== 'function' || file.size < 22) {
    throw new Error('올바른 APKG 파일이 아닙니다.');
  }

  const tailStart = Math.max(0, file.size - MAX_EOCD_SEARCH);
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  const eocdOffset = findSignatureBackwards(tail, EOCD_SIGNATURE);
  if (eocdOffset < 0) throw new Error('APKG의 ZIP 색인을 찾지 못했습니다.');

  const eocd = dataView(tail);
  const entryCount = eocd.getUint16(eocdOffset + 10, true);
  const centralSize = eocd.getUint32(eocdOffset + 12, true);
  const centralOffset = eocd.getUint32(eocdOffset + 16, true);
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 APKG는 아직 지원하지 않습니다.');
  }
  if (centralOffset + centralSize > file.size) {
    throw new Error('APKG ZIP 색인의 범위가 올바르지 않습니다.');
  }

  const central = new Uint8Array(
    await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer(),
  );
  const view = dataView(central);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > central.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error('APKG ZIP 색인이 손상되었습니다.');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > central.length) throw new Error('APKG ZIP 항목이 손상되었습니다.');
    const name = decoder.decode(central.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, {
      name,
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset = end;
  }

  return entries;
}

export async function readZipEntry(file, entry) {
  if (!entry) throw new Error('APKG에서 필요한 파일을 찾지 못했습니다.');
  const header = new Uint8Array(
    await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer(),
  );
  const view = dataView(header);
  if (header.length !== 30 || view.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new Error(`APKG 항목 ${entry.name}의 헤더가 손상되었습니다.`);
  }
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(
    await file.slice(start, start + entry.compressedSize).arrayBuffer(),
  );

  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateSync(compressed);
  throw new Error(`지원하지 않는 ZIP 압축 방식입니다: ${entry.method}`);
}

export async function createMediaIndex(file, entries) {
  const mediaEntry = entries.get('media');
  if (!mediaEntry) throw new Error('APKG 미디어 색인을 찾지 못했습니다.');
  const bytes = await readZipEntry(file, mediaEntry);
  const mapping = JSON.parse(new TextDecoder().decode(bytes));
  const byFilename = new Map();
  for (const [archiveName, filename] of Object.entries(mapping)) {
    const entry = entries.get(archiveName);
    if (entry && typeof filename === 'string') byFilename.set(filename, entry);
  }
  return byFilename;
}

export function collectionEntry(entries) {
  return entries.get('collection.anki21') || entries.get('collection.anki2');
}

export function audioFilename(html = '') {
  const match = html.match(/<audio\b[^>]*\bsrc=["']([^"']+)["']/i);
  return match?.[1] || '';
}

export function contentType(filename) {
  const extension = filename.split('.').pop()?.toLowerCase();
  return {
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    wav: 'audio/wav',
    webp: 'image/webp',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  }[extension] || 'application/octet-stream';
}

export class DeckWorkerClient {
  constructor() {
    this.worker = new Worker(new URL('./deck-worker.js', import.meta.url), { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();
    this.worker.addEventListener('message', ({ data }) => {
      const operation = this.pending.get(data.id);
      if (!operation) return;
      this.pending.delete(data.id);
      if (data.error) operation.reject(new Error(data.error));
      else operation.resolve(data.result);
    });
    this.worker.addEventListener('error', (event) => {
      for (const operation of this.pending.values()) {
        operation.reject(new Error(event.message || '덱 처리 중 오류가 발생했습니다.'));
      }
      this.pending.clear();
    });
  }

  request(type, payload = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...payload });
    });
  }

  load(file, entry) {
    return this.request('load', { file, entry });
  }

  getCard(cardId) {
    return this.request('get-card', { cardId });
  }

  close() {
    this.worker.terminate();
  }
}
