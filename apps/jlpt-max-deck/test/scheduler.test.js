import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQueue,
  cardMatchesMode,
  scheduleReview,
  streakFromHistory,
} from '../src/scheduler.js';

const cards = [
  ['v5', 'n1', 'm1', 0, 'JLPT MAX덱::어휘::N5', 'する', ''],
  ['v4', 'n2', 'm1', 0, 'JLPT MAX덱::어휘::N4', '会議', ''],
  ['audio5', 'n1', 'm1', 2, 'JLPT MAX덱::음성::N5', 'する', ''],
  ['g5', 'n3', 'm2', 0, 'JLPT MAX덱::문법::N5', 'あの', ''],
  ['p3', 'n4', 'm3', 0, 'JLPT MAX덱::종합 실전::어휘::N3::한자 읽기', '済む', ''],
];

test('학습 코스는 대상 덱과 카드 유형만 고른다', () => {
  assert.equal(cardMatchesMode(cards[0], 'vocabulary', 'N3'), true);
  assert.equal(cardMatchesMode(cards[2], 'vocabulary', 'N3'), false);
  assert.equal(cardMatchesMode(cards[3], 'grammar', 'N3'), true);
  assert.equal(cardMatchesMode(cards[4], 'practice', 'N3'), true);
});

test('새 어휘는 N5부터 선택한 하루 분량만 만든다', () => {
  const queue = buildQueue(cards, {
    target: 'N4',
    dailyGoal: 20,
    mode: 'vocabulary',
    progress: {},
    newHistory: {},
  }, Date.UTC(2026, 8, 3));
  assert.deepEqual(queue.cards.map((card) => card[0]), ['v5']);
  assert.equal(queue.activeLevel, 'N5');
});

test('이미 공부한 새 카드를 하루 목표에서 차감한다', () => {
  const queue = buildQueue(cards, {
    target: 'N4',
    dailyGoal: 1,
    mode: 'vocabulary',
    progress: {},
    newHistory: { '2026-09-03': 1 },
  }, new Date(2026, 8, 3, 12).getTime());
  assert.equal(queue.fresh.length, 0);
});

test('Again은 10분, Good은 이틀 뒤 복습으로 잡는다', () => {
  const now = Date.UTC(2026, 8, 3);
  const again = scheduleReview(null, 'again', now);
  const good = scheduleReview(null, 'good', now);
  assert.equal(again[0], Math.floor(now / 1000) + 600);
  assert.equal(good[1], 2);
  assert.equal(good[3], 1);
});

test('연속 학습일은 오늘 또는 어제부터 거슬러 계산한다', () => {
  const history = { '2026-09-01': 3, '2026-09-02': 2, '2026-09-03': 1 };
  assert.equal(streakFromHistory(history, new Date(2026, 8, 3)), 3);
  assert.equal(streakFromHistory(history, new Date(2026, 8, 4)), 3);
});
