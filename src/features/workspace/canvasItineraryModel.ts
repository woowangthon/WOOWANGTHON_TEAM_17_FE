import type { Plan, RoutePoint } from '../generation/generationApi.ts';
import type { CanvasDocument, CanvasPlaceDetail, CanvasPlaceNode } from './canvasModel.ts';
import type { CanvasRoute, CanvasTravelMode } from './canvasRoutes.ts';
import type { CanvasEdgeOverride } from './canvasEdgePreferences.ts';

export type CanvasItineraryStop = { node: CanvasPlaceNode; place: CanvasPlaceDetail | null; order: number };
export type CanvasItineraryChain = { id: string; stops: CanvasItineraryStop[]; connected: boolean };
export type CanvasItineraryDay = { id: string; date: string | null; chains: CanvasItineraryChain[]; stops: CanvasItineraryStop[] };
export type CanvasItineraryCoverage = { knownMinutes: number; knownCount: number; totalCount: number };
export type CanvasItineraryReviewSummary = {
  dayCount: number;
  visitCount: number;
  stay: CanvasItineraryCoverage;
  travel: CanvasItineraryCoverage & { manualCount: number };
  feeInfoCount: number;
};
export type CanvasReviewFinding = { id: string; kind: 'route-time' | 'location' | 'disconnected' | 'place-detail'; dayId: string; nodeId: string; edgeId: string | null };
export type CanvasReviewVisit = { nodeId: string; dayId: string; state: 'complete' | 'needs-review' | 'loading' | 'preview'; findings: CanvasReviewFinding[]; pendingKinds: ('place-detail' | 'route-time')[] };
export type CanvasReviewChecks = { findings: CanvasReviewFinding[]; pendingRouteCount: number; pendingPlaceCount: number; visits: CanvasReviewVisit[] };

/** Builds a public search URL from explicitly allowlisted place fields only. */
export function canvasPlaceSearchUrl(
  place: Pick<CanvasPlaceDetail, 'title' | 'address' | 'adminCity'> | null | undefined,
  purpose: 'fee' | 'location' = 'fee',
): string | null {
  const title = place?.title?.trim();
  if (!place || !title) return null;
  const context = purpose === 'fee' ? '요금' : '위치';
  const query = [title, place.adminCity?.trim(), place.address?.trim(), context].filter((part): part is string => !!part).join(' ');
  const params = new URLSearchParams({ query });
  return `https://search.naver.com/search.naver?${params.toString()}`;
}

