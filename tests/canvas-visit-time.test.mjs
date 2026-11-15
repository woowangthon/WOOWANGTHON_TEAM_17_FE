import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditCanvasVisitTime, canvasStayMinutes, createCanvasVisitTime, getCanvasKstClock, getCanvasKstDate, getCanvasVisitClocks, getCanvasVisitTime, moveCanvasVisitStart, toCanvasKstUtc } from '../src/features/workspace/canvasVisitTime.ts';
import { canvasClipboardCopy, copyCanvasNode, mergeCanvasDocuments, parseCanvasDocument, replaceCanvasPlace, setCanvasVisitTime } from '../src/features/workspace/canvasModel.ts';
import { canvasItineraryDays, canvasItineraryReviewSummary, toCanvasMapData } from '../src/features/workspace/canvasItineraryModel.ts';

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const schedule = { startAt: '2026-11-11T00:00:00Z', endAt: '2026-11-11T01:30:00Z', locked: false };
const node = (overrides = {}) => ({ id: id(3), kind: 'place', dayId: id(1), position: { x: 10, y: 20 }, color: 'lime', contentid: 101, intent: 'route', source: { planId: id(5), versionId: id(6), nodeId: id(7) }, schedule: { ...schedule }, ...overrides });
const doc = (nodes = [node()], version = 3) => ({ schemaVersion: version, days: [{ id: id(1), date: '2026-11-11' }, { id: id(2), date: '2026-11-12' }], nodes, edges: [], ...(version === 4 ? { dayLinks: [{ id: id(8), source: id(1), target: id(2) }] } : {}) });
const edited = { startAt: '2026-11-11T01:00:00.000Z', endAt: '2026-11-11T02:15:00.000Z' };

test('KST controls round trip endpoints while source schedule stays unchanged', () => {
  const original = doc();
  const result = setCanvasVisitTime(original, id(3), edited);
  assert.ok(result);
  assert.equal(result.schemaVersion, 4);
  assert.equal(result.visitTimeVersion, 1);
  assert.deepEqual(result.dayLinks.map(({ source, target }) => [source, target]), [[id(1), id(2)]]);
  assert.deepEqual(result.nodes[0].schedule, schedule);
  assert.deepEqual(getCanvasVisitTime(result.nodes[0]), edited);
  assert.equal(toCanvasKstUtc('2026-11-11', '10:00'), '2026-11-11T01:00:00.000Z');
  assert.equal(getCanvasKstDate(edited.startAt), '2026-11-11');
  assert.equal(getCanvasKstClock(edited.startAt), '10:00');
  assert.equal(canvasStayMinutes(result.nodes[0], 40), 75);
  assert.deepEqual(parseCanvasDocument(result), result);
});

test('UTC visit override retains imported endpoint KST dates and requires a complete unlocked import', () => {
  assert.equal(canEditCanvasVisitTime(node()), true);
  assert.equal(canEditCanvasVisitTime(node({ schedule: { ...schedule, locked: true } })), false);
  for (const denied of [node({ source: undefined }), node({ schedule: undefined }), node({ schedule: { ...schedule, startAt: null } })]) {
    assert.equal(setCanvasVisitTime(doc([denied]), id(3), edited), null);
  }
  assert.equal(setCanvasVisitTime(doc(), id(3), { startAt: '2026-11-10T14:59:00Z', endAt: edited.endAt }), null);
  assert.equal(setCanvasVisitTime(doc(), id(3), { startAt: edited.endAt, endAt: edited.startAt }), null);
  assert.equal(setCanvasVisitTime(doc(), id(3), { startAt: '2026-11-11T01:00:00', endAt: edited.endAt }), null);
  assert.equal(toCanvasKstUtc('2026-02-30', '10:00'), null);
  assert.equal(toCanvasKstUtc('2026-11-11', '24:00'), null);
});

