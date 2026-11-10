import test from 'node:test';
import assert from 'node:assert/strict';
import { canConnectRoute, parseCanvasDocument } from '../src/features/workspace/canvasModel.ts';

const days = new Map([['a', 1], ['b', 1], ['c', 1], ['candidate', 1], ['tomorrow', 2]]);

test('a free candidate can join either end of the daily route', () => {
  const edges = [{ source: 'a', target: 'b' }];
  assert.equal(canConnectRoute('b', 'candidate', days, edges), true);
  assert.equal(canConnectRoute('candidate', 'a', days, edges), true);
  assert.deepEqual(edges, [{ source: 'a', target: 'b' }]);
});

test('daily route rejects cycles, branches, self connections, and missing or foreign-day cards', () => {
  const edges = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }];
  for (const [source, target] of [['c', 'a'], ['a', 'candidate'], ['candidate', 'b'], ['a', 'a'], ['c', 'tomorrow'], ['missing', 'candidate']]) {
    assert.equal(canConnectRoute(source, target, days, edges), false, `${source} to ${target}`);
  }
});

test('cut route segments can be explicitly rejoined without modifying the disconnected graph', () => {
  const disconnected = [{ source: 'b', target: 'c' }];
  assert.equal(canConnectRoute('a', 'b', days, disconnected), true);
  assert.equal(canConnectRoute('c', 'candidate', days, disconnected), true);
  assert.deepEqual(disconnected, [{ source: 'b', target: 'c' }]);
});

const storedBoard = () => ({ schemaVersion: 2, dayCount: 2, nodes: ['a', 'b', 'c'].map((id) => ({ id, position: { x: 20, y: 40 }, data: { place: { name: id, area: '예시', note: '', day: 1 }, intent: 'candidate' } })), edges: [{ id: 'ab', source: 'a', target: 'b' }] });
test('storage restoration preserves coordinates and strips arbitrary library props and private fields', () => {
  const raw = storedBoard();
  raw.nodes[0].style = { position: 'fixed' };
  raw.nodes[0].type = 'foreign';
  raw.nodes[0].data.originalText = 'must not persist';
  const restored = parseCanvasDocument(raw);
  assert.deepEqual(restored.nodes[0].position, { x: 20, y: 40 });
  assert.equal(restored.nodes[0].data.intent, 'route');
  assert.equal(restored.nodes[2].data.intent, 'candidate');
  assert.equal('style' in restored.nodes[0], false);
  assert.equal('originalText' in restored.nodes[0].data, false);
});
test('storage restoration rejects corrupted graphs, duplicate IDs, invalid days, and oversized text', () => {
  for (const corrupt of [
    (value) => value.edges.push({ id: 'bc', source: 'b', target: 'c' }, { id: 'ca', source: 'c', target: 'a' }),
    (value) => value.edges.push({ id: 'ac', source: 'a', target: 'c' }),
    (value) => { value.nodes[1].id = 'a'; },
    (value) => { value.nodes[1].data.place.day = 3; },
    (value) => { value.nodes[1].data.place.name = '장'.repeat(101); },
    (value) => { value.nodes[1].position.x = Infinity; },
  ]) {
    const raw = storedBoard(); corrupt(raw);
    assert.equal(parseCanvasDocument(raw), null);
  }
});
