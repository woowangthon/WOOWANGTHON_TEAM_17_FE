export type CanvasRouteEdge = { source: string; target: string };
export type CanvasPlace = { name: string; area: string; note: string; day: number };
export type StoredCanvasNode = { id: string; position: { x: number; y: number }; data: { place: CanvasPlace; intent: 'route' | 'candidate' } };
export type CanvasDocument = { schemaVersion: 2; dayCount: number; nodes: StoredCanvasNode[]; edges: Array<CanvasRouteEdge & { id: string }> };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const safeCanvasText = (value: unknown, max: number): value is string => typeof value === 'string' && [...value].length <= max && ![...value].some((character) => { const code = character.codePointAt(0) ?? 0; return code < 32 || (code >= 127 && code <= 159); });
const safeText = safeCanvasText;

/** Restore only bounded, known canvas data; never library styles or arbitrary node types. */
export function parseCanvasDocument(value: unknown): CanvasDocument | null {
  if (!isRecord(value) || value.schemaVersion !== 2 || !Number.isInteger(value.dayCount) || (value.dayCount as number) < 1 || (value.dayCount as number) > 31 || !Array.isArray(value.nodes) || value.nodes.length > 100 || !Array.isArray(value.edges) || value.edges.length > 100) return null;
  const nodes: StoredCanvasNode[] = [];
  const ids = new Set<string>();
  for (const item of value.nodes) {
    if (!isRecord(item) || !safeText(item.id, 100) || !item.id || ids.has(item.id) || !isRecord(item.position) || !isRecord(item.data) || !isRecord(item.data.place)) return null;
    const { x, y } = item.position;
    const place = item.data.place;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 100_000 || Math.abs(y) > 100_000 || !safeText(place.name, 100) || !place.name.trim() || !safeText(place.area, 100) || !safeText(place.note, 500) || !Number.isInteger(place.day) || (place.day as number) < 1 || (place.day as number) > (value.dayCount as number) || (item.data.intent !== 'route' && item.data.intent !== 'candidate')) return null;
    ids.add(item.id);
    nodes.push({ id: item.id, position: { x, y }, data: { intent: item.data.intent, place: { name: place.name, area: place.area, note: place.note, day: place.day as number } } });
  }
  const edges: CanvasDocument['edges'] = [];
  const edgeIds = new Set<string>();
  const days = new Map(nodes.map((node) => [node.id, node.data.place.day]));
  for (const edge of value.edges) {
    if (!isRecord(edge) || !safeText(edge.id, 120) || !edge.id || edgeIds.has(edge.id) || typeof edge.source !== 'string' || typeof edge.target !== 'string' || !canConnectRoute(edge.source, edge.target, days, edges)) return null;
    edgeIds.add(edge.id); edges.push({ id: edge.id, source: edge.source, target: edge.target });
  }
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  for (const node of nodes) if (connected.has(node.id)) node.data.intent = 'route';
  return { schemaVersion: 2, dayCount: value.dayCount as number, nodes, edges };
}

export function canConnectRoute(source: string, target: string, nodeDays: Map<string, number>, edges: CanvasRouteEdge[]): boolean {
  if (!source || !target || source === target) return false;
  const sourceDay = nodeDays.get(source);
  if (sourceDay === undefined || sourceDay !== nodeDays.get(target)) return false;
  if (edges.some((edge) => edge.source === source || edge.target === target)) return false;
  const next = new Map<string, string[]>();
  edges.forEach((edge) => next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]));
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    if (current === source) return false;
    visited.add(current);
    pending.push(...(next.get(current) ?? []));
  }
  return true;
}
