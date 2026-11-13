import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasItineraryChecks, canvasItineraryDays, canvasItineraryReviewDays, canvasItineraryReviewSummary, canvasPlaceSearchUrl, toCanvasMapData } from '../src/features/workspace/canvasItineraryModel.ts';

const day = { id: 'day-a', date: '2026-11-14' };
const place = (id, contentid, intent = 'route', dayId = day.id) => ({ id, kind: 'place', dayId, contentid, intent, position: { x: 0, y: 0 }, color: 'default' });
const document = (nodes, edges) => ({ schemaVersion: 3, days: [day], nodes, edges });
const route = (status, geometry = []) => ({ sourceContentid: 1, targetContentid: 2, conditionsVersion: 4, mode: 'car', status, durationSeconds: status === 'verified' ? 90 : null, distanceMeters: status === 'verified' ? 100 : null, checkedAt: '2026-11-12T00:00:00Z', reasonCodes: [], geometry });
const checks = (graph, places = [], options = {}) => canvasItineraryChecks({
  days: canvasItineraryDays(graph, places), document: graph, routesByEdge: new Map(), phasesByEdge: new Map(), placePhases: new Map(),
  edgeOverrides: new Map(), commonMode: 'car', conditionsVersion: 4, preview: false, ...options,
});

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
  assert.deepEqual(toCanvasMapData(days.map(item => item.chains).flat(), graph, new Map()).edges, []);
});

test('review date scope falls back to all dates for null, invalid, or deleted selection', () => {
  const dayB = { id: 'day-b', date: '2026-11-15' };
  const graph = { schemaVersion: 3, days: [day, dayB], nodes: [place('a', 1), place('b', 2, 'route', dayB.id)], edges: [] };
  const days = canvasItineraryDays(graph, []);
  assert.deepEqual(canvasItineraryReviewDays(days, 'day-b').map(item => item.id), ['day-b']);
  for (const selected of [null, 'missing', 'deleted']) assert.deepEqual(canvasItineraryReviewDays(days, selected).map(item => item.id), [day.id, dayB.id]);
});

test('review projection copies visible objects and assigns one sequential order across days and disconnected chains', () => {
  const dayB = { id: 'day-b', date: '2026-11-15' };
  const dayC = { id: 'day-c', date: '2026-11-16' };
  const graph = { schemaVersion: 3, days: [day, dayB, dayC], nodes: [place('a', 1), place('b', 2), place('c', 3), place('dup', 1, 'route', dayB.id)], edges: [{ id: 'e1', source: 'a', target: 'b' }] };
  const original = canvasItineraryDays(graph, [{ contentid: 1, title: 'same place' }]);
  const projected = canvasItineraryReviewDays(original, null);
  assert.deepEqual(projected.flatMap(item => item.stops).map(stop => [stop.node.id, stop.order]), [['a', 1], ['b', 2], ['c', 3], ['dup', 4]]);
  assert.notEqual(projected[0], original[0]);
  assert.notEqual(projected[0].chains[0], original[0].chains[0]);
  assert.notEqual(projected[0].stops[0], original[0].stops[0]);
  assert.equal(original[1].stops[0].order, 1);
  assert.deepEqual(projected[2], { id: dayC.id, date: dayC.date, chains: [], stops: [] });
});

test('summary counts repeated visits and fee prose as coverage without parsing or totaling prices', () => {
  const graph = document([place('a', 1), place('repeat', 1)], [{ id: 'e1', source: 'a', target: 'repeat' }]);
  const details = [
    { contentid: 1, title: 'A', address: null, adminCity: null, category: null, planningRole: null, coordinate: null, overviewText: null, menuText: null, openingHoursText: null, closedDaysText: null, feeText: 'Free entry', priceLabel: null, bookingText: null, parkingText: null, tel: null, homepageUrl: null, estimatedStayMinutes: 0 },
  ];
  const days = canvasItineraryDays(graph, details);
  const summary = canvasItineraryReviewSummary({ days, document: graph, routesByEdge: new Map(), edgeOverrides: new Map(), commonMode: 'car', conditionsVersion: 4 });
  assert.deepEqual(summary.stay, { knownMinutes: 0, knownCount: 2, totalCount: 2 });
  assert.equal(summary.visitCount, 2);
  assert.equal(summary.feeInfoCount, 2);
  assert.deepEqual(summary.travel, { knownMinutes: 0, knownCount: 0, totalCount: 1, manualCount: 0 });
});