/** Reviews only the visible visit chains and reports current blockers separately from work in progress. */
export function canvasItineraryChecks(input: {
  days: readonly CanvasItineraryDay[];
  document: CanvasDocument;
  routesByEdge: ReadonlyMap<string, CanvasRoute>;
  phasesByEdge: ReadonlyMap<string, 'loading' | 'ready' | 'error' | 'stale'>;
  placePhases: ReadonlyMap<number, 'loading' | 'ready' | 'error'>;
  edgeOverrides: ReadonlyMap<string, CanvasEdgeOverride>;
  commonMode: CanvasTravelMode;
  conditionsVersion: number | null;
  preview: boolean;
}): CanvasReviewChecks {
  const findings: CanvasReviewFinding[] = [];
  const visits: CanvasReviewVisit[] = [];
  let pendingRouteCount = 0; let pendingPlaceCount = 0;
  const add = (kind: CanvasReviewFinding['kind'], dayId: string, nodeId: string, edgeId: string | null) => {
    const finding = { id: `${kind}:${dayId}:${nodeId}:${edgeId ?? ''}`, kind, dayId, nodeId, edgeId };
    findings.push(finding);
    return finding;
  };
  const placeNodes = new Map(input.document.nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place').map(node => [node.id, node]));
  const manualValid = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440;
  const validCoordinate = (place: CanvasPlaceDetail) => {
    const coordinate = place.coordinate;
    return !!coordinate && coordinate.crs === 'WGS84' && Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude)
      && Math.abs(coordinate.latitude) <= 90 && Math.abs(coordinate.longitude) <= 180;
  };
  for (const day of input.days) {
    day.chains.forEach((chain, chainIndex) => {
      for (let index = 0; index < chain.stops.length; index += 1) {
        const stop = chain.stops[index];
        const visitFindings: CanvasReviewFinding[] = [];
        const pendingKinds: ('place-detail' | 'route-time')[] = [];
        if (index === 0 && chainIndex > 0) visitFindings.push(add('disconnected', day.id, stop.node.id, null));
        if (stop.place) {
          if (!validCoordinate(stop.place)) visitFindings.push(add('location', day.id, stop.node.id, null));
        } else {
          const phase = input.placePhases.get(stop.node.contentid);
          if (phase === 'error' || phase === 'ready') visitFindings.push(add('place-detail', day.id, stop.node.id, null));
          else if (phase === 'loading' || (!input.preview && phase === undefined)) {
            pendingPlaceCount += 1;
            pendingKinds.push('place-detail');
          }
        }
        if (index + 1 < chain.stops.length) {
          const source = stop.node; const target = chain.stops[index + 1].node;
          const edge = input.document.edges.find(item => item.source === source.id && item.target === target.id
            && placeNodes.get(item.source)?.dayId === day.id && placeNodes.get(item.target)?.dayId === day.id);
          if (edge && !manualValid(input.edgeOverrides.get(edge.id)?.manualMinutes)) {
            const phase = input.phasesByEdge.get(edge.id);
            if (phase === 'loading') {
              pendingRouteCount += 1;
              pendingKinds.push('route-time');
            } else if (phase === 'error' || phase === 'stale') visitFindings.push(add('route-time', day.id, source.id, edge.id));
            else if (!(input.preview && phase === undefined)) {
              const route = phase === 'ready' ? input.routesByEdge.get(edge.id) : undefined;
              const effectiveMode = input.edgeOverrides.get(edge.id)?.modeOverride ?? input.commonMode;
              const current = input.conditionsVersion !== null && route?.status === 'verified'
                && typeof route.durationSeconds === 'number' && Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0
                && route.sourceContentid === source.contentid && route.targetContentid === target.contentid
                && route.mode === effectiveMode && route.conditionsVersion === input.conditionsVersion;
              if (!current) {
                if (input.conditionsVersion === null || phase === 'ready') visitFindings.push(add('route-time', day.id, source.id, edge.id));
                else if (!input.preview) {
                  pendingRouteCount += 1;
                  pendingKinds.push('route-time');
                }
              }
            }
          }
        }
        const hasActionableFinding = visitFindings.some(finding => finding.kind !== 'disconnected');
        visits.push({ nodeId: stop.node.id, dayId: day.id,
          state: input.preview ? 'preview' : hasActionableFinding ? 'needs-review' : pendingKinds.length ? 'loading' : 'complete',
          findings: visitFindings, pendingKinds: [...new Set(pendingKinds)] });
      }
    });
  }
  return { findings, pendingRouteCount, pendingPlaceCount, visits };
}
/** Returns an immutable review projection, with visit numbering restarted for the selected scope. */
export function canvasItineraryReviewDays(days: readonly CanvasItineraryDay[], activeDayId: string | null): CanvasItineraryDay[] {
  const scoped = activeDayId !== null && days.some(day => day.id === activeDayId) ? days.filter(day => day.id === activeDayId) : days;
  let order = 0;
  return scoped.map(day => {
    const chains = day.chains.map(chain => ({
      ...chain,
      stops: chain.stops.map(stop => ({ ...stop, node: { ...stop.node }, place: stop.place ? { ...stop.place } : null, order: ++order })),
    }));
    return { ...day, chains, stops: chains.flatMap(chain => chain.stops) };
  });
}

