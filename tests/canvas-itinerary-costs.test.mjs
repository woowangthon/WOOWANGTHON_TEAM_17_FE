import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasItineraryCostHeadline, canvasItineraryCosts } from '../src/features/workspace/canvasItineraryCosts.ts';
import { canvasItineraryDays, canvasItineraryReviewDays } from '../src/features/workspace/canvasItineraryModel.ts';

const day = { id: 'day-a', date: '2026-11-14' };
const dayB = { id: 'day-b', date: '2026-11-15' };
const place = (id, contentid, intent = 'route', dayId = day.id) => ({ id, kind: 'place', dayId, contentid, intent, position: { x: 0, y: 0 }, color: 'default' });
const graph = (nodes, edges = [], days = [day]) => ({ schemaVersion: 3, days, nodes, edges });
const detail = (contentid, priceLabel = null, feeText = null) => ({ contentid, title: `place-${contentid}`, address: null, adminCity: null, category: null, planningRole: null,
  coordinate: null, overviewText: null, menuText: null, openingHoursText: null, closedDaysText: null, feeText, priceLabel, bookingText: null, parkingText: null, tel: null, homepageUrl: null });

test('multiplies explicit per-person exact/range amounts and explicit visit totals only', () => {
  const document = graph([place('per-person', 1), place('range', 2), place('total', 3), place('total-range', 4)]);
  const days = canvasItineraryDays(document, [detail(1, '1인 약 10,000원'), detail(2, null, '1인 10,000~20,000원'), detail(3, '전체 입장료 30,000원'), detail(4, null, '전체 1회 40,000원~50,000원')]);
  const summary = canvasItineraryCosts(days, 3);
  assert.deepEqual([summary.minKrw, summary.maxKrw, summary.knownCount, summary.totalCount, summary.approximate], [130000, 170000, 4, 4, true]);
  assert.deepEqual(summary.rows.map(row => [row.basis, row.minKrw, row.maxKrw]), [
    ['per-person', 30000, 30000], ['per-person', 30000, 60000], ['per-visit-total', 30000, 30000], ['per-visit-total', 40000, 50000],
  ]);
  for (const text of ['1인 10,000 원 ~ 20,000원', '1인 10,000원 ~ 20,000 원', '1인 10,000 ~ 20,000 원']) {
    const spaced = canvasItineraryCosts(canvasItineraryDays(graph([place('spaced', 9)]), [detail(9, text)]), 3);
    assert.deepEqual([spaced.minKrw, spaced.maxKrw], [30000, 60000], text);
  }
  for (const text of ['1인 약 입장료 5,000원', '1인 약 요금 5,000원', '1인당 입장료 약 5,000원', '관람료: 1인 약 5,000원']) {
    const cost = canvasItineraryCosts(canvasItineraryDays(graph([place('approx', 1)]), [detail(1, text)]), 2);
    assert.deepEqual([cost.minKrw, cost.maxKrw, cost.approximate], [10000, 10000, true], text);
  }
});

test('accepts free labels as zero and deduplicates repeated semantic price labels', () => {
  const document = graph([place('free', 1), place('duplicate', 2), place('free2', 3), place('free3', 4), place('free4', 5), place('free5', 6)]);
  const days = canvasItineraryDays(document, [detail(1, '입장료: 무료'), detail(2, '1인 5,000원', '1인 약 5,000원'), detail(3, '입장료：무료'), detail(4, '요금 무료'), detail(5, '무료 입장'), detail(6, '이용료 없음')]);
  const summary = canvasItineraryCosts(days, 2);
  assert.deepEqual([summary.minKrw, summary.maxKrw, summary.knownCount, summary.totalCount], [10000, 10000, 6, 6]);
  assert.equal(summary.rows[0].basis, 'free');
  assert.equal(summary.rows[1].approximate, true);
  assert.equal(summary.rows[1].sourceText, '1인 5,000원');
  assert.equal(summary.rows[2].basis, 'free');
  assert.equal(summary.rows[3].basis, 'free');
  assert.equal(summary.rows[4].basis, 'free');
  assert.equal(summary.rows[5].basis, 'free');
  for (const text of ['시설이용료: 무료', '이용요금: 무료', '관람료: 무료', '입장료: 없음']) {
    const cost = canvasItineraryCosts(canvasItineraryDays(graph([place('free', 1)]), [detail(1, text)]), null);
    assert.equal(cost.rows[0].basis, 'free', text);
  }
});