test('review excludes standalone candidates and comments, preserves empty dates, and isolates a selected day summary', () => {
  const dayB = { id: 'day-b', date: '2026-11-15' };
  const dayC = { id: 'day-c', date: '2026-11-16' };
  const graph = { schemaVersion: 3, days: [day, dayB, dayC], nodes: [place('route-a', 1), place('candidate', 2, 'candidate'), place('route-b', 3, 'route', dayB.id), place('orphan', 4, 'candidate'), { id: 'comment', kind: 'comment', dayId: day.id }], edges: [{ id: 'visit', source: 'route-a', target: 'candidate' }] };
  const days = canvasItineraryDays(graph, []);
  assert.deepEqual(days.map(item => item.stops.map(stop => stop.node.id)), [['route-a', 'candidate'], ['route-b'], []]);
  const selected = canvasItineraryReviewDays(days, dayB.id);
  const summary = canvasItineraryReviewSummary({ days: selected, document: graph, routesByEdge: new Map(), edgeOverrides: new Map(), commonMode: 'car', conditionsVersion: 4 });
  assert.deepEqual(summary, { dayCount: 1, visitCount: 1, stay: { knownMinutes: 0, knownCount: 0, totalCount: 1 }, travel: { knownMinutes: 0, knownCount: 0, totalCount: 0, manualCount: 0 }, feeInfoCount: 0 });
});

test('duplicate content IDs on separate dates count as separate visits and whitespace fee text is absent', () => {
  const dayB = { id: 'day-b', date: '2026-11-15' };
  const graph = { schemaVersion: 3, days: [day, dayB], nodes: [place('first-date', 9), place('second-date', 9, 'route', dayB.id), place('no-fee', 10)], edges: [] };
  const details = [
    { contentid: 9, title: 'Repeated place', address: null, adminCity: null, category: null, planningRole: null, coordinate: null, overviewText: null, menuText: null, openingHoursText: null, closedDaysText: null, feeText: '₩10,000–20,000 / €5', priceLabel: null, bookingText: null, parkingText: null, tel: null, homepageUrl: null },
    { contentid: 10, title: 'No fee', address: null, adminCity: null, category: null, planningRole: null, coordinate: null, overviewText: null, menuText: null, openingHoursText: null, closedDaysText: null, feeText: '  \n ', priceLabel: null, bookingText: null, parkingText: null, tel: null, homepageUrl: null },
  ];
  const summary = canvasItineraryReviewSummary({ days: canvasItineraryDays(graph, details), document: graph, routesByEdge: new Map(), edgeOverrides: new Map(), commonMode: 'car', conditionsVersion: 4 });
  assert.equal(summary.visitCount, 3);
  assert.equal(summary.feeInfoCount, 2);
});

test('manual travel minutes take precedence; verified durations need no geometry and round up per leg', () => {
  const graph = document([place('a', 1), place('b', 2), place('c', 3)], [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }]);
  const routes = new Map([['e1', { ...route('verified'), durationSeconds: 90 }], ['e2', { ...route('verified'), sourceContentid: 2, targetContentid: 3, durationSeconds: 1, geometry: [] }]]);
  const summary = canvasItineraryReviewSummary({ days: canvasItineraryDays(graph, []), document: graph, routesByEdge: routes,
    edgeOverrides: new Map([['e1', { modeOverride: null, manualMinutes: 7 }]]), commonMode: 'car', conditionsVersion: 4 });
  assert.deepEqual(summary.travel, { knownMinutes: 8, knownCount: 2, totalCount: 2, manualCount: 1 });
});

