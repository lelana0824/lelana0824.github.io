export const STATE_KEY = 'jlpt-max-webapp:state:v1';
export const DECK_META_KEY = 'jlpt-max-webapp:deck:v1';
const OPFS_FILENAME = 'jlpt-max-deck.apkg';

export const DEFAULT_STATE = Object.freeze({
  version: 1,
  target: 'N3',
  dailyGoal: 20,
  mode: 'vocabulary',
  progress: {},
  history: {},
  newHistory: {},
});

function cleanState(value) {
  const target = ['N5', 'N4', 'N3', 'N2', 'N1'].includes(value?.target)
    ? value.target
    : DEFAULT_STATE.target;
  const dailyGoal = [10, 20, 30, 50].includes(Number(value?.dailyGoal))
    ? Number(value.dailyGoal)
    : DEFAULT_STATE.dailyGoal;
  const mode = ['vocabulary', 'grammar', 'practice'].includes(value?.mode)
    ? value.mode
    : DEFAULT_STATE.mode;
  return {
    version: 1,
    target,
    dailyGoal,
    mode,
    progress: value?.progress && typeof value.progress === 'object' ? value.progress : {},
    history: value?.history && typeof value.history === 'object' ? value.history : {},
    newHistory: value?.newHistory && typeof value.newHistory === 'object' ? value.newHistory : {},
  };
}

export function loadState() {
  try {
    return cleanState(JSON.parse(localStorage.getItem(STATE_KEY)));
  } catch {
    return { ...DEFAULT_STATE, progress: {}, history: {} };
  }
}

export function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(cleanState(state)));
}

export function loadDeckMeta(storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage?.getItem(DECK_META_KEY));
    return typeof value?.name === 'string' && Number(value?.size) > 0 ? value : null;
  } catch {
    return null;
  }
}

function saveDeckMeta(meta, storage = globalThis.localStorage) {
  storage?.setItem(DECK_META_KEY, JSON.stringify(meta));
}

export async function readPersistedDeck({
  navigatorObject = globalThis.navigator,
  storage = globalThis.localStorage,
} = {}) {
  const meta = loadDeckMeta(storage);
  if (!meta || !navigatorObject?.storage?.getDirectory) return null;
  const root = await navigatorObject.storage.getDirectory();
  const handle = await root.getFileHandle(OPFS_FILENAME);
  const file = await handle.getFile();
  if (file.size !== meta.size) {
    throw new Error('기기에 저장된 APKG의 크기가 저장 완료 정보와 다릅니다.');
  }
  return file;
}

function aborted() {
  const error = new Error('덱 저장을 취소했습니다.');
  error.name = 'AbortError';
  return error;
}

export async function persistDeck(file, onProgress = () => {}, {
  navigatorObject = globalThis.navigator,
  storage = globalThis.localStorage,
  signal,
} = {}) {
  if (!navigatorObject?.storage?.getDirectory || !file?.stream) {
    throw new Error('이 브라우저에서는 APKG 자동 저장을 지원하지 않습니다.');
  }
  const estimate = await navigatorObject.storage.estimate?.();
  const available = estimate?.quota && estimate?.usage != null
    ? estimate.quota - estimate.usage
    : Infinity;
  if (available < file.size * 1.05) {
    throw new Error('기기 저장 공간이 부족해 APKG를 보관하지 못했습니다.');
  }

  let persistent = false;
  try {
    persistent = Boolean(await navigatorObject.storage.persist?.());
  } catch {
    // 영구 저장 요청이 거절되거나 실패해도 일반 기기 저장은 계속합니다.
  }

  storage?.removeItem(DECK_META_KEY);
  let root = null;
  let writable = null;
  let reader = null;
  let written = 0;

  try {
    root = await navigatorObject.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_FILENAME, { create: true });
    writable = await handle.createWritable();
    reader = file.stream().getReader();
    while (true) {
      if (signal?.aborted) throw aborted();
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      written += value.byteLength;
      onProgress(Math.min(1, written / file.size));
    }
    if (signal?.aborted) throw aborted();
    await writable.close();
    const savedFile = await handle.getFile();
    if (savedFile.size !== file.size) throw new Error('저장된 APKG의 크기가 원본과 다릅니다.');
    const meta = {
      name: file.name,
      size: file.size,
      savedAt: Date.now(),
      persistent,
    };
    saveDeckMeta(meta, storage);
    onProgress(1);
    return meta;
  } catch (error) {
    storage?.removeItem(DECK_META_KEY);
    try {
      await writable?.abort?.(error);
    } catch {
      // 중단 처리 자체가 실패해도 원래 저장 오류를 유지합니다.
    }
    try {
      await root?.removeEntry(OPFS_FILENAME);
    } catch {
      // 불완전 파일이 없으면 정리할 항목도 없습니다.
    }
    throw error;
  } finally {
    reader?.releaseLock?.();
  }
}

export async function removePersistedDeck({
  navigatorObject = globalThis.navigator,
  storage = globalThis.localStorage,
} = {}) {
  storage?.removeItem(DECK_META_KEY);
  if (!navigatorObject?.storage?.getDirectory) return;
  try {
    const root = await navigatorObject.storage.getDirectory();
    await root.removeEntry(OPFS_FILENAME);
  } catch {
    // 저장된 파일이 없으면 이미 제거된 상태입니다.
  }
}

export function exportProgress(state) {
  return JSON.stringify({
    app: 'JLPT MAX 모바일 학습',
    exportedAt: new Date().toISOString(),
    state: cleanState(state),
  }, null, 2);
}

export function importProgress(payload) {
  const parsed = JSON.parse(payload);
  if (parsed?.app !== 'JLPT MAX 모바일 학습' || !parsed?.state) {
    throw new Error('JLPT MAX 학습 기록 파일이 아닙니다.');
  }
  return cleanState(parsed.state);
}
