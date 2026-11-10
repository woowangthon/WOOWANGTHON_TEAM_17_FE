import test from 'node:test';
import assert from 'node:assert/strict';
import { getCanvasRoute } from '../src/features/workspace/canvasApi.ts';
import { CanvasRouteController, canvasRouteKey, collectCanvasRouteRequests, formatCanvasRouteLabel, parseCanvasRoute } from '../src/features/workspace/canvasRoutes.ts';

const uuid = '10000000-0000-4000-8000-000000000001';
const input = { tripId: uuid, sourceContentid: -17, targetContentid: 22, conditionsVersion: 3, mode: 'walk' };
const result = (overrides = {}) => ({ sourceContentid: -17, targetContentid: 22, conditionsVersion: 3, mode: 'walk', status: 'verified', durationSeconds: 3661, distanceMeters: 1200, checkedAt: '2026-11-11T00:00:00Z', reasonCodes: [], ...overrides });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('route parser requires exact signed IDs, condition version, mode, and coherent metrics', () => {
  assert.deepEqual(parseCanvasRoute(result(), input), result());
  for (const invalid of [
    result({ sourceContentid: 17 }), result({ targetContentid: 23 }), result({ conditionsVersion: 4 }),
    result({ mode: 'car' }), result({ extra: true }), result({ durationSeconds: -1 }),
    result({ durationSeconds: 1.5 }), result({ durationSeconds: 4294967296 }),
    result({ checkedAt: '2026-02-30T00:00:00Z' }), result({ status: 'verified', durationSeconds: null }),
    result({ status: 'unknown', durationSeconds: 1, distanceMeters: 2 }),
  ]) assert.equal(parseCanvasRoute(invalid, input), null);
  assert.equal(parseCanvasRoute(result({ status: 'unknown', durationSeconds: null, distanceMeters: null }), input)?.status, 'unknown');
});

test('route labels round up partial minutes and never invent a duration', () => {
  assert.equal(formatCanvasRouteLabel(parseCanvasRoute(result({ durationSeconds: 61 }), input)), '도보 2분');
  assert.equal(formatCanvasRouteLabel(parseCanvasRoute(result({ durationSeconds: 3661 }), input)), '도보 1시간 2분');
  assert.equal(formatCanvasRouteLabel(parseCanvasRoute(result({ durationSeconds: 0 }), input)), '도보 0분');
  assert.equal(formatCanvasRouteLabel(parseCanvasRoute(result({ status: 'unknown', durationSeconds: null, distanceMeters: null }), input)), '시간 미확인');
  assert.equal(formatCanvasRouteLabel(null, true), '조회 중');
  assert.equal(formatCanvasRouteLabel(null), '시간 미확인');
});

test('route requests include only current-day directed place edges and deduplicate content pairs', () => {
  const day = id(1); const otherDay = id(2);
  const document = {
    nodes: [
      { id: id(10), kind: 'place', dayId: day, contentid: 101 },
      { id: id(11), kind: 'place', dayId: day, contentid: 202 },
      { id: id(12), kind: 'place', dayId: day, contentid: 101 },
      { id: id(13), kind: 'comment', dayId: day },
      { id: id(14), kind: 'place', dayId: otherDay, contentid: 303 },
    ],
    edges: [
      { id: id(20), source: id(10), target: id(11) },
      { id: id(21), source: id(12), target: id(11) },
      { id: id(22), source: id(11), target: id(10) },
      { id: id(23), source: id(10), target: id(13) },
      { id: id(24), source: id(10), target: id(14) },
    ],
  };
  const requests = collectCanvasRouteRequests(uuid, 8, 'car', document, day);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ sourceContentid, targetContentid }) => [sourceContentid, targetContentid]), [[101, 202], [202, 101]]);
  assert.deepEqual(requests[0].edgeIds, [id(20), id(21)]);
  assert.equal(collectCanvasRouteRequests(uuid, null, 'car', document, day).length, 0);
  assert.notEqual(canvasRouteKey({ ...input, sourceContentid: 22, targetContentid: -17 }), canvasRouteKey(input));
});

