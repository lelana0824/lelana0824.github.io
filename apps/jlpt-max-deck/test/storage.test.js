import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DECK_META_KEY,
  loadDeckMeta,
  persistDeck,
  readPersistedDeck,
  removePersistedDeck,
} from '../src/storage.js';

function testStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function testEnvironment() {
  let storedSize = 0;
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
  const writable = {
    write: async (value) => { storedSize += value.byteLength; },
    close: async () => {},
    abort: async () => {},
  };
  const handle = {
    createWritable: async () => writable,
    getFile: async () => ({ name: 'jlpt-max-deck.apkg', size: storedSize }),
  };
  const root = {
    getFileHandle: async () => handle,
    removeEntry: async () => { storedSize = 0; },
  };
  const navigatorObject = {
    storage: {
      estimate: async () => ({ quota: 10_000, usage: 0 }),
      persist: async () => true,
      getDirectory: async () => root,
    },
  };
  const file = {
    name: 'JLPT-MAX-Deck-2.1.0.apkg',
    size: 5,
    stream: () => {
      let index = 0;
      return {
        getReader: () => ({
          read: async () => index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true },
          releaseLock: () => {},
        }),
      };
    },
  };
  return { file, navigatorObject };
}

test('APKG는 저장 완료 후에만 다음 탭에서 복원된다', async () => {
  const storage = testStorage();
  const { file, navigatorObject } = testEnvironment();
  const progress = [];

  assert.equal(await readPersistedDeck({ navigatorObject, storage }), null);
  await persistDeck(file, (ratio) => progress.push(ratio), { navigatorObject, storage });

  const meta = loadDeckMeta(storage);
  assert.equal(meta.name, file.name);
  assert.equal(meta.size, file.size);
  assert.equal(typeof meta.savedAt, 'number');
  assert.equal(meta.persistent, true);
  assert.equal((await readPersistedDeck({ navigatorObject, storage })).size, file.size);
  assert.equal(progress.at(-1), 1);

  storage.setItem(DECK_META_KEY, JSON.stringify({ ...meta, size: file.size + 1 }));
  await assert.rejects(
    () => readPersistedDeck({ navigatorObject, storage }),
    /크기가 저장 완료 정보와 다릅니다/,
  );
  assert.notEqual(storage.getItem(DECK_META_KEY), null);
  storage.setItem(DECK_META_KEY, JSON.stringify(meta));

  await removePersistedDeck({ navigatorObject, storage });
  assert.equal(storage.getItem(DECK_META_KEY), null);
  assert.equal(await readPersistedDeck({ navigatorObject, storage }), null);
});
