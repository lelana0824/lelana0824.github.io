import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQueue,
  cardMatchesMode,
  scheduleReview,
  shuffleCards,
  streakFromHistory,
} from '../src/scheduler.js';

const cards = [
  ['v5', 'n1', 'm1', 0, 'JLPT MAX덱::어휘::N5', 'する', ''],
  ['v4', 'n2', 'm1', 0, 'JLPT MAX덱::어휘::N4', '会議', ''],
  ['v1', 'n5', 'm1', 0, 'JLPT MAX덱::어휘::N1', '乖離', ''],
  ['audio5', 'n1', 'm1', 2, 'JLPT MAX덱::음성::N5', 'する', ''],
  ['g5', 'n3', 'm2', 0, 'JLPT MAX덱::문법::N5', 'あの', ''],
  ['p3', 'n4', 'm3', 0, 'JLPT MAX덱::종합 실전::어휘::N3::한자 읽기', '済む', ''],
];

test('학습 코스는 대상 덱과 카드 유형만 고른다', () => {
  assert.equal(cardMatchesMode(cards[0], 'vocabulary', 'N3'), true);
  assert.equal(cardMatchesMode(cards[3], 'vocabulary', 'N3'), false);
  assert.equal(cardMatchesMode(cards[4], 'grammar', 'N3'), true);
  assert.equal(cardMatchesMode(cards[5], 'practice', 'N3'), true);
});

test('선택한 급수의 새 어휘만 하루 분량으로 만든다', () => {
  const queue = buildQueue(cards, {
    target: 'N4',
    dailyGoal: 20,
    mode: 'vocabulary',
    progress: {},
    newHistory: {},
  }, Date.UTC(2026, 8, 3));
  assert.deepEqual(queue.cards.map((card) => card[0]), ['v4']);
  assert.equal(queue.activeLevel, 'N4');
});

test('N1을 선택하면 N5 카드가 학습 목록에 섞이지 않는다', () => {
  const queue = buildQueue(cards, {
    target: 'N1',
    dailyGoal: 20,
    mode: 'vocabulary',
    progress: { v5: [0, 1, 250, 1, 0] },
    newHistory: {},
  }, Date.UTC(2026, 8, 3));
  assert.deepEqual(queue.cards.map((card) => card[0]), ['v1']);
  assert.deepEqual(queue.due, []);
  assert.equal(queue.activeLevel, 'N1');
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

test('학습을 시작할 때마다 카드 순서를 새로 섞고 원본은 유지한다', () => {
  const source = cards.slice(0, 4);
  const first = shuffleCards(source, () => 0);
  const second = shuffleCards(source, () => 0.999);

  assert.notDeepEqual(first.map((card) => card[0]), second.map((card) => card[0]));
  assert.deepEqual(source.map((card) => card[0]), ['v5', 'v4', 'v1', 'audio5']);
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