test('parses explicit per-person rates and complete age tariff tables without assuming the group mix', () => {
  const texts = [
    '입장료: - 대인 18,000원 - 소인 14,000원',
    '입장료: - 성인 6,000원- 청소년, 군인 4,500원- 어린이 3,500원',
    '- 성인 5,000원- 중·고생 3,000원- 초등생 1,000원',
    '입장료: - 대인 12,000원 - 소인(12개월~7세) 6,000원',
    '성인 1,500원 · 초등학생 500원',
    '입장료: 1인당 5,000원',
    '1인당 이용료 2,500원',
  ];
  const nodes = texts.map((_, index) => place(`age${index}`, index + 1));
  const days = canvasItineraryDays(graph(nodes), texts.map((value, index) => detail(index + 1, value)));
  const summary = canvasItineraryCosts(days, 2);
  assert.deepEqual(summary.rows.map(row => [row.minKrw, row.maxKrw]), [
    [28000, 36000], [7000, 12000], [2000, 10000], [12000, 24000], [1000, 3000], [10000, 10000], [5000, 5000],
  ]);
  assert.ok(summary.rows.slice(0, 5).every(row => row.note === '등록된 연령별 요금 범위'));
  assert.deepEqual([summary.minKrw, summary.maxKrw, summary.knownCount, summary.totalCount], [65000, 100000, 7, 7]);

  const noPeople = canvasItineraryCosts(days, null);
  assert.ok(noPeople.rows.every(row => row.minKrw === null && row.maxKrw === null && /예정 인원/u.test(row.reason)));
});

test('keeps incomplete, conditional, parking and extra-fee age tables out of estimates', () => {
  const texts = [
    '성인 5,000원',
    '성인 5,000원- 청소년 3,000원 (단체 할인 별도)',
    '주차 2,000원- 성인 5,000원- 어린이 3,000원',
    '성인 5,000원- 어린이 3,000원- 체험료 별도',
    '성인 5,000원- 어린이 무료 (주말 제외)',
    '성인 코스 20,000원- 어린이 코스 10,000원',
    '성인 5,000원- 성인 3,000원',
    '성인, 청소년 5,000원- 청소년 3,000원',
    '대인 5,000원- 성인 3,000원',
    '청소년 3,000원- 군인 2,500원',
    '성인 5,000원- 소인(단체 할인) 3,000원',
    '시설이용료: 무료 (일부 체험 별도)',
    '없음',
  ];
  const rows = canvasItineraryCosts(canvasItineraryDays(graph(texts.map((_, index) => place(`bad${index}`, index + 1))),
    texts.map((value, index) => detail(index + 1, value))), 2).rows;
  assert.ok(rows.every(row => row.minKrw === null && row.maxKrw === null && row.basis === 'unknown'));
});

test('uses published zero and paid age tiers and preserves the unabridged source', () => {
  for (const [fee, min, max] of [
    ['어린이 무료 - 성인 5,000원', 0, 10000],
    ['입장료: - 대인 15,000원 - 소인 10,000원 ※ 자세한 사항은 전화 문의 요망', 20000, 30000],
    ['시설이용료: - 성인 70,000원 - 소인 52,000원 ※ 자세한 사항은 홈페이지 참조 또는 전화 문의', 104000, 140000],
  ]) {
    const [row] = canvasItineraryCosts(canvasItineraryDays(graph([place('rate', 1)]), [detail(1, fee)]), 2).rows;
    assert.deepEqual([row.minKrw, row.maxKrw, row.sourceText], [min, max, fee]);
  }
});

test('per-person amounts without saved expected people stay unknown with an actionable reason', () => {
  const days = canvasItineraryDays(graph([place('a', 1)]), [detail(1, null, '1인 입장료 5000원')]);
  const summary = canvasItineraryCosts(days, null);
  assert.equal(summary.minKrw, null);
  assert.equal(summary.maxKrw, null);
  assert.equal(summary.knownCount, 0);
  assert.equal(summary.rows[0].basis, 'unknown');
  assert.match(summary.rows[0].reason, /예정 인원/u);
});

test('rejects bare, conditional, mixed-currency, conflicting, malformed, negative, overflow, and lodging estimates', () => {
  const texts = ['10,000원', '주차 무료', '1인 5,000원 또는 10,000원', '1인 5,000원 / $4', '1인 10,00원', '1인 -5,000원', '1인 999999999999999999999999원', '1박 100,000원(기준 2명)', '1회 5,000원'];
  const nodes = texts.map((_, index) => place(`n${index}`, index + 1));
  const details = texts.map((value, index) => detail(index + 1, value));
  const rows = canvasItineraryCosts(canvasItineraryDays(graph(nodes), details), 2).rows;
  assert.equal(rows.every(row => row.minKrw === null && row.maxKrw === null && row.basis === 'unknown'), true);
  assert.match(rows[7].reason, /숙박일수와 객실 수/u);
  assert.match(rows[8].reason, /인원 기준/u);
  assert.ok(rows.every(row => row.sourceText));
});