test('GET route sends saved conditions version and enforces credentials and no-store', async () => {
  let captured;
  const route = await getCanvasRoute(input, undefined, { fetcher: async (path, init) => {
    captured = { path, init };
    return new Response(JSON.stringify(result()), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  assert.equal(route.durationSeconds, 3661);
  assert.equal(captured.path, `/api/v1/trips/${uuid}/canvas/route?sourceContentid=-17&targetContentid=22&expectedConditionsVersion=3`);
  assert.equal(captured.init.credentials, 'include');
  assert.equal(captured.init.cache, 'no-store');
  await assert.rejects(getCanvasRoute(input, undefined, { fetcher: async () => new Response(JSON.stringify(result({ conditionsVersion: 2 })), { status: 200 }) }), /경로 응답/u);
});

test('route queue deduplicates keys and never exceeds two live requests', async () => {
  const queue = new CanvasRouteController(2); queue.setScope('trip/cv/mode');
  const gates = new Map(['a', 'b', 'c'].map(key => [key, deferred()]));
  let active = 0; let maximum = 0; let calls = 0;
  const run = key => async () => { calls += 1; active += 1; maximum = Math.max(maximum, active); const value = await gates.get(key).promise; active -= 1; return value; };
  const a = queue.load('a', run('a')); const duplicateA = queue.load('a', run('a'));
  const b = queue.load('b', run('b')); const c = queue.load('c', run('c'));
  await Promise.resolve();
  assert.equal(calls, 2);
  gates.get('a').resolve('A');
  assert.equal(await a, 'A'); assert.equal(await duplicateA, 'A');
  await Promise.resolve();
  assert.equal(calls, 3);
  gates.get('b').resolve('B'); gates.get('c').resolve('C');
  assert.deepEqual(await Promise.all([b, c]), ['B', 'C']);
  assert.equal(maximum, 2);
  assert.equal(calls, 3);
  queue.retainKeys(new Set());
  assert.equal(await queue.load('a', run('a')), 'A');
  assert.equal(calls, 3);
});

test('scope changes abort old jobs, discard queued work, and count old active requests until settled', async () => {
  const queue = new CanvasRouteController(2); queue.setScope('old');
  const a = deferred(); const b = deferred(); let active = 0; let maximum = 0; const signals = [];
  const run = gate => signal => { signals.push(signal); active += 1; maximum = Math.max(maximum, active); return gate.promise.finally(() => { active -= 1; }); };
  const first = queue.load('a', run(a)); const second = queue.load('b', run(b)); const queued = queue.load('c', async () => 'should not run');
  await Promise.resolve();
  queue.setScope('new');
  assert.ok(signals.every(signal => signal.aborted));
  assert.equal(await queued, null);
  let startedNew = false;
  const fresh = queue.load('fresh', async () => { startedNew = true; active += 1; maximum = Math.max(maximum, active); active -= 1; return 'fresh'; });
  await Promise.resolve();
  assert.equal(startedNew, false);
  a.resolve('old-a');
  assert.equal(await first, 'old-a');
  await Promise.resolve();
  assert.equal(startedNew, true);
  assert.equal(await fresh, 'fresh');
  b.resolve('old-b'); await second;
  assert.equal(maximum, 2);
});

test('plan changes prune obsolete queued and active work while preserving the two-request limit', async () => {
  const queue = new CanvasRouteController(2); queue.setScope('scope');
  const a = deferred(); const b = deferred(); const oldSignals = [];
  const active = key => signal => { oldSignals.push(signal); return key === 'a' ? a.promise : b.promise; };
  const first = queue.load('a', active('a')); const second = queue.load('b', active('b'));
  let obsoleteCalled = false; const obsolete = queue.load('obsolete', async () => { obsoleteCalled = true; return 'obsolete'; });
  await Promise.resolve();
  queue.retainKeys(new Set());
  assert.equal(await obsolete, null);
  assert.ok(oldSignals.every(signal => signal.aborted));
  let freshCalled = false;
  const fresh = queue.load('fresh', async () => { freshCalled = true; return 'fresh'; });
  await Promise.resolve();
  assert.equal(freshCalled, false);
  a.resolve('old-a'); await first;
  assert.equal(await fresh, 'fresh');
  b.resolve('old-b'); await second;
  assert.equal(obsoleteCalled, false);
});