test('schema marker and overrides validate strictly and survive merge history', () => {
  const base = doc();
  const local = setCanvasVisitTime(base, id(3), edited);
  assert.ok(local);
  const parsed = parseCanvasDocument(local);
  assert.ok(parsed);
  assert.equal(parseCanvasDocument({ ...local, visitTimeVersion: 3 }), null);
  assert.equal(parseCanvasDocument({ ...local, unexpected: true }), null);
  assert.equal(parseCanvasDocument({ ...local, schemaVersion: 3, dayLinks: undefined }), null);
  const downgradeAttempt = { ...local, schemaVersion: 3, dayLinks: undefined };
  assert.equal(parseCanvasDocument(downgradeAttempt), null);
  const undone = mergeCanvasDocuments(local, base, local).document;
  assert.equal(undone?.schemaVersion, 4);
  assert.equal(undone?.visitTimeVersion, 1);
});

test('independent edits merge, incompatible intervals conflict atomically, and copy or replacement drops them', () => {
  const base = setCanvasVisitTime(doc(), id(3), edited);
  assert.ok(base);
  const localInterval = { startAt: '2026-11-11T01:15:00.000Z', endAt: '2026-11-11T02:30:00.000Z' };
  const remoteInterval = { startAt: '2026-11-11T01:30:00.000Z', endAt: '2026-11-11T02:45:00.000Z' };
  const local = setCanvasVisitTime(base, id(3), localInterval);
  assert.ok(local);
  const remoteChangedAppearance = { ...base, nodes: [{ ...base.nodes[0], color: 'sky' }] };
  const independent = mergeCanvasDocuments(base, local, remoteChangedAppearance);
  assert.deepEqual(independent.document?.nodes[0].visitTime, localInterval);
  assert.equal(independent.document?.nodes[0].color, 'sky');
  const remote = setCanvasVisitTime(base, id(3), remoteInterval);
  assert.ok(remote);
  assert.equal(mergeCanvasDocuments(base, local, remote).document, null);
  const copied = copyCanvasNode(local.nodes[0], id(9), id(1));
  assert.equal(copied.kind, 'place');
  assert.equal('visitTime' in copied, false);
  assert.equal('visitTime' in canvasClipboardCopy(local.nodes[0]), false);
  assert.equal('visitTime' in replaceCanvasPlace(local.nodes[0], 222), false);
});

test('replacing a visit conflicts atomically with a concurrent time edit and each choice preserves unrelated fields', () => {
  const base = setCanvasVisitTime(doc(), id(3), edited);
  assert.ok(base);
  const revisedTime = { startAt: '2026-11-11T01:15:00.000Z', endAt: '2026-11-11T02:30:00.000Z' };
  const timed = setCanvasVisitTime(base, id(3), revisedTime);
  assert.ok(timed);
  const replacementNode = replaceCanvasPlace(base.nodes[0], 909);
  const replaced = { ...base, nodes: [{ ...replacementNode, position: { x: 90, y: 80 } }] };
  const conflicted = mergeCanvasDocuments(base, timed, replaced);
  assert.equal(conflicted.document, null);
  assert.ok(conflicted.conflicts.includes(`node:${id(3)}.identity/visitTime`));

  const chooseTime = mergeCanvasDocuments(base, timed, replaced, 'local');
  assert.ok(chooseTime.document);
  const keptOriginal = chooseTime.document.nodes[0];
  assert.equal(keptOriginal.contentid, base.nodes[0].contentid);
  assert.deepEqual(keptOriginal.visitTime, revisedTime);
  assert.deepEqual(keptOriginal.source, base.nodes[0].source);
  assert.deepEqual(keptOriginal.schedule, base.nodes[0].schedule);
  assert.deepEqual(keptOriginal.position, replaced.nodes[0].position);

  const chooseReplacement = mergeCanvasDocuments(base, timed, replaced, 'remote');
  assert.ok(chooseReplacement.document);
  const keptReplacement = chooseReplacement.document.nodes[0];
  assert.equal(keptReplacement.contentid, 909);
  assert.equal(keptReplacement.source, undefined);
  assert.equal(keptReplacement.schedule, undefined);
  assert.equal(keptReplacement.visitTime, undefined);
  assert.deepEqual(keptReplacement.position, replaced.nodes[0].position);

  const reverseConflict = mergeCanvasDocuments(base, replaced, timed);
  assert.equal(reverseConflict.document, null);
  assert.ok(reverseConflict.conflicts.includes(`node:${id(3)}.identity/visitTime`));
  const reverseResolve = mergeCanvasDocuments(base, replaced, timed, 'local');
  assert.ok(reverseResolve.document);
  assert.equal(reverseResolve.document.nodes[0].contentid, 909);
  assert.equal(reverseResolve.document.nodes[0].visitTime, undefined);
  assert.deepEqual(reverseResolve.document.nodes[0].position, replaced.nodes[0].position);
});

