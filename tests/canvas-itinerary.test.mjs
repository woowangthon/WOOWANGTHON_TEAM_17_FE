import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasItineraryDays, toCanvasMapData } from '../src/features/workspace/canvasItineraryModel.ts';

const day = { id: 'day-a', date: '2026-11-14' };
const place = (id, contentid, intent = 'route', dayId = day.id) => ({ id, kind: 'place', dayId, contentid, intent, position: { x: 0, y: 0 }, color: 'default' });
const document = (nodes, edges) => ({ schemaVersion: 3, days: [day], nodes, edges });
const route = (status, geometry = []) => ({ sourceContentid: 1, targetContentid: 2, conditionsVersion: 4, mode: 'car', status, durationSeconds: status === 'verified' ? 90 : null, distanceMeters: status === 'verified' ? 100 : null, checkedAt: '2026-11-12T00:00:00Z', reasonCodes: [], geometry });

test('uses directed canvas links as visit order; rewiring changes the ordered route', () => {
  const nodes = [place('c', 3), place('a', 1), place('b', 2)];
  const first = canvasItineraryDays(document(nodes, [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }]), [])[0];
  const edited = canvasItineraryDays(document(nodes, [{ id: 'e1', source: 'c', target: 'a' }, { id: 'e2', source: 'a', target: 'b' }]), [])[0];
  assert.deepEqual(first.stops.map(stop => stop.node.id), ['a', 'b', 'c']);
  assert.deepEqual(edited.stops.map(stop => stop.node.id), ['c', 'a', 'b']);
});

test('keeps disconnected chains and deleted/disconnected edges separate without auto-connecting', () => {
  const nodes = [place('a', 1), place('b', 2), place('c', 3)];
  const graph = document(nodes, [{ id: 'e1', source: 'a', target: 'b' }]);
  const chains = canvasItineraryDays(graph, [])[0].chains;
  assert.deepEqual(chains.map(chain => chain.stops.map(stop => stop.node.id)), [['a', 'b'], ['c']]);
  const map = toCanvasMapData(chains, graph, new Map());
  assert.deepEqual(map.edges.map(edge => edge.id), ['e1']);
  const deleted = document([nodes[0], nodes[2]], []);
  assert.deepEqual(toCanvasMapData(canvasItineraryDays(deleted, [])[0].chains, deleted, new Map()).edges, []);
});

test('only uses current verified route geometry and the real canvas edge id', () => {
  const graph = document([place('a', 1), place('b', 2), place('c', 3)], [{ id: 'road-1', source: 'a', target: 'b' }, { id: 'road-2', source: 'b', target: 'c' }]);
  const chains = canvasItineraryDays(graph, [])[0].chains;
  const points = [{ latitude: 36.1, longitude: 127.1 }, { latitude: 36.2, longitude: 127.2 }];
  const map = toCanvasMapData(chains, graph, new Map([['road-1', route('verified', points)], ['road-2', route('unknown', points)]]));
  assert.deepEqual(map.edges.map(edge => edge.id), ['road-1', 'road-2']);
  assert.deepEqual(map.edges.map(edge => edge.geometry), [points, []]);
  const noGeometry = toCanvasMapData(chains, graph, new Map([['road-1', route('verified')]]));
  assert.deepEqual(noGeometry.edges.map(edge => edge.geometry), [[], []]);
  const malformed = toCanvasMapData(chains, graph, new Map([['road-1', route('verified', [points[0], { latitude: 100, longitude: 2 }])]]));
  assert.deepEqual(malformed.edges.map(edge => edge.geometry), [[], []]);
});

test('keeps connected candidates and duplicate visits, excludes standalone candidates and comments', () => {
  const nodes = [place('first', 42), place('candidate', 7, 'candidate'), place('later', 42), place('ignored', 8, 'candidate'), { id: 'comment', kind: 'comment', dayId: day.id }];
  const result = canvasItineraryDays(document(nodes, [{ id: 'e1', source: 'first', target: 'candidate' }, { id: 'e2', source: 'candidate', target: 'later' }]), [{ contentid: 42, title: '장소', coordinate: null }])[0];
  assert.deepEqual(result.stops.map(stop => stop.node.id), ['first', 'candidate', 'later']);
  assert.deepEqual(result.stops.map(stop => stop.order), [1, 2, 3]);
});

test('moving a place to another date preserves it on its new day and prevents cross-day map lines', () => {
  const dayB = { id: 'day-b', date: '2026-11-15' };
  const graph = { schemaVersion: 3, days: [day, dayB], nodes: [place('a', 1), place('b', 2, 'route', dayB.id)], edges: [{ id: 'cross', source: 'a', target: 'b' }] };
  const days = canvasItineraryDays(graph, []);
  assert.deepEqual(days.map(item => item.stops.map(stop => stop.node.id)), [['a'], ['b']]);
  assert.deepEqual(toCanvasMapData(days[0].chains, graph, new Map()).edges, []);
  assert.deepEqual(toCanvasMapData(days[1].chains, graph, new Map()).edges, []);
});

test('keeps missing place records as numbered map placeholders', () => {
  const graph = document([place('a', 1), place('b', 2)], [{ id: 'edge', source: 'a', target: 'b' }]);
  const nodes = toCanvasMapData(canvasItineraryDays(graph, [])[0].chains, graph, new Map()).nodes;
  assert.deepEqual(nodes.map(node => [node.id, node.coordinate, node.title]), [['a', null, '장소 정보 확인 중'], ['b', null, '장소 정보 확인 중']]);
});
