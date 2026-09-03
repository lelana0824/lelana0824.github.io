export const STATE_KEY = 'jlpt-max-webapp:state:v1';
const LEGACY_DECK_META_KEY = 'jlpt-max-webapp:deck:v1';
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

export async function clearLegacyPersistedDeck() {
  localStorage.removeItem(LEGACY_DECK_META_KEY);
  if (!navigator.storage?.getDirectory) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_FILENAME);
  } catch {
    // 이전 버전에서 저장한 파일이 없으면 정리할 항목도 없습니다.
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