test('first relative visit on a manual card conflicts with replacement in either merge direction', () => {
  const { source: _source, schedule: _schedule, ...manual } = node({ intent: 'candidate' });
  const base = doc([manual]);
  const relative = { startTime: '10:00', endTime: '11:30' };
  const timed = setCanvasVisitTime(base, manual.id, relative);
  const replacedNode = replaceCanvasPlace(base.nodes[0], 818);
  const replaced = { ...base, nodes: [{ ...replacedNode, color: 'sky' }] };
  const forward = mergeCanvasDocuments(base, timed, replaced);
  assert.equal(forward.document, null);
  assert.ok(forward.conflicts.includes(`node:${manual.id}.identity/visitTime`));
  const keepTiming = mergeCanvasDocuments(base, timed, replaced, 'local');
  assert.equal(keepTiming.document?.nodes[0].contentid, manual.contentid);
  assert.deepEqual(keepTiming.document?.nodes[0].visitTime, relative);
  assert.equal(keepTiming.document?.nodes[0].color, 'sky');
  const keepReplacement = mergeCanvasDocuments(base, timed, replaced, 'remote');
  assert.equal(keepReplacement.document?.nodes[0].contentid, 818);
  assert.equal(keepReplacement.document?.nodes[0].visitTime, undefined);
  assert.equal(keepReplacement.document?.nodes[0].color, 'sky');
  const reverse = mergeCanvasDocuments(base, replaced, timed);
  assert.equal(reverse.document, null);
  const reverseChoice = mergeCanvasDocuments(base, replaced, timed, 'local');
  assert.equal(reverseChoice.document?.nodes[0].contentid, 818);
  assert.equal(reverseChoice.document?.nodes[0].visitTime, undefined);
  assert.equal(reverseChoice.document?.nodes[0].color, 'sky');
});

test('effective visit duration falls back to immutable schedule then estimate', () => {
  assert.deepEqual(getCanvasVisitTime(node()), { startAt: schedule.startAt, endAt: schedule.endAt });
  assert.equal(canvasStayMinutes(node(), 40), 90);
  assert.equal(canvasStayMinutes(node({ schedule: { startAt: null, endAt: null, locked: true } }), 40), 40);
  assert.equal(canvasStayMinutes(node({ schedule: undefined }), null), null);
});

test('overview summary and map projection use effective visit times and duration', () => {
  const graph = setCanvasVisitTime(doc(), id(3), edited);
  assert.ok(graph);
  const days = canvasItineraryDays(graph, [{ contentid: 101, title: 'Place', address: null, adminCity: null, category: null, planningRole: null,
    coordinate: null, overviewText: null, menuText: null, openingHoursText: null, closedDaysText: null, feeText: null, bookingText: null,
    parkingText: null, tel: null, homepageUrl: null, estimatedStayMinutes: 40 }]);
  const summary = canvasItineraryReviewSummary({ days, document: graph, routesByEdge: new Map(), edgeOverrides: new Map(), commonMode: 'car', conditionsVersion: 1 });
  assert.equal(summary.stay.knownMinutes, 75);
  assert.equal(summary.stay.knownCount, 1);
  const map = toCanvasMapData(days[0].chains, graph, new Map());
  assert.equal(map.nodes[0].estimatedStartAt, edited.startAt);
  assert.equal(map.nodes[0].estimatedEndAt, edited.endAt);
  assert.equal(map.nodes[0].stayMinutes, 75);
});

