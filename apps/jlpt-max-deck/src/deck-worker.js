import { inflateSync } from 'fflate';
import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let database;
let fieldsByModel = new Map();
let modelNames = new Map();

async function readZipEntry(file, entry) {
  const header = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  if (header.byteLength !== 30 || header.getUint32(0, true) !== 0x04034b50) {
    throw new Error('APKG 컬렉션 헤더가 손상되었습니다.');
  }
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const compressed = new Uint8Array(
    await file.slice(start, start + entry.compressedSize).arrayBuffer(),
  );
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateSync(compressed);
  throw new Error(`지원하지 않는 컬렉션 압축 방식입니다: ${entry.method}`);
}

function patchUnicase(bytes) {
  const needle = [117, 110, 105, 99, 97, 115, 101]; // unicase
  const replacement = [66, 73, 78, 65, 82, 89, 32]; // BINARY + space
  for (let offset = 0; offset <= bytes.length - needle.length; offset += 1) {
    let match = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (bytes[offset + index] !== needle[index]) {
        match = false;
        break;
      }
    }
    if (match) bytes.set(replacement, offset);
  }
  return bytes;
}

function rows(sql, params = []) {
  const statement = database.prepare(sql);
  statement.bind(params);
  const output = [];
  while (statement.step()) output.push(statement.get());
  statement.free();
  return output;
}

function buildSchemaMaps() {
  fieldsByModel = new Map();
  for (const [modelId, order, name] of rows(
    'select cast(ntid as text),ord,name from fields order by ntid,ord',
  )) {
    if (!fieldsByModel.has(modelId)) fieldsByModel.set(modelId, []);
    fieldsByModel.get(modelId)[Number(order)] = name;
  }
  modelNames = new Map(
    rows('select cast(id as text),name from notetypes').map(([id, name]) => [id, name]),
  );
}

function loadIndex() {
  return rows(`
    select
      cast(c.id as text),
      cast(n.id as text),
      cast(n.mid as text),
      c.ord,
      replace(d.name, char(31), '::'),
      cast(n.sfld as text),
      n.tags,
      c.due
    from cards c
    join notes n on n.id = c.nid
    join decks d on d.id = c.did
  `);
}

async function loadDeck(file, entry) {
  const collection = patchUnicase(await readZipEntry(file, entry));
  const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl });
  database?.close();
  database = new SQL.Database(collection);
  buildSchemaMaps();
  const index = loadIndex();
  return {
    index,
    counts: {
      cards: index.length,
      notes: Number(rows('select count(*) from notes')[0][0]),
    },
  };
}

function getCard(cardId) {
  if (!database) throw new Error('먼저 덱을 불러와 주세요.');
  const result = rows(`
    select
      cast(c.id as text),
      cast(n.id as text),
      cast(n.mid as text),
      c.ord,
      replace(d.name, char(31), '::'),
      n.tags,
      n.flds
    from cards c
    join notes n on n.id = c.nid
    join decks d on d.id = c.did
    where cast(c.id as text) = ?
    limit 1
  `, [String(cardId)])[0];
  if (!result) throw new Error('카드를 찾지 못했습니다.');
  const [id, noteId, modelId, order, deck, tags, fieldPayload] = result;
  const values = fieldPayload.split('\x1f');
  const fieldNames = fieldsByModel.get(modelId) || [];
  const fields = {};
  fieldNames.forEach((name, index) => {
    const value = values[index];
    if (value && value !== '\u2063') fields[name] = value;
  });
  return {
    id,
    noteId,
    modelId,
    modelName: modelNames.get(modelId) || '',
    order: Number(order),
    deck,
    tags,
    fields,
  };
}

self.addEventListener('message', async ({ data }) => {
  try {
    let result;
    if (data.type === 'load') result = await loadDeck(data.file, data.entry);
    else if (data.type === 'get-card') result = getCard(data.cardId);
    else throw new Error('알 수 없는 덱 작업입니다.');
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