test('effective mode override accepts only a matching route; an old common-mode route stays unknown', () => {
  const graph = document([place('a', 1), place('b', 2)], [{ id: 'e', source: 'a', target: 'b' }]);
  const override = new Map([['e', { modeOverride: 'walk', manualMinutes: null }]]);
  const walkRoute = { ...route('verified'), mode: 'walk', durationSeconds: 61 };
  const accepted = canvasItineraryReviewSummary({ days: canvasItineraryDays(graph, []), document: graph, routesByEdge: new Map([['e', walkRoute]]), edgeOverrides: override, commonMode: 'car', conditionsVersion: 4 });
  assert.deepEqual(accepted.travel, { knownMinutes: 2, knownCount: 1, totalCount: 1, manualCount: 0 });
  const staleCommon = canvasItineraryReviewSummary({ days: canvasItineraryDays(graph, []), document: graph, routesByEdge: new Map([['e', route('verified')]]), edgeOverrides: override, commonMode: 'car', conditionsVersion: 4 });
  assert.deepEqual(staleCommon.travel, { knownMinutes: 0, knownCount: 0, totalCount: 1, manualCount: 0 });
});

test('null conditions keep auto time unknown, while zero duration is known and missing duration is not', () => {
  const graph = document([place('a', 1), place('b', 2), place('c', 3)], [{ id: 'zero', source: 'a', target: 'b' }, { id: 'missing', source: 'b', target: 'c' }]);
  const days = canvasItineraryDays(graph, []);
  const routes = new Map([['zero', { ...route('verified'), durationSeconds: 0 }], ['missing', { ...route('verified'), sourceContentid: 2, targetContentid: 3, durationSeconds: null }]]);
  const withConditions = canvasItineraryReviewSummary({ days, document: graph, routesByEdge: routes, edgeOverrides: new Map(), commonMode: 'car', conditionsVersion: 4 });
  assert.deepEqual(withConditions.travel, { knownMinutes: 0, knownCount: 1, totalCount: 2, manualCount: 0 });
  const withoutConditions = canvasItineraryReviewSummary({ days, document: graph, routesByEdge: new Map([['zero', routes.get('zero')]]), edgeOverrides: new Map(), commonMode: 'car', conditionsVersion: null });
  assert.deepEqual(withoutConditions.travel, { knownMinutes: 0, knownCount: 0, totalCount: 2, manualCount: 0 });
});

test('travel rejects stale endpoints, mode, conditions, invalid manual values, and null conditions', () => {
  const graph = document([place('a', 1), place('b', 2)], [{ id: 'e', source: 'a', target: 'b' }]);
  const days = canvasItineraryDays(graph, []);
  const bad = [
    { ...route('verified'), sourceContentid: 99 },
    { ...route('verified'), mode: 'walk' },
    { ...route('verified'), conditionsVersion: 3 },
    { ...route('verified'), durationSeconds: Number.NaN },
  ];
  for (const item of bad) {
    const summary = canvasItineraryReviewSummary({ days, document: graph, routesByEdge: new Map([['e', item]]), edgeOverrides: new Map(), commonMode: 'car', conditionsVersion: 4 });
    assert.deepEqual(summary.travel, { knownMinutes: 0, knownCount: 0, totalCount: 1, manualCount: 0 });
  }
  const manual = canvasItineraryReviewSummary({ days, document: graph, routesByEdge: new Map(), edgeOverrides: new Map([['e', { modeOverride: null, manualMinutes: 0 }]]), commonMode: 'car', conditionsVersion: null });
  assert.deepEqual(manual.travel, { knownMinutes: 0, knownCount: 0, totalCount: 1, manualCount: 0 });
});

test('keeps missing place records as numbered map placeholders', () => {
  const graph = document([place('a', 1), place('b', 2)], [{ id: 'edge', source: 'a', target: 'b' }]);
  const nodes = toCanvasMapData(canvasItineraryDays(graph, [])[0].chains, graph, new Map()).nodes;
  assert.deepEqual(nodes.map(node => [node.id, node.coordinate, node.title]), [['a', null, '장소 정보 확인 중'], ['b', null, '장소 정보 확인 중']]);
});