test('conflicting fee fields are unknown while identical amounts do not count twice', () => {
  const days = canvasItineraryDays(graph([place('same', 1), place('conflict', 2)]), [
    detail(1, '전체 10,000원', '전체 10,000원'), detail(2, '전체 10,000원', '전체 20,000원'),
  ]);
  const summary = canvasItineraryCosts(days, null);
  assert.equal(summary.knownCount, 1);
  assert.equal(summary.minKrw, 10000);
  assert.equal(summary.maxKrw, 10000);
  assert.match(summary.rows[1].reason, /서로 다른 요금/u);
});

test('compares each audience rate across the two fee fields even when both ranges have the same endpoints', () => {
  const first = '성인 5,000원 - 어린이 3,000원';
  const days = canvasItineraryDays(graph([place('same', 1), place('conflict', 2)]), [
    detail(1, first, '소인 3,000원 - 대인 5,000원'),
    detail(2, first, '성인 3,000원 - 어린이 5,000원'),
  ]);
  const { rows } = canvasItineraryCosts(days, 2);
  assert.deepEqual([rows[0].minKrw, rows[0].maxKrw, rows[0].reason], [6000, 10000, null]);
  assert.deepEqual([rows[1].minKrw, rows[1].maxKrw], [null, null]);
  assert.match(rows[1].reason, /서로 다른 요금/u);
});

test('counts repeated visits in the supplied day scope, excludes unvisited candidates/comments, and preserves zero vs unknown', () => {
  const document = graph([place('visit1', 1), place('visit2', 1, 'route', dayB.id), place('candidate', 2, 'candidate'), { id: 'comment', kind: 'comment', dayId: day.id }], [], [day, dayB]);
  const days = canvasItineraryDays(document, [detail(1, null, '무료')]);
  const all = canvasItineraryCosts(days, null);
  assert.deepEqual([all.minKrw, all.maxKrw, all.knownCount, all.totalCount], [0, 0, 2, 2]);
  assert.deepEqual(all.rows.map(row => [row.nodeId, row.dayId]), [['visit1', day.id], ['visit2', dayB.id]]);
  const oneDay = canvasItineraryCosts(canvasItineraryReviewDays(days, dayB.id), null);
  assert.deepEqual([oneDay.minKrw, oneDay.maxKrw, oneDay.knownCount, oneDay.totalCount], [0, 0, 1, 1]);
  const empty = canvasItineraryCosts([], null);
  assert.deepEqual([empty.minKrw, empty.maxKrw, empty.knownCount, empty.totalCount], [null, null, 0, 0]);
  const unknown = canvasItineraryCosts(canvasItineraryDays(graph([place('unpriced', 3)]), []), null);
  assert.deepEqual([unknown.minKrw, unknown.maxKrw, unknown.knownCount, unknown.totalCount], [null, null, 0, 1]);
});

test('cost headline distinguishes empty, free, zero, unknown, partial, loading and fully known totals', () => {
  const headline = (nodes, details, people = 2, pending = 0) => canvasItineraryCostHeadline(
    canvasItineraryCosts(canvasItineraryDays(graph(nodes), details), people), pending,
  );
  assert.equal(canvasItineraryCostHeadline(canvasItineraryCosts([], 2)), '—');
  assert.equal(headline([place('free', 1)], [detail(1, null, '무료')]), '무료');
  assert.equal(headline([place('zero', 1)], [detail(1, '전체 0원')]), '0원');
  assert.equal(headline([place('zero', 1), place('unknown', 2)], [detail(1, '무료')]), '요금 확인 필요');
  assert.equal(headline([place('zero', 1), place('pending', 2)], [detail(1, '무료')], 2, 1), '요금 확인 중');
  assert.equal(headline([place('paid', 1), place('unknown', 2)], [detail(1, '전체 10,000원')]), '일부 10,000원');
  assert.equal(headline([place('paid', 1), place('pending', 2)], [detail(1, '전체 10,000원')], 2, 1), '일부 10,000원 · 확인 중');
  assert.equal(headline([place('paid', 1)], [detail(1, '전체 10,000원')]), '10,000원');
  assert.equal(headline([place('range', 1)], [detail(1, '전체 약 10,000~20,000원')]), '10,000원~20,000원');
  const age = canvasItineraryCosts(canvasItineraryDays(graph([place('age', 1)]), [detail(1, '입장료: - 대인 18,000원 - 소인 14,000원')]), 2);
  assert.equal(canvasItineraryCostHeadline(age), '28,000원~36,000원');
});