test('relative times work on manual, candidate, partial, and undated places without invented dates', () => {
  const { source: _source, schedule: _schedule, ...manual } = node({ intent: 'candidate' });
  assert.equal(canEditCanvasVisitTime(manual), true);
  assert.deepEqual(getCanvasVisitClocks(manual), { startTime: '', endTime: '' });
  const relative = createCanvasVisitTime(manual, { startTime: '09:15', endTime: '11:00' });
  assert.deepEqual(relative, { startTime: '09:15', endTime: '11:00' });
  const result = setCanvasVisitTime(doc([manual]), manual.id, relative);
  assert.equal(result?.visitTimeVersion, 2);
  assert.deepEqual(result?.nodes[0].visitTime, relative);
  assert.deepEqual(parseCanvasDocument(result), result);
  assert.equal(canvasStayMinutes(result.nodes[0], 45), 105);
  assert.equal(createCanvasVisitTime(manual, { startTime: '11:00', endTime: '10:59' }), null);
  assert.equal(createCanvasVisitTime(manual, { startTime: '9:00', endTime: '10:00' }), null);

  const partial = node({ schedule: { startAt: '2026-11-11T00:00:00.000Z', endAt: null, locked: false } });
  assert.equal(canEditCanvasVisitTime(partial), true);
  assert.deepEqual(getCanvasVisitClocks(partial), { startTime: '09:00', endTime: '' });
  assert.deepEqual(createCanvasVisitTime(partial, { startTime: '09:30', endTime: '10:15' }), { startTime: '09:30', endTime: '10:15' });

  const manualRoute = { ...manual, intent: 'route' };
  const undatedGraph = { ...doc([manualRoute]), days: [{ id: id(1), date: null }] };
  const relativeGraph = setCanvasVisitTime(undatedGraph, manualRoute.id, relative);
  const chains = canvasItineraryDays(relativeGraph, [])[0].chains;
  const map = toCanvasMapData(chains, relativeGraph, new Map());
  assert.equal(map.nodes[0].estimatedStartAt, null);
  assert.equal(map.nodes[0].estimatedEndAt, null);
  const datedGraph = setCanvasVisitTime(doc([manualRoute]), manualRoute.id, relative);
  const datedMap = toCanvasMapData(canvasItineraryDays(datedGraph, [])[0].chains, datedGraph, new Map());
  assert.equal(datedMap.nodes[0].estimatedStartAt, '2026-11-11T00:15:00.000Z');
  assert.equal(datedMap.nodes[0].estimatedEndAt, '2026-11-11T02:00:00.000Z');
});

test('relative UTC creation keeps imported endpoint dates across overnight generated schedules and marker 2 stays sticky', () => {
  const overnight = node({ schedule: { startAt: '2026-11-11T12:00:00.000Z', endAt: '2026-11-12T00:00:00.000Z', locked: false } });
  assert.equal(setCanvasVisitTime(doc([overnight]), overnight.id, { startTime: '10:00', endTime: '11:00' }), null);
  const overnightTime = createCanvasVisitTime(overnight, { startTime: '22:00', endTime: '09:00' });
  assert.deepEqual(overnightTime, { startAt: '2026-11-11T13:00:00.000Z', endAt: '2026-11-12T00:00:00.000Z' });
  assert.deepEqual(getCanvasVisitClocks({ ...overnight, visitTime: overnightTime }), { startTime: '22:00', endTime: '09:00' });

  const precise = node({ schedule: { startAt: '2026-11-11T00:00:10.123Z', endAt: '2026-11-11T01:30:45.456Z', locked: false } });
  assert.deepEqual(createCanvasVisitTime(precise, { startTime: '09:30', endTime: '10:30' }), {
    startAt: '2026-11-11T00:30:00.000Z', endAt: '2026-11-11T01:30:45.456Z',
  }, 'an unchanged endpoint retains its existing seconds and milliseconds');
  const subminute = node({ schedule: { startAt: '2026-11-11T00:00:10.123Z', endAt: '2026-11-11T00:00:40.456Z', locked: false } });
  assert.deepEqual(createCanvasVisitTime(subminute, { startTime: '09:00', endTime: '09:00' }), {
    startAt: subminute.schedule.startAt, endAt: subminute.schedule.endAt,
  }, 'same-clock intervals remain valid when preserved timestamps have positive duration');

  const { source: _source, schedule: _schedule, ...manual } = node();
  const relativeDoc = setCanvasVisitTime(doc([manual]), id(3), { startTime: '09:00', endTime: '10:00' });
  const imported = { ...node(), id: id(10) };
  const withImported = { ...relativeDoc, nodes: [...relativeDoc.nodes, imported] };
  const migratedToUtc = setCanvasVisitTime(withImported, id(10), edited);
  assert.equal(migratedToUtc?.visitTimeVersion, 2);
  assert.deepEqual(migratedToUtc?.nodes.find(item => item.id === id(10)).visitTime, edited);
  const merged = mergeCanvasDocuments(relativeDoc, migratedToUtc, relativeDoc).document;
  assert.equal(merged?.visitTimeVersion, 2);
  const markerOnly = { ...relativeDoc, nodes: relativeDoc.nodes.map(({ visitTime: _visitTime, ...item }) => item) };
  assert.equal(mergeCanvasDocuments(relativeDoc, markerOnly, relativeDoc).document?.visitTimeVersion, 2);
});