test('map projection drops geometry for a verified route with stale endpoint identities', () => {
  const graph = document([place('a', 1), place('b', 2)], [{ id: 'edge', source: 'a', target: 'b' }]);
  const points = [{ latitude: 36.1, longitude: 127.1 }, { latitude: 36.2, longitude: 127.2 }];
  const map = toCanvasMapData(canvasItineraryDays(graph, []).map(item => item.chains).flat(), graph,
    new Map([['edge', { ...route('verified', points), targetContentid: 99 }]]));
  assert.deepEqual(map.edges.map(edge => edge.geometry), [[]]);
});

test('checks distinguish pending route/place work from settled route and detail failures', () => {
  const graph = document([place('a', 1), place('b', 2)], [{ id: 'e', source: 'a', target: 'b' }]);
  const pending = checks(graph, [], { phasesByEdge: new Map([['e', 'loading']]), placePhases: new Map([[1, 'loading'], [2, 'loading']]) });
  assert.equal(pending.pendingRouteCount, 1);
  assert.equal(pending.pendingPlaceCount, 2);
  assert.deepEqual(pending.visits.map(visit => [visit.nodeId, visit.state, visit.pendingKinds]), [['a', 'loading', ['place-detail', 'route-time']], ['b', 'loading', ['place-detail']]]);
  const failed = checks(graph, [], { phasesByEdge: new Map([['e', 'error']]), placePhases: new Map([[1, 'error'], [2, 'ready']]) });
  assert.deepEqual(failed.findings.map(item => [item.kind, item.nodeId, item.edgeId]), [['place-detail', 'a', null], ['route-time', 'a', 'e'], ['place-detail', 'b', null]]);
});

test('checks accept manual minutes, current zero-minute routes without geometry, and reject stale route identities', () => {
  const graph = document([place('a', 1), place('b', 2)], [{ id: 'e', source: 'a', target: 'b' }]);
  const manual = checks(graph, [{ contentid: 1, coordinate: { latitude: 36, longitude: 127, crs: 'WGS84' } }, { contentid: 2, coordinate: { latitude: 36, longitude: 127, crs: 'WGS84' } }], {
    phasesByEdge: new Map([['e', 'error']]), edgeOverrides: new Map([['e', { modeOverride: null, manualMinutes: 12 }]]),
  });
  assert.deepEqual([manual.findings.length, manual.pendingRouteCount, manual.pendingPlaceCount], [0, 0, 0]);
  assert.deepEqual(manual.visits.map(visit => [visit.nodeId, visit.state]), [['a', 'complete'], ['b', 'complete']]);
  const zeroRoute = { ...route('verified'), durationSeconds: 0, geometry: [] };
  const current = checks(graph, [{ contentid: 1, coordinate: { latitude: 36, longitude: 127, crs: 'WGS84' } }, { contentid: 2, coordinate: { latitude: 36, longitude: 127, crs: 'WGS84' } }], {
    phasesByEdge: new Map([['e', 'ready']]), routesByEdge: new Map([['e', zeroRoute]]),
  });
  assert.deepEqual([current.findings.length, current.pendingRouteCount, current.pendingPlaceCount], [0, 0, 0]);
  assert.equal(current.visits.every(visit => visit.state === 'complete'), true);
  const cachedButStale = checks(graph, [], { phasesByEdge: new Map([['e', 'stale']]), routesByEdge: new Map([['e', zeroRoute]]) });
  assert.deepEqual(cachedButStale.findings.map(finding => finding.kind), ['route-time']);
  for (const stale of [{ ...zeroRoute, targetContentid: 9 }, { ...zeroRoute, mode: 'walk' }, { ...zeroRoute, conditionsVersion: 3 }]) {
    const result = checks(graph, [], { phasesByEdge: new Map([['e', 'ready']]), routesByEdge: new Map([['e', stale]]) });
    assert.deepEqual(result.findings.map(finding => finding.kind), ['route-time']);
  }
});

