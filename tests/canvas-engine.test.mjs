import test from 'node:test';
import assert from 'node:assert/strict';
import { CanvasSyncEngine } from '../src/features/workspace/canvasSyncEngine.ts';
import { CanvasHttpError } from '../src/features/workspace/canvasApi.ts';
import { moveDayFrame } from '../src/features/workspace/canvasModel.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const trip = id(99);
const document = () => ({ schemaVersion: 3, days: [{ id: id(1), date: null }], nodes: [2, 3].map((n) => ({
  id: id(n), kind: 'place', dayId: id(1), position: { x: n * 100, y: 0 }, color: 'default', contentid: n, intent: 'candidate',
})), edges: [] });
const state = (doc, revision = 0) => ({ tripId: trip, revision, document: structuredClone(doc), places: [],
  sourcePlan: null, updatedAt: '2026-11-11T00:00:00.000Z' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function harness() {
  let server = state(document());
  const requests = [];
  const transport = {
    load: async () => structuredClone(server),
    save: async (request) => {
      requests.push(structuredClone(request));
      if (request.revision !== server.revision) throw new CanvasHttpError(409, 'VERSION_CONFLICT', 'conflict');
      server = state(request.body, server.revision + 1);
      return structuredClone(server);
    },
  };
  const engine = new CanvasSyncEngine(trip, { autoSave: false, transport });
  return { engine, transport, requests, read: () => server, remote: (mutate) => {
    const next = structuredClone(server.document); mutate(next); server = state(next, server.revision + 1);
  } };
}
const changePosition = (x) => (doc) => { doc.nodes[0].position.x = x; return doc; };
const changeOtherColor = (color) => (doc) => { doc.nodes[1].color = color; return doc; };

test('one write is in flight and edits after its snapshot survive its acknowledgement', async () => {
  const h = harness(); await h.engine.refresh();
  const gate = deferred(); const original = h.transport.save;
  h.transport.save = async (request) => { h.requests.push(structuredClone(request)); return gate.promise; };
  h.engine.update(changePosition(10));
  const writing = h.engine.save();
  h.engine.update(changeOtherColor('sky'));
  await h.engine.save();
  assert.equal(h.requests.length, 1);
  gate.resolve(state(h.requests[0].body, 1)); await writing;
  assert.equal(h.engine.getSnapshot().document.nodes[1].color, 'sky');
  assert.equal(h.engine.getSnapshot().canUndo, false);
  h.transport.save = async (request) => { h.requests.push(structuredClone(request)); return state(request.body, 2); };
  await h.engine.save();
  assert.equal(h.requests.length, 2);
  assert.equal(h.engine.getSnapshot().document.nodes[0].position.x, 10);
  assert.equal(h.engine.getSnapshot().canUndo, true);
  h.transport.save = original;
});

test('undoing and redoing the first v3 day move keeps an absent position absent', async () => {
  const h = harness(); await h.engine.refresh();
  assert.equal(h.engine.update(current => moveDayFrame(current, id(1), { x: -40, y: 120 })), true);
  await h.engine.save();
  assert.equal(h.read().document.schemaVersion, 4);
  assert.deepEqual(h.read().document.days[0].position, { x: -40, y: 120 });
  h.remote(doc => { doc.nodes[0].color = 'sky'; });
  await h.engine.refresh();

  assert.equal(h.engine.undo(), true);
  await h.engine.save();
  const undone = h.engine.getSnapshot().document;
  assert.equal(undone.schemaVersion, 4);
  assert.equal(Object.hasOwn(undone.days[0], 'position'), false);
  assert.equal(undone.nodes[0].color, 'sky', 'same-day independent edit survives the inverse');
  assert.deepEqual(h.read().document, undone);

  assert.equal(h.engine.redo(), true);
  await h.engine.save();
  assert.deepEqual(h.engine.getSnapshot().document.days[0].position, { x: -40, y: 120 });
  assert.equal(h.engine.getSnapshot().document.nodes[0].color, 'sky');
  assert.deepEqual(h.read().document, h.engine.getSnapshot().document);
});

test('a first shared engine can be seeded by imported state and keeps post-send edits', async () => {
  const requests = [];
  let finish;
  const transport = {
    load: async () => { throw new Error('unexpected read'); },
    save: async request => {
      requests.push(structuredClone(request));
      await new Promise(resolve => { finish = resolve; });
      return state(request.body, request.revision + 1);
    },
  };
  const baseline = state(document(), 5);
  const engine = new CanvasSyncEngine(trip, { autoSave: false, transport, initialState: baseline });
  assert.equal(engine.getSnapshot().state.revision, 5);
  engine.update(changePosition(50));
  const writing = engine.save();
  engine.update(changeOtherColor('sky'));
  const importedDocument = structuredClone(requests[0].body);
  importedDocument.nodes.push({ id: id(8), kind: 'place', dayId: id(1), position: { x: 300, y: 0 }, color: 'default', contentid: 8, intent: 'route', source: { planId: id(70), versionId: id(71), nodeId: id(72) }, schedule: { startAt: null, endAt: null, locked: true } });
  const imported = { ...state(importedDocument, 7), sourcePlan: { planId: id(70), versionId: id(71) } };
  const accepted = engine.acceptImportedStateAndWait(imported);
  finish();
  await Promise.all([writing, accepted]);
  const current = engine.getSnapshot();
  assert.equal(current.document.nodes[0].position.x, 50);
  assert.equal(current.document.nodes[1].color, 'sky');
  assert.equal(current.document.nodes.some(node => node.id === id(8)), true);
  assert.ok(current.state.revision >= 7);
});

test('unknown canvas outcome retries the same idempotency key before accepting import', async () => {
  const requests = [];
  let server = state(document(), 0);
  const transport = {
    load: async () => structuredClone(server),
    save: async request => {
      requests.push(structuredClone(request));
      if (requests.length === 1) throw new Error('connection reset after send');
      server = state(request.body, 1);
      return structuredClone(server);
    },
  };
  const engine = new CanvasSyncEngine(trip, { autoSave: false, transport, initialState: server });
  engine.update(changePosition(40));
  await engine.save();
  assert.equal(engine.getSnapshot().status, 'offline');
  const importedDocument = structuredClone(requests[0].body);
  importedDocument.nodes.push({ id: id(9), kind: 'place', dayId: id(1), position: { x: 400, y: 0 }, color: 'default', contentid: 9, intent: 'route', source: { planId: id(80), versionId: id(81), nodeId: id(82) }, schedule: { startAt: null, endAt: null, locked: true } });
  await engine.acceptImportedStateAndWait({ ...state(importedDocument, 2), sourcePlan: { planId: id(80), versionId: id(81) } });
  assert.equal(requests[1].key, requests[0].key);
  assert.deepEqual(requests[1].body, requests[0].body);
  assert.equal(engine.getSnapshot().document.nodes[0].position.x, 40);
  assert.equal(engine.getSnapshot().document.nodes.some(node => node.id === id(9)), true);
});

test('an explicit same-revision handoff GET recovers a failed read without dropping local history', async () => {
  const seeded = state(document(), 5);
  let loads = 0;
  const transport = {
    load: async () => { loads += 1; if (loads === 1) throw new Error('temporary read failure'); return structuredClone(seeded); },
    save: async request => state(request.body, request.revision + 1),
  };
  const engine = new CanvasSyncEngine(trip, { autoSave: false, transport, initialState: seeded });
  engine.update(changePosition(30));
  await engine.refresh();
  assert.equal(engine.getSnapshot().status, 'offline');
  await engine.acceptImportedStateAndWait(seeded);
  assert.equal(engine.getSnapshot().status, 'saving');
  assert.equal(engine.getSnapshot().state.revision, 5);
  assert.equal(engine.getSnapshot().document.nodes[0].position.x, 30);
  assert.equal(engine.getSnapshot().canUndo, false);
});

test('an explicit same-revision handoff GET clears read-only offline status when there are no writes', async () => {
  const seeded = state(document(), 5);
  let reads = 0;
  const engine = new CanvasSyncEngine(trip, { autoSave: false, transport: {
    load: async () => { if (++reads === 1) throw new Error('temporary read failure'); return structuredClone(seeded); },
    save: async request => state(request.body, request.revision + 1),
  }, initialState: seeded });
  await engine.refresh();
  assert.equal(engine.getSnapshot().status, 'offline');
  await engine.acceptImportedStateAndWait(seeded);
  assert.equal(engine.getSnapshot().status, 'saved');
  assert.equal(engine.getSnapshot().message, '');
});

test('unknown write outcome retains its exact key and body before later edits are sent', async () => {
  const h = harness(); await h.engine.refresh();
  const original = h.transport.save; let uncertain;
  h.transport.save = async (request) => {
    if (!uncertain) {
      uncertain = structuredClone(request);
      await original(request);
      throw new CanvasHttpError(0, 'NETWORK_ERROR', 'response lost');
    }
    h.requests.push(structuredClone(request));
    assert.equal(request.key, uncertain.key);
    assert.deepEqual(request.body, uncertain.body);
    return state(uncertain.body, 1);
  };
  h.engine.update(changePosition(14)); await h.engine.save();
  assert.equal(h.engine.getSnapshot().status, 'offline');
  h.engine.update(changeOtherColor('rose'));
  await h.engine.refresh(); // observes the unknown request's commit; it cannot discard its identity.
  await h.engine.save();
  assert.equal(h.engine.getSnapshot().document.nodes[1].color, 'rose');
  h.transport.save = original; await h.engine.save();
  assert.notEqual(h.requests.at(-1).key, uncertain.key);
  assert.equal(h.requests.at(-1).revision, 1);
  assert.equal(h.engine.getSnapshot().status, 'saved');
});

test('overlap stays conflicted through further edits and remote choice retains disjoint local fields', async () => {
  const h = harness(); await h.engine.refresh();
  h.engine.update(changePosition(10));
  h.remote(changePosition(20));
  await h.engine.save();
  assert.equal(h.engine.getSnapshot().status, 'conflict');
  const count = h.requests.length;
  h.engine.update(changeOtherColor('lime'));
  await h.engine.save();
  assert.equal(h.requests.length, count);
  assert.equal(h.engine.getSnapshot().status, 'conflict');
  h.engine.resolve('remote'); await h.engine.save();
  assert.equal(h.read().document.nodes[0].position.x, 20);
  assert.equal(h.read().document.nodes[1].color, 'lime');
});

test('initial load failure can retry loading before a document exists', async () => {
  const h = harness(); let reads = 0;
  h.transport.load = async () => { if (++reads === 1) throw new Error('offline'); return h.read(); };
  await h.engine.refresh();
  assert.equal(h.engine.getSnapshot().document, null);
  h.engine.retry(); await new Promise(setImmediate);
  assert.equal(reads, 2);
  assert.equal(h.engine.getSnapshot().status, 'saved');
});

test('only acknowledged edits enter history and undo/redo retain another member changes', async () => {
  const h = harness(); await h.engine.refresh();
  h.engine.update(changePosition(10));
  assert.equal(h.engine.getSnapshot().canUndo, false);
  await h.engine.save();
  h.remote(changeOtherColor('amber')); await h.engine.refresh();
  assert.equal(h.engine.undo(), true); await h.engine.save();
  assert.equal(h.read().document.nodes[0].position.x, 200);
  assert.equal(h.read().document.nodes[1].color, 'amber');
  assert.equal(h.engine.redo(), true); await h.engine.save();
  assert.equal(h.read().document.nodes[0].position.x, 10);
  assert.equal(h.read().document.nodes[1].color, 'amber');
  h.remote(changePosition(45)); await h.engine.refresh();
  assert.equal(h.engine.undo(), false);
  assert.equal(h.engine.getSnapshot().document.nodes[0].position.x, 45);
});

test('a competing field edit between undo and PUT blocks the inverse without overwriting', async () => {
  const h = harness(); await h.engine.refresh();
  h.engine.update(changePosition(10)); await h.engine.save();
  assert.equal(h.engine.undo(), true);
  h.remote(changePosition(33));
  await h.engine.save();
  assert.equal(h.engine.getSnapshot().document.nodes[0].position.x, 33);
  assert.equal(h.engine.getSnapshot().status, 'saved');
  assert.equal(h.engine.undo(), false);
});

test('a stale polling response cannot roll back a successful write', async () => {
  const h = harness(); await h.engine.refresh();
  const gate = deferred(); const old = structuredClone(h.read());
  h.transport.load = async () => gate.promise;
  const reading = h.engine.refresh();
  h.engine.update(changePosition(9)); await h.engine.save();
  gate.resolve(old); await reading;
  assert.equal(h.engine.getSnapshot().state.revision, 1);
  assert.equal(h.engine.getSnapshot().document.nodes[0].position.x, 9);
});

test('delayed functional insertion uses current edits instead of its old captured board', async () => {
  const h = harness(); await h.engine.refresh();
  const gate = deferred();
  const addWhenReady = (async () => { await gate.promise; h.engine.update((current) => ({ ...current, nodes: [
    ...current.nodes, { id: id(10), kind: 'comment', dayId: id(1), position: { x: 0, y: 200 }, color: 'default', text: '추가 댓글' },
  ] })); })();
  h.engine.update(changePosition(17));
  h.remote(changeOtherColor('sky')); await h.engine.refresh();
  gate.resolve(); await addWhenReady;
  await h.engine.save();
  assert.equal(h.read().document.nodes.length, 3);
  assert.equal(h.read().document.nodes[0].position.x, 17);
  assert.equal(h.read().document.nodes[1].color, 'sky');
});

test('correcting a rejected document releases the old failed request', async () => {
  const h = harness(); await h.engine.refresh();
  h.transport.save = async () => { throw new CanvasHttpError(404, 'PLACE_NOT_FOUND', 'place removed'); };
  h.engine.update(changePosition(18)); await h.engine.save();
  assert.equal(h.engine.getSnapshot().status, 'error');
  h.transport.save = async (request) => state(request.body, 1);
  h.engine.update(changePosition(19)); await h.engine.save();
  assert.equal(h.engine.getSnapshot().status, 'saved');
  assert.equal(h.engine.getSnapshot().document.nodes[0].position.x, 19);
});

test('undo already applied by a participant settles history and never locks later editing', async () => {
  const h = harness(); await h.engine.refresh();
  h.engine.update(changePosition(10)); await h.engine.save();
  h.remote(changePosition(200)); await h.engine.refresh();
  const writes = h.requests.length;
  assert.equal(h.engine.undo(), true); await h.engine.save();
  assert.equal(h.requests.length, writes);
  assert.equal(h.engine.update(changeOtherColor('sky')), true);
  await h.engine.save();
  assert.equal(h.read().document.nodes[1].color, 'sky');
});

test('a pre-revocation GET cannot redisplay a document after a denied write', async () => {
  const h = harness(); await h.engine.refresh();
  const gate = deferred(); const authorized = structuredClone(h.read());
  h.transport.load = async () => gate.promise;
  const reading = h.engine.refresh();
  h.transport.save = async () => { throw new CanvasHttpError(403, 'MEMBERSHIP_INACTIVE', 'revoked'); };
  h.engine.update(changePosition(8)); await h.engine.save();
  assert.equal(h.engine.getSnapshot().document, null);
  gate.resolve(authorized); await reading;
  assert.equal(h.engine.getSnapshot().document, null);
  assert.equal(h.engine.getSnapshot().status, 'error');
  h.transport.load = async () => authorized;
  h.engine.retry(); await new Promise(setImmediate);
  assert.equal(h.engine.getSnapshot().status, 'saved');
  assert.equal(h.engine.update(changeOtherColor('lime')), true);
});

test('canceled unsaved actions are not carried into later acknowledged history', async () => {
  const h = harness(); await h.engine.refresh();
  h.engine.update(changePosition(7)); h.engine.update(changePosition(200));
  h.remote(changeOtherColor('rose')); await h.engine.refresh();
  assert.equal(h.engine.getSnapshot().status, 'saved');
  h.engine.update(changePosition(8)); await h.engine.save();
  h.engine.undo(); await h.engine.save();
  assert.equal(h.engine.getSnapshot().canUndo, false);
  assert.equal(h.read().document.nodes[0].position.x, 200);
  assert.equal(h.read().document.nodes[1].color, 'rose');
});

test('remote inverse arriving after undo settles the pending no-op without a PUT', async () => {
  const h = harness(); await h.engine.refresh();
  h.engine.update(changePosition(10)); await h.engine.save();
  const writes = h.requests.length;
  h.engine.undo();
  h.remote(changePosition(200)); await h.engine.refresh();
  assert.equal(h.engine.getSnapshot().status, 'saved');
  assert.equal(h.requests.length, writes);
  assert.equal(h.engine.update(changeOtherColor('rose')), true);
  await h.engine.save();
  assert.equal(h.read().document.nodes[1].color, 'rose');
});

test('two editors saving disjoint changes converge through a real CAS conflict and retry', async () => {
  let server = state(document());
  const transport = {
    load: async () => structuredClone(server),
    save: async (request) => {
      if (request.revision !== server.revision) throw new CanvasHttpError(409, 'VERSION_CONFLICT', 'conflict');
      server = state(request.body, server.revision + 1);
      return structuredClone(server);
    },
  };
  const first = new CanvasSyncEngine(trip, { autoSave: false, transport });
  const second = new CanvasSyncEngine(trip, { autoSave: false, transport });
  await Promise.all([first.refresh(), second.refresh()]);
  first.update(changePosition(21)); second.update(changeOtherColor('sky'));
  await Promise.all([first.save(), second.save()]);
  await second.save(); await first.refresh();
  assert.equal(server.revision, 2);
  assert.equal(server.document.nodes[0].position.x, 21);
  assert.equal(server.document.nodes[1].color, 'sky');
  assert.deepEqual(first.getSnapshot().document, second.getSnapshot().document);
});

test('undo cannot delete a node that another editor has newly connected', async () => {
  const h = harness(); await h.engine.refresh();
  h.engine.update((doc) => ({ ...doc, nodes: [...doc.nodes, { ...doc.nodes[0], id: id(4), contentid: 4 }] }));
  await h.engine.save();
  h.remote((doc) => { doc.edges.push({ id: id(11), source: id(4), target: id(2) }); });
  await h.engine.refresh();
  assert.equal(h.engine.undo(), false);
  assert.equal(h.engine.getSnapshot().document.nodes.length, 3);
  assert.equal(h.engine.getSnapshot().document.edges.length, 1);
});

test('schema migration and downgrade rejections end the pending write with a clear message', async () => {
  for (const [status, code, expected] of [
    [503, 'SCHEMA_MIGRATION_REQUIRED', 'DB에 날짜 편집 저장 업데이트(005)가 필요해요. 관리자에게 확인해 주세요.'],
    [409, 'SCHEMA_VERSION_CONFLICT', '저장하지 못했어요. 새로고침한 뒤 다시 시도해 주세요.'],
  ]) {
    const h = harness(); await h.engine.refresh();
    let attempts = 0;
    h.transport.save = async () => { attempts += 1; throw new CanvasHttpError(status, code, expected); };
    h.engine.update(changePosition(88));
    await h.engine.save();
    assert.equal(h.engine.getSnapshot().status, 'error');
    assert.equal(h.engine.getSnapshot().message, expected);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(attempts, 1, 'a rejected migration request is not retried as an unknown write outcome');
  }
});

test('a definite validation rejection accepts a later edit and retries with a fresh key', async () => {
  const h = harness(); await h.engine.refresh();
  const attempts=[];let server=h.read();
  h.transport.save=async request=>{
    attempts.push(structuredClone(request));
    if(attempts.length===1)throw new CanvasHttpError(400,'VALIDATION_ERROR','저장 요청을 확인하지 못했어요.');
    server=state(request.body,server.revision+1);return structuredClone(server);
  };
  h.engine.update(changePosition(88));await h.engine.save();
  assert.equal(h.engine.getSnapshot().status,'error');
  assert.equal(h.engine.getSnapshot().message,'저장 요청을 확인하지 못했어요.');
  h.engine.update(changeOtherColor('sky'));
  assert.equal(h.engine.getSnapshot().status,'saving');
  assert.equal(h.engine.getSnapshot().message,'');
  await h.engine.save();
  assert.equal(attempts.length,2);
  assert.notEqual(attempts[0].key,attempts[1].key,'a definitely rejected request gets a fresh idempotency key');
  assert.equal(h.engine.getSnapshot().document.nodes[0].position.x,88);
  assert.equal(h.engine.getSnapshot().document.nodes[1].color,'sky');
});

test('a definite undo rejection restores acknowledged state and leaves history usable', async () => {
  const h=harness();await h.engine.refresh();
  const originalSave=h.transport.save;let attempts=0;
  h.transport.save=async request=>{attempts+=1;if(attempts===2)throw new CanvasHttpError(400,'VALIDATION_ERROR','요청을 확인해 주세요.');return originalSave(request);};
  h.engine.update(changePosition(77));await h.engine.save();
  const acknowledged=structuredClone(h.engine.getSnapshot().document);
  assert.equal(h.engine.undo(),true);await h.engine.save();
  assert.equal(h.engine.getSnapshot().status,'error');
  assert.deepEqual(h.engine.getSnapshot().document,acknowledged,'rejected inverse is rolled back to server state');
  assert.equal(h.engine.getSnapshot().canUndo,true);
  assert.equal(h.engine.getSnapshot().canRedo,false);
  assert.equal(h.engine.undo(),true);
  await h.engine.save();
  assert.deepEqual(h.engine.getSnapshot().document.nodes[0].position,{x:200,y:0});
  assert.equal(h.engine.getSnapshot().canRedo,true);
});
