import test from 'node:test';
import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { strFromU8, strToU8, zipSync } from 'fflate';

import { parseZipIndex, readZipEntry, readZipEntryPayload } from '../src/apkg.js';

test('ZIP 색인을 읽고 압축된 APKG 항목을 부분 추출한다', async () => {
  const archive = zipSync({
    'collection.anki21': strToU8('SQLite format 3\0test'),
    media: strToU8('{"0":"word.mp3"}'),
    0: strToU8('audio'),
  });
  const file = new Blob([archive]);
  const entries = await parseZipIndex(file);
  assert.equal(entries.size, 3);
  const collection = entries.get('collection.anki21');
  const collectionPayload = await readZipEntryPayload(file, collection);
  assert.equal(collectionPayload.byteLength, collection.compressedSize);
  const media = await readZipEntry(file, entries.get('media'));
  assert.equal(strFromU8(media), '{"0":"word.mp3"}');
});

test('ZIP이 아니면 명확한 오류를 낸다', async () => {
  await assert.rejects(
    () => parseZipIndex(new Blob([strToU8('not an apkg')], { type: 'application/octet-stream' })),
    /APKG|ZIP 색인/,
  );
});

test('압축하지 않은 MP3 항목도 원본 바이트로 추출한다', async () => {
  const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0xc4, 0x00]);
  const archive = zipSync({
    media: strToU8('{"0":"word.mp3"}'),
    0: [mp3, { level: 0 }],
  });
  const file = new Blob([archive]);
  const entries = await parseZipIndex(file);
  const extracted = await readZipEntry(file, entries.get('0'));
  assert.deepEqual([...extracted], [...mp3]);
});