test('checks report no-condition auto travel as settled and preview omits unrequested work', () => {
  const graph = document([place('a', 1), place('b', 2)], [{ id: 'e', source: 'a', target: 'b' }]);
  const noConditions = checks(graph, [], { conditionsVersion: null });
  assert.deepEqual(noConditions.findings.map(finding => finding.kind), ['route-time']);
  assert.equal(noConditions.pendingRouteCount, 0);
  const preview = checks(graph, [], { preview: true });
  assert.deepEqual([preview.findings.length, preview.pendingRouteCount, preview.pendingPlaceCount], [0, 0, 0]);
  assert.equal(preview.visits.every(visit => visit.state === 'preview'), true);
});

test('checks use only selected day visit chains, count repeated visits, and flag additional chains without synthetic edges', () => {
  const dayB = { id: 'day-b', date: '2026-11-15' };
  const graph = { schemaVersion: 3, days: [day, dayB], nodes: [place('a', 1), place('b', 2), place('repeat', 1, 'route', dayB.id), place('orphan', 3, 'candidate'), { id: 'comment', kind: 'comment', dayId: day.id }], edges: [{ id: 'cross', source: 'a', target: 'repeat' }] };
  const all = checks(graph);
  assert.deepEqual(all.findings.filter(finding => finding.kind === 'disconnected').map(finding => [finding.dayId, finding.nodeId]), [[day.id, 'b']]);
  assert.equal(all.visits.find(visit => visit.nodeId === 'b').findings.some(finding => finding.kind === 'disconnected'), true);
  assert.notEqual(all.visits.find(visit => visit.nodeId === 'b').state, 'needs-review');
  assert.equal(all.findings.filter(finding => finding.kind === 'route-time').length, 0);
  const selected = checks({ ...graph, days: [dayB], nodes: graph.nodes.filter(node => node.dayId === dayB.id), edges: [] });
  assert.equal(selected.findings.some(finding => finding.kind === 'disconnected'), false);
});

test('per-visit checks include completed visits and attach each route-time issue to its source visit', () => {
  const graph = document([place('start', 1), place('finish', 2)], [{ id: 'e', source: 'start', target: 'finish' }]);
  const result = checks(graph, [{ contentid: 1, coordinate: { latitude: 36, longitude: 127, crs: 'WGS84' } }, { contentid: 2, coordinate: { latitude: 36, longitude: 127, crs: 'WGS84' } }], {
    phasesByEdge: new Map([['e', 'error']]),
  });
  assert.deepEqual(result.visits.map(visit => [visit.nodeId, visit.state, visit.findings.map(finding => finding.kind)]), [
    ['start', 'needs-review', ['route-time']], ['finish', 'complete', []],
  ]);
});

test('checks flag bad coordinates separately from failed place details and ignore coordinates when details are missing', () => {
  const graph = document([place('bad', 1), place('missing', 2)], [{ id: 'link', source: 'bad', target: 'missing' }]);
  const result = checks(graph, [{ contentid: 1, coordinate: { latitude: 91, longitude: 127, crs: 'WGS84' } }], { placePhases: new Map([[2, 'error']]) });
  assert.deepEqual(result.findings.map(finding => [finding.kind, finding.nodeId]), [['location', 'bad'], ['place-detail', 'missing']]);
});

test('place search URLs require a title and encode only allowlisted public place fields', () => {
  assert.equal(canvasPlaceSearchUrl(null), null);
  assert.equal(canvasPlaceSearchUrl({ title: '   ', address: 'secret address', adminCity: 'private city' }), null);
  const url = new URL(canvasPlaceSearchUrl({
    title: '카페 A & "B"?', address: '충청북도 제천시', adminCity: '제천시',
    roomName: 'SECRET_ROOM', tripId: 'SECRET_TRIP', privateNote: 'SECRET_NOTE',
  }, 'location'));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'search.naver.com');
  assert.equal(url.pathname, '/search.naver');
  assert.deepEqual([...url.searchParams.keys()], ['query']);
  assert.equal(url.searchParams.get('query'), '카페 A & "B"? 제천시 충청북도 제천시 위치');
  assert.doesNotMatch(url.href, /SECRET_ROOM|SECRET_TRIP|SECRET_NOTE/u);
  assert.equal(new URL(canvasPlaceSearchUrl({ title: '숙소', address: null, adminCity: null }, 'fee')).searchParams.get('query'), '숙소 요금');
});
