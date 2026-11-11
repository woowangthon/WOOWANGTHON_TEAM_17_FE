import test from 'node:test';
import assert from 'node:assert/strict';
import { generationStageProgress } from '../src/features/generation/generationProgress.ts';
import { mayCompleteHandoff, waitForTwoPaints } from '../src/features/generation/generationHandoff.ts';
import { canvasCommentDraftKey, canvasSourceKey, canvasViewScope, chooseHandoffTarget, consumeHandoff, firstRouteDay, hasConsumedHandoff, hasFittedHandoff, markHandoffFitted, readCanvasView, resolveCanvasMountView, writeCanvasView } from '../src/features/workspace/canvasHandoff.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const doc = {
  schemaVersion: 3,
  days: [{ id: id(1), date: null }, { id: id(2), date: '2026-11-12' }],
  nodes: [
    { id: id(10), kind: 'place', dayId: id(1), position: { x: 0, y: 0 }, color: 'default', contentid: 20, intent: 'route' },
    { id: id(11), kind: 'place', dayId: id(2), position: { x: 100, y: 0 }, color: 'default', contentid: 21, intent: 'route', source: { planId: id(90), versionId: id(91), nodeId: id(92) }, schedule: { startAt: null, endAt: null, locked: true } },
    { id: id(12), kind: 'place', dayId: id(2), position: { x: 200, y: 0 }, color: 'default', contentid: 22, intent: 'route', source: { planId: id(90), versionId: id(91), nodeId: id(93) }, schedule: { startAt: null, endAt: null, locked: true } },
  ],
  edges: [{ id: id(30), source: id(11), target: id(12) }],
};

test('progress reports only confirmed stages and errors never complete the ring', () => {
  assert.deepEqual(['checking', 'generating', 'routing', 'opening', 'complete'].map(phase => generationStageProgress(phase).stagesCompleted), [0, 1, 2, 3, 4]);
  const failed = generationStageProgress('complete', true);
  assert.equal(failed.fraction, .75);
  assert.equal(failed.stagesCompleted, 3);
});

test('handoff selects its generated route day even when an earlier day exists', () => {
  const target = chooseHandoffTarget(doc, { tripId: id(99), planId: id(90), versionId: id(91), handoffId: id(94) });
  assert.deepEqual(target, { dayId: id(2), nodeIds: [id(11), id(12)], matched: true });
  assert.equal(firstRouteDay(doc), id(2));
});

test('missing generated nodes falls back to a real saved route and never invents replacements', () => {
  const changed = structuredClone(doc);
  changed.nodes = changed.nodes.filter(node => node.id !== id(11) && node.id !== id(12));
  changed.edges = [];
  const target = chooseHandoffTarget(changed, { tripId: id(99), planId: id(90), versionId: id(91), handoffId: id(95) });
  assert.deepEqual(target, { dayId: id(1), nodeIds: [id(10)], matched: false });
  assert.equal(changed.nodes.length, 1);
});

test('fit memory is keyed to one handoff and remains stable across remounts', () => {
  const key = id(96);
  assert.equal(hasFittedHandoff(key), false);
  markHandoffFitted(key);
  assert.equal(hasFittedHandoff(key), true);
  markHandoffFitted(key);
  assert.equal(hasFittedHandoff(key), true);
});

test('canvas view cache restores day and viewport within its room and preview scope', () => {
  const shared = canvasViewScope(id(97), false);
  const preview = canvasViewScope(id(97), true);
  writeCanvasView(shared, { dayId: id(2), viewport: { x: 42, y: -18, zoom: 1.25 } });
  assert.deepEqual(readCanvasView(shared), { dayId: id(2), viewport: { x: 42, y: -18, zoom: 1.25 } });
  assert.equal(readCanvasView(preview), null);
  const copy = readCanvasView(shared);
  copy.viewport.x = 0;
  assert.equal(readCanvasView(shared).viewport.x, 42);
});

test('a newly imported source has separate view, discovery, and comment-draft identity', () => {
  const manual = canvasSourceKey(null);
  const first = canvasSourceKey({ planId: id(110), versionId: id(111) });
  const second = canvasSourceKey({ planId: id(110), versionId: id(112) });
  assert.notEqual(first, manual);
  assert.notEqual(first, second);
  assert.notEqual(canvasViewScope(id(113), false, manual), canvasViewScope(id(113), false, first));
  assert.notEqual(canvasCommentDraftKey(id(113), manual, id(114)), canvasCommentDraftKey(id(113), first, id(114)));
  assert.notEqual(canvasCommentDraftKey(id(113), first, id(114)), canvasCommentDraftKey(id(113), second, id(114)));
});

test('consumed handoff is scoped to a shared or preview canvas and will not reselect on remount', () => {
  const shared = canvasViewScope(id(98), false);
  const preview = canvasViewScope(id(98), true);
  const handoff = id(99);
  assert.equal(hasConsumedHandoff(shared, handoff), false);
  consumeHandoff(shared, handoff);
  assert.equal(hasConsumedHandoff(shared, handoff), true);
  assert.equal(hasConsumedHandoff(preview, handoff), false);
});

test('mount resolution restores a consumed handoff cache, while a new handoff overrides it once', () => {
  const scope = canvasViewScope(id(97), false);
  const handoff = { tripId: id(97), planId: id(90), versionId: id(91), handoffId: id(100) };
  writeCanvasView(scope, { dayId: id(1), viewport: { x: 10, y: 20, zoom: 1 } });
  const first = resolveCanvasMountView(doc, scope, handoff);
  assert.equal(first.kind, 'handoff');
  assert.equal(first.target.dayId, id(2));
  consumeHandoff(scope, handoff.handoffId);
  writeCanvasView(scope, { dayId: first.target.dayId, viewport: { x: 55, y: 66, zoom: 1.4 } });
  const remount = resolveCanvasMountView(doc, scope, handoff);
  assert.deepEqual(remount, { kind: 'restore', dayId: id(2), viewport: { x: 55, y: 66, zoom: 1.4 }, initialFitNodeIds: [] });
});

test('a fresh canvas fits the complete day-world instead of focusing only its first route day', () => {
  const scope = canvasViewScope(id(101), false);
  const view = resolveCanvasMountView(doc, scope, null);
  assert.equal(view.kind, 'restore');
  assert.deepEqual(view.initialFitNodeIds, [`day-frame:${id(1)}`, `day-frame:${id(2)}`]);
});

test('a stale or aborted completion cannot hand off to the canvas', () => {
  const controller = new AbortController();
  assert.equal(mayCompleteHandoff(controller.signal, 3, 3), true);
  assert.equal(mayCompleteHandoff(controller.signal, 2, 3), false);
  assert.equal(mayCompleteHandoff(controller.signal, 3, 3, 'unsaved input'), false);
  controller.abort();
  assert.equal(mayCompleteHandoff(controller.signal, 3, 3), false);
});

test('two-paint completion waits two frames and abort cancels its pending frame', async () => {
  const queue = [];
  const canceled = [];
  let frameId = 0;
  const controller = new AbortController();
  const wait = waitForTwoPaints(controller.signal, callback => { queue.push(callback); return ++frameId; }, handle => canceled.push(handle));
  assert.equal(queue.length, 1);
  queue.shift()();
  assert.equal(queue.length, 1);
  controller.abort();
  await assert.rejects(wait, { name: 'AbortError' });
  assert.deepEqual(canceled, [1, 2]);

  const next = [];
  const live = waitForTwoPaints(new AbortController().signal, callback => { next.push(callback); return next.length; }, () => {});
  next.shift()();
  next.shift()();
  await live;
});