test('moving only the start preserves exact duration, endpoint dates, and unchanged seconds', () => {
  const overnight = node({ schedule: { startAt: '2026-11-11T12:00:00.000Z', endAt: '2026-11-12T02:00:00.000Z', locked: false } });
  const base = { startAt: '2026-11-11T13:30:10.123Z', endAt: '2026-11-11T16:00:20.456Z' };
  assert.equal(moveCanvasVisitStart(overnight, base, '22:30'), base, 'same wall minute is a precision-preserving no-op');
  const moved = moveCanvasVisitStart(overnight, base, '23:00');
  assert.deepEqual(moved, { startAt: '2026-11-11T14:00:00.000Z', endAt: '2026-11-11T16:30:10.333Z' });
  assert.equal(Date.parse(moved.endAt) - Date.parse(moved.startAt), Date.parse(base.endAt) - Date.parse(base.startAt));
  assert.equal(getCanvasKstDate(moved.startAt), '2026-11-11');
  assert.equal(getCanvasKstDate(moved.endAt), '2026-11-12');

  const sameDay = node({ schedule: { startAt: '2026-11-11T00:00:00Z', endAt: '2026-11-11T14:00:00Z', locked: false } });
  const late = { startAt: '2026-11-11T13:30:00.000Z', endAt: '2026-11-11T13:45:00.000Z' };
  assert.equal(moveCanvasVisitStart(sameDay, late, '23:50'), null, 'movement cannot push the end into another original KST date');
  const { source: _source, schedule: _schedule, ...manual } = node();
  const relative = { startTime: '09:00', endTime: '10:30' };
  assert.deepEqual(moveCanvasVisitStart(manual, relative, '10:00'), { startTime: '10:00', endTime: '11:30' });
  assert.equal(moveCanvasVisitStart(manual, relative, '23:00'), null, 'relative timing cannot wrap past midnight');
  assert.equal(moveCanvasVisitStart(node({ schedule: { ...schedule, locked: true } }), base, '22:45'), null);
});

test('a direct start edit retains the current stay, including after editing the end', () => {
  const { source: _source, schedule: _schedule, ...manual } = node();
  const original = { startTime: '10:00', endTime: '11:15' };
  const shifted = moveCanvasVisitStart(manual, original, '10:15');
  assert.deepEqual(shifted, { startTime: '10:15', endTime: '11:30' });
  const shorter = createCanvasVisitTime({ ...manual, visitTime: shifted }, { startTime: '10:15', endTime: '10:55' });
  assert.deepEqual(moveCanvasVisitStart(manual, shorter, '11:00'), { startTime: '11:00', endTime: '11:40' });
});

test('directly editing the end keeps the prior valid start instant and its sub-minute precision', () => {
  const current = node({ visitTime: { startAt: '2026-11-11T00:00:10.123Z', endAt: '2026-11-11T01:30:45.456Z' } });
  const previous = getCanvasVisitClocks(current);
  const next = createCanvasVisitTime(current, { ...previous, endTime: '10:45' });
  assert.deepEqual(next, { startAt: current.visitTime.startAt, endAt: '2026-11-11T01:45:00.000Z' });
});

test('moving a start rejects a base interval that does not match the node representation', () => {
  const imported = node();
  const relativeBase = { startTime: '09:00', endTime: '10:00' };
  assert.equal(moveCanvasVisitStart(imported, relativeBase, '09:00'), null);

  const { source: _source, schedule: _schedule, ...manual } = node();
  const utcBase = { startAt: schedule.startAt, endAt: schedule.endAt };
  assert.equal(moveCanvasVisitStart(manual, utcBase, '09:00'), null);
});
