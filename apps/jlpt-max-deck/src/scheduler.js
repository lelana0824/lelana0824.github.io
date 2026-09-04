export const LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
export const RATINGS = ['again', 'hard', 'good', 'easy'];

const DAY_SECONDS = 86_400;

export function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dailyNewHistoryKey(state, date = new Date()) {
  return `${dayKey(date)}:${state.target}:${state.mode}`;
}

export function levelFromDeck(deck) {
  return deck.match(/::(N[1-5])(?:$|::)/)?.[1] || '';
}

export function cardMatchesMode(card, mode, target) {
  const deck = card[4] || '';
  const order = Number(card[3]);
  const level = levelFromDeck(deck);
  if (!level) return false;
  if (mode === 'vocabulary') {
    return order === 0 && deck.includes('::어휘::') && !deck.includes('::종합 실전::');
  }
  if (mode === 'grammar') {
    return order === 0 && deck.includes('::문법::') && !deck.includes('::종합 실전::');
  }
  return deck.includes(`::종합 실전::`) && deck.includes(`::${target}`);
}

export function allowedLevels(target) {
  return LEVELS.includes(target) ? [target] : [];
}

export function buildQueue(index, state, now = Date.now()) {
  const nowSeconds = Math.floor(now / 1000);
  const levels = allowedLevels(state.target);
  const eligible = index.filter((card) => (
    levels.includes(levelFromDeck(card[4])) &&
    cardMatchesMode(card, state.mode, state.target)
  ));
  const due = eligible
    .filter((card) => state.progress[card[0]] && state.progress[card[0]][0] <= nowSeconds)
    .sort((left, right) => state.progress[left[0]][0] - state.progress[right[0]][0]);
  const fresh = eligible
    .filter((card) => !state.progress[card[0]])
    .sort((left, right) => Number(left[7] || 0) - Number(right[7] || 0));
  const firstFreshLevel = levels.find((level) => fresh.some((card) => levelFromDeck(card[4]) === level));
  const remainingNew = Math.max(0, state.dailyGoal - Number(
    state.newHistory?.[dailyNewHistoryKey(state, new Date(now))] || 0,
  ));
  const newCards = firstFreshLevel
    ? fresh.filter((card) => levelFromDeck(card[4]) === firstFreshLevel).slice(0, remainingNew)
    : [];
  return {
    due,
    fresh: newCards,
    cards: [...due, ...newCards],
    eligibleCount: eligible.length,
    learnedCount: eligible.length - fresh.length,
    activeLevel: firstFreshLevel || levels.at(-1),
  };
}

export function shuffleCards(cards, random = Math.random) {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function scheduleReview(previous, rating, now = Date.now()) {
  if (!RATINGS.includes(rating)) throw new Error('알 수 없는 채점입니다.');
  const nowSeconds = Math.floor(now / 1000);
  const interval = Number(previous?.[1] || 0);
  const ease = Number(previous?.[2] || 250);
  const reps = Number(previous?.[3] || 0) + 1;
  const lapses = Number(previous?.[4] || 0) + (rating === 'again' ? 1 : 0);
  let nextInterval;
  let nextEase = ease;
  let due;

  if (rating === 'again') {
    nextInterval = 0;
    nextEase = Math.max(130, ease - 20);
    due = nowSeconds + 10 * 60;
  } else if (rating === 'hard') {
    nextInterval = interval ? Math.max(1, Math.round(interval * 1.2)) : 1;
    nextEase = Math.max(130, ease - 10);
    due = nowSeconds + nextInterval * DAY_SECONDS;
  } else if (rating === 'good') {
    nextInterval = interval ? Math.max(2, Math.round(interval * (ease / 100))) : 2;
    due = nowSeconds + nextInterval * DAY_SECONDS;
  } else {
    nextInterval = interval ? Math.max(4, Math.round(interval * (ease / 100) * 1.45)) : 4;
    nextEase = Math.min(320, ease + 15);
    due = nowSeconds + nextInterval * DAY_SECONDS;
  }
  return [due, nextInterval, nextEase, reps, lapses];
}

export function reviewLabel(record, rating) {
  const scheduled = scheduleReview(record, rating, Date.now());
  const days = scheduled[1];
  if (rating === 'again') return '10분';
  return `${days}일`;
}

export function streakFromHistory(history, today = new Date()) {
  let streak = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!history[dayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  while (history[dayKey(cursor)] > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
