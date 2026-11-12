import type { Plan, RoutePoint } from '../generation/generationApi.ts';
import type { CanvasDocument, CanvasPlaceDetail, CanvasPlaceNode } from './canvasModel.ts';
import type { CanvasRoute } from './canvasRoutes.ts';

export type CanvasItineraryStop = { node: CanvasPlaceNode; place: CanvasPlaceDetail | null; order: number };
export type CanvasItineraryChain = { id: string; stops: CanvasItineraryStop[]; connected: boolean };
export type CanvasItineraryDay = { id: string; date: string | null; chains: CanvasItineraryChain[]; stops: CanvasItineraryStop[] };

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

function currentVerifiedGeometry(route: CanvasRoute | undefined): RoutePoint[] {
  if (route?.status !== 'verified') return [];
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
  const edges = document.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)).map(edge => {
    const route = routesByEdge.get(edge.id);
    return { id: edge.id, fromNodeId: edge.source, toNodeId: edge.target, status: route?.status ?? 'unknown' as const,
      geometry: currentVerifiedGeometry(route), reasonCodes: route?.reasonCodes ?? ['ROUTE_NOT_AVAILABLE'] };
  });
  return { nodes, edges };
}
