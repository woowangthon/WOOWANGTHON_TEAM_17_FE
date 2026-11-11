import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasDocumentPosition, canvasFrameNodePosition, dayLabel, ensureCanvasDateRange, frameForPoint, layoutCanvasDayFrames, resolveCanvasDrop } from '../src/features/workspace/canvasDayFrames.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const makeDocument = (days, nodes = []) => ({ schemaVersion: 3, days, nodes, edges: [] });

test('a date-less canvas adopts the shared date range and keeps its existing first day ID', () => {
  const document = makeDocument([{ id: id(1), date: null }], [
    { id: id(10), kind: 'place', dayId: id(1), position: { x: 40, y: 80 }, color: 'default', contentid: 10, intent: 'route' },
  ]);
  const dated = ensureCanvasDateRange(document, '2026-11-11', '2026-11-13');
  assert.equal(dated.days[0].id, id(1));
  assert.deepEqual(dated.days.map(day => day.date), ['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.match(dated.days[1].id, /^[0-9a-f-]{36}$/u);
  assert.equal(ensureCanvasDateRange(document, '2026-11-11', '2026-11-13').days[1].id, dated.days[1].id);
  assert.deepEqual(dated.nodes, document.nodes, 'date seeding does not rewrite persisted card positions or ownership');
  assert.equal(document.days[0].date, null);
});

test('imported dates and invalid or oversized ranges are not rewritten', () => {
  const imported = makeDocument([{ id: id(1), date: '2026-11-12' }]);
  assert.equal(ensureCanvasDateRange(imported, '2026-11-11', '2026-11-13', true), imported);
  const empty = makeDocument([{ id: id(2), date: null }]);
  assert.equal(ensureCanvasDateRange(empty, '2026-99-99', '2026-11-13'), empty);
  assert.equal(ensureCanvasDateRange(empty, '2026-01-01', '2026-02-15'), empty);
});

test('date expansion never drops existing undated days or their node ownership', () => {
  const first = id(1); const extra = id(2);
  const document = makeDocument([{ id: first, date: null }, { id: extra, date: null }], [
    { id: id(10), kind: 'comment', dayId: extra, position: { x: 20, y: 100 }, color: 'default', text: 'saved draft' },
  ]);
  const expanded = ensureCanvasDateRange(document, '2026-11-11', '2026-11-11');
  assert.deepEqual(expanded.days, [{ id: first, date: '2026-11-11' }, { id: extra, date: null }]);
  assert.equal(expanded.nodes[0].dayId, extra);
});

test('all day frames remain distinct, wrapped, and preserve bounded node positions', () => {
  const days = Array.from({ length: 7 }, (_, index) => ({ id: id(index + 1), date: null }));
  const nodes = days.map((day, index) => ({ id: id(index + 20), kind: 'place', dayId: day.id, position: { x: index * 5000, y: index * 6000 }, color: 'default', contentid: index, intent: 'route' }));
  const document = makeDocument(days, nodes);
  const frames = layoutCanvasDayFrames(document);
  assert.notDeepEqual(frames.get(id(1)).position, frames.get(id(2)).position);
  assert.ok(frames.get(id(4)).position.y > frames.get(id(1)).position.y);
  for (const node of nodes) {
    const frame = frames.get(node.dayId);
    const displayed = canvasFrameNodePosition(node, frame);
    const restored = canvasDocumentPosition(displayed, frame);
    assert.ok(Math.abs(restored.x - node.position.x) < 0.001);
    assert.ok(Math.abs(restored.y - node.position.y) < 0.001);
    assert.ok(displayed.x >= 0 && displayed.x <= frame.width);
    assert.ok(displayed.y >= 0 && displayed.y <= frame.height);
  }
  const first = nodes[0]; const originalLayout = frames.get(first.dayId);
  const beforeOther = canvasFrameNodePosition(nodes[1], frames.get(nodes[1].dayId));
  const dragged = canvasDocumentPosition({ x: canvasFrameNodePosition(first, originalLayout).x + 90, y: canvasFrameNodePosition(first, originalLayout).y + 20 }, originalLayout);
  const after = { ...first, position: dragged };
  const nextDocument = makeDocument(days, [after, ...nodes.slice(1)]);
  const nextLayout = layoutCanvasDayFrames(nextDocument);
  assert.equal(canvasFrameNodePosition(after, nextLayout.get(after.dayId)).x, canvasFrameNodePosition(first, originalLayout).x + 90);
  assert.deepEqual(canvasFrameNodePosition(nodes[1], nextLayout.get(nodes[1].dayId)), beforeOther);
  const point = frames.get(id(5)).position;
  assert.equal(frameForPoint(frames, point)?.dayId, id(5));
});

test('a drop into another bounded day frame changes ownership and returns local coordinates', () => {
  const days = [{ id: id(1), date: '2026-11-11' }, { id: id(2), date: '2026-11-12' }];
  const frames = layoutCanvasDayFrames(makeDocument(days));
  const target = frames.get(id(2));
  const dropped = resolveCanvasDrop({ x: target.position.x + 180, y: target.position.y + 190 }, frames, id(1));
  assert.deepEqual(dropped, { dayId: id(2), position: { x: 158, y: 96 } });
  assert.equal(resolveCanvasDrop({ x: -100, y: -100 }, frames, id(1)).dayId, id(1));
});

test('day labels show chronological trip day and concise month/day', () => {
  assert.equal(dayLabel({ id: id(1), date: '2026-11-06' }, 0), '1일차 · 11월 6일');
  assert.equal(dayLabel({ id: id(2), date: null }, 1), '2일차');
});