/** Summarizes only known place stays and explicit same-day route legs in the visible chains. */
export function canvasItineraryReviewSummary(input: {
  days: readonly CanvasItineraryDay[];
  document: CanvasDocument;
  routesByEdge: ReadonlyMap<string, CanvasRoute>;
  edgeOverrides: ReadonlyMap<string, CanvasEdgeOverride>;
  commonMode: CanvasTravelMode;
  conditionsVersion: number | null;
}): CanvasItineraryReviewSummary {
  const visibleDays = canvasItineraryReviewDays(input.days, null);
  const nodes = new Map(input.document.nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place').map(node => [node.id, node]));
  let stayKnown = 0; let stayCount = 0; let feeInfoCount = 0;
  let travelKnown = 0; let travelKnownCount = 0; let travelCount = 0; let manualCount = 0;
  const validManual = (minutes: number | null | undefined): minutes is number => typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440;
  for (const day of visibleDays) for (const stop of day.stops) {
    const place = stop.place;
    const stay = place?.estimatedStayMinutes;
    if (typeof stay === 'number' && Number.isFinite(stay) && stay >= 0) { stayKnown += stay; stayCount += 1; }
    if (place && [place.priceLabel, place.feeText].some(value => typeof value === 'string' && value.trim().length > 0)) feeInfoCount += 1;
  }
  for (const day of visibleDays) for (const chain of day.chains) {
    for (let index = 0; index + 1 < chain.stops.length; index += 1) {
      const source = chain.stops[index].node; const target = chain.stops[index + 1].node;
      const edge = input.document.edges.find(item => item.source === source.id && item.target === target.id
        && nodes.get(item.source)?.dayId === day.id && nodes.get(item.target)?.dayId === day.id);
      if (!edge) continue;
      travelCount += 1;
      const override = input.edgeOverrides.get(edge.id);
      if (validManual(override?.manualMinutes)) { travelKnown += override.manualMinutes; travelKnownCount += 1; manualCount += 1; continue; }
      const mode = override?.modeOverride ?? input.commonMode;
      if (input.conditionsVersion === null) continue;
      const route = input.routesByEdge.get(edge.id);
      if (route?.status !== 'verified' || !Number.isFinite(route.durationSeconds) || route.durationSeconds === null || route.durationSeconds < 0
        || route.sourceContentid !== source.contentid || route.targetContentid !== target.contentid
        || route.mode !== mode || route.conditionsVersion !== input.conditionsVersion) continue;
      travelKnown += Math.ceil(route.durationSeconds / 60); travelKnownCount += 1;
    }
  }
  return { dayCount: visibleDays.length, visitCount: visibleDays.reduce((count, day) => count + day.stops.length, 0),
    stay: { knownMinutes: stayKnown, knownCount: stayCount, totalCount: visibleDays.reduce((count, day) => count + day.stops.length, 0) },
    travel: { knownMinutes: travelKnown, knownCount: travelKnownCount, totalCount: travelCount, manualCount },
    feeInfoCount };
}

export function canvasItineraryDays(document: CanvasDocument, places: CanvasPlaceDetail[]): CanvasItineraryDay[] {
  const details = new Map(places.map(place => [place.contentid, place]));
  return document.days.map(day => {
    const dayPlaces = document.nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place' && node.dayId === day.id);
    const connectedIds = new Set(document.edges.flatMap(edge => [edge.source, edge.target]));
    const nodes = dayPlaces.filter(node => node.intent === 'route' || connectedIds.has(node.id));
    const ids = new Set(nodes.map(node => node.id));
    const edges = document.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    const outgoing = new Map(edges.map(edge => [edge.source, edge.target]));
    const incoming = new Set(edges.map(edge => edge.target));
    const visited = new Set<string>();
    const chains: CanvasPlaceNode[][] = [];
    const walk = (start: CanvasPlaceNode) => {
      const chain: CanvasPlaceNode[] = [];
      let current: CanvasPlaceNode | undefined = start;
      while (current && !visited.has(current.id)) {
        visited.add(current.id); chain.push(current);
        const nextId = outgoing.get(current.id);
        current = nextId ? nodes.find(node => node.id === nextId) : undefined;
      }
      if (chain.length) chains.push(chain);
    };
    nodes.filter(node => !incoming.has(node.id)).forEach(walk);
    nodes.forEach(node => { if (!visited.has(node.id)) walk(node); });
    let order = 0;
    const result = chains.map(chain => ({ id: chain[0].id, connected: chain.length > 1,
      stops: chain.map(node => ({ node, place: details.get(node.contentid) ?? null, order: ++order })) }));
    return { id: day.id, date: day.date, chains: result, stops: result.flatMap(chain => chain.stops) };
  });
}

function currentVerifiedGeometry(route: CanvasRoute | undefined, sourceContentid: number, targetContentid: number): RoutePoint[] {
  if (route?.status !== 'verified' || route.sourceContentid !== sourceContentid || route.targetContentid !== targetContentid) return [];
  const points = (route as CanvasRoute & { geometry?: RoutePoint[] }).geometry;
  if (!Array.isArray(points) || points.length < 2 || !points.every(point => point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180)) return [];
  return points.map(point => ({ latitude: point.latitude, longitude: point.longitude }));
}

/** Projects explicit canvas links; only a current verified route with real geometry creates a map line. */
export function toCanvasMapData(chains: CanvasItineraryChain[], document: CanvasDocument, routesByEdge: ReadonlyMap<string, CanvasRoute>): {
  nodes: Plan['document']['days'][number]['nodes']; edges: Plan['document']['days'][number]['edges'];
} {
  const stops = chains.flatMap(chain => chain.stops);
  const nodes = stops.map(({ node, place }) => ({ id: node.id, nodeKey: String(node.contentid), kind: 'PLACE' as const,
    contentid: node.contentid, title: place?.title ?? '장소 정보 확인 중', coordinate: place?.coordinate ?? null,
    estimatedStartAt: node.schedule?.startAt ?? null, estimatedEndAt: node.schedule?.endAt ?? null,
    estimatedCostKrw: null, feeLabel: place?.priceLabel ?? place?.feeText ?? '비용 미확인',
    stayMinutes: place?.estimatedStayMinutes ?? null, locked: node.schedule?.locked ?? false }));
  const ids = new Set(nodes.map(node => node.id));
  const nodeDays = new Map(stops.map(stop => [stop.node.id, stop.node.dayId]));
  const stopNodes = new Map(stops.map(stop => [stop.node.id, stop.node]));
  const edges = document.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && nodeDays.get(edge.source) === nodeDays.get(edge.target)).map(edge => {
    const route = routesByEdge.get(edge.id);
    return { id: edge.id, fromNodeId: edge.source, toNodeId: edge.target, status: route?.status ?? 'unknown' as const,
      geometry: currentVerifiedGeometry(route, stopNodes.get(edge.source)!.contentid, stopNodes.get(edge.target)!.contentid), reasonCodes: route?.reasonCodes ?? ['ROUTE_NOT_AVAILABLE'] };
  });
  return { nodes, edges };
}
