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

export function loadDeckMeta() {
  try {
    return JSON.parse(localStorage.getItem(DECK_META_KEY));
  } catch {
    return null;
  }
}

export function saveDeckMeta(meta) {
  localStorage.setItem(DECK_META_KEY, JSON.stringify(meta));
}

export async function opfsAvailable() {
  return Boolean(navigator.storage?.getDirectory);
}

export async function readPersistedDeck() {
  if (!(await opfsAvailable())) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(OPFS_FILENAME);
    const file = await handle.getFile();
    return file.size ? file : null;
  } catch {
    return null;
  }
}

export async function persistDeck(file, onProgress = () => {}) {
  if (!(await opfsAvailable())) return false;
  const estimate = await navigator.storage.estimate?.();
  const available = estimate?.quota && estimate?.usage != null
    ? estimate.quota - estimate.usage
    : Infinity;
  if (available < file.size * 1.05) {
    throw new Error('기기 저장 공간이 부족해 APKG를 보관하지 못했습니다.');
  }
  await navigator.storage.persist?.();
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(OPFS_FILENAME, { create: true });
  const writable = await handle.createWritable();
  const reader = file.stream().getReader();
  let written = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      written += value.byteLength;
      onProgress(Math.min(1, written / file.size));
    }
    await writable.close();
  } catch (error) {
    await writable.abort(error);
    throw error;
  }
  saveDeckMeta({ name: file.name, size: file.size, savedAt: Date.now() });
  onProgress(1);
  return true;
}

export async function removePersistedDeck() {
  localStorage.removeItem(DECK_META_KEY);
  if (!(await opfsAvailable())) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_FILENAME);
  } catch {
    // Missing files are already removed.
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
