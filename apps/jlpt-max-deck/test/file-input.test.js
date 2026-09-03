import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('APKG 파일 입력은 화면 교체 대상 밖에서 계속 유지된다', async () => {
  const root = new URL('../', import.meta.url);
  const [html, main] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8'),
  ]);

  assert.ok(html.indexOf('id="deck-file"') < html.indexOf('<div id="app">'));
  assert.equal((html.match(/id="deck-file"/g) || []).length, 1);
  assert.equal(main.includes('<input id="deck-file"'), false);
  assert.equal(main.includes("document.addEventListener('change'"), true);
  assert.equal(main.includes('readPersistedDeck'), false);
  assert.equal(main.includes('persistDeck'), false);
  assert.match(main, /function boot\(\) \{\s+renderWelcome\(\);/);
});
