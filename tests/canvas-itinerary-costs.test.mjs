import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasItineraryCosts } from '../src/features/workspace/canvasItineraryCosts.ts';
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
});

test('accepts free labels as zero and deduplicates repeated semantic price labels', () => {
  const document = graph([place('free', 1), place('duplicate', 2), place('free2', 3), place('free3', 4)]);
  const days = canvasItineraryDays(document, [detail(1, '입장료: 무료'), detail(2, '1인 5,000원', '1인 약 5,000원'), detail(3, '입장료：무료'), detail(4, '요금 무료')]);
  const summary = canvasItineraryCosts(days, 2);
  assert.deepEqual([summary.minKrw, summary.maxKrw, summary.knownCount, summary.totalCount], [10000, 10000, 4, 4]);
  assert.equal(summary.rows[0].basis, 'free');
  assert.equal(summary.rows[1].approximate, true);
  assert.equal(summary.rows[1].sourceText, '1인 5,000원');
  assert.equal(summary.rows[2].basis, 'free');
  assert.equal(summary.rows[3].basis, 'free');
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
