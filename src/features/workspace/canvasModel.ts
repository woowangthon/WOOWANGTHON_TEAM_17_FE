export type CanvasColor = 'default' | 'lime' | 'sky' | 'rose' | 'amber';
export type CanvasDay = { id: string; date: string | null };
export type CanvasPlaceNode = { id: string; kind: 'place'; dayId: string; position: { x: number; y: number }; color: CanvasColor; contentid: number; intent: 'route' | 'candidate' };
export type CanvasCommentNode = { id: string; kind: 'comment'; dayId: string; position: { x: number; y: number }; color: CanvasColor; text: string };
export type CanvasNode = CanvasPlaceNode | CanvasCommentNode;
export type CanvasEdge = { id: string; source: string; target: string };
export type CanvasDocument = { schemaVersion: 3; days: CanvasDay[]; nodes: CanvasNode[]; edges: CanvasEdge[] };
export type CanvasPlaceDetail = { contentid: number; title: string; address: string | null; adminCity: string | null; category: string | null; planningRole: string | null; coordinate: { latitude: number; longitude: number; crs: 'WGS84' } | null; overviewText: string | null; menuText: string | null; openingHoursText: string | null; closedDaysText: string | null; feeText: string | null; bookingText: string | null; parkingText: string | null; tel: string | null; homepageUrl: string | null };
export type CanvasState = { tripId: string; revision: number; document: CanvasDocument; places: CanvasPlaceDetail[]; sourcePlan: { planId: string; versionId: string } | null; updatedAt: string };
export type CanvasEdgeRef = Pick<CanvasEdge, 'source' | 'target'>;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
export const isCanonicalCanvasUuid = uuid;
const date = (value: unknown): value is string => { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false; const parsed = new Date(`${value}T00:00:00Z`); return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value; };
const colors: CanvasColor[] = ['default', 'lime', 'sky', 'rose', 'amber'];
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
function text(value: unknown, min: number, max: number): value is string {
  if (typeof value !== 'string' || [...value].length < min || [...value].length > max) return false;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    if ((unit < 0x20 && unit !== 0x0a) || (unit >= 0x7f && unit <= 0x9f) || unit === 0x2028 || unit === 0x2029) return false;
  }
  return true;
}
export const safeCanvasText = (value: unknown, max: number): value is string => text(value, 0, max);

export function canConnectRoute(source: string, target: string, nodeDays: Map<string, string>, edges: CanvasEdgeRef[]): boolean {
  if (!source || !target || source === target || !nodeDays.has(source) || nodeDays.get(source) !== nodeDays.get(target)) return false;
  if (edges.some((edge) => edge.source === source || edge.target === target)) return false;
  const next = new Map<string, string[]>();
  edges.forEach((edge) => next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target]));
  const pending = [target]; const seen = new Set<string>();
  while (pending.length) { const current = pending.pop(); if (!current || seen.has(current)) continue; if (current === source) return false; seen.add(current); pending.push(...(next.get(current) ?? [])); }
  return true;
}

export function parseCanvasDocument(value: unknown): CanvasDocument | null {
  if (!isRecord(value) || !keys(value, ['schemaVersion', 'days', 'nodes', 'edges']) || value.schemaVersion !== 3 || !Array.isArray(value.days) || value.days.length < 1 || value.days.length > 31 || !Array.isArray(value.nodes) || value.nodes.length > 100 || !Array.isArray(value.edges) || value.edges.length > 100) return null;
  try { if (new TextEncoder().encode(JSON.stringify(value)).length > 200_000) return null; } catch { return null; }
  const days: CanvasDay[] = []; const dayIds = new Set<string>(); const dayDates = new Set<string>();
  for (const item of value.days) { if (!isRecord(item) || !keys(item, ['id', 'date']) || !uuid(item.id) || dayIds.has(item.id) || (item.date !== null && (!date(item.date) || dayDates.has(item.date)))) return null; dayIds.add(item.id); if (item.date !== null) dayDates.add(item.date); days.push({ id: item.id, date: item.date as string | null }); }
  const nodes: CanvasNode[] = []; const nodeIds = new Set<string>();
  for (const item of value.nodes) {
    if (!isRecord(item) || !uuid(item.id) || nodeIds.has(item.id) || !uuid(item.dayId) || !dayIds.has(item.dayId) || !isRecord(item.position) || !keys(item.position, ['x', 'y']) || typeof item.position.x !== 'number' || !Number.isFinite(item.position.x) || Math.abs(item.position.x) > 100000 || typeof item.position.y !== 'number' || !Number.isFinite(item.position.y) || Math.abs(item.position.y) > 100000 || !colors.includes(item.color as CanvasColor)) return null;
    if (item.kind === 'place' && keys(item, ['id', 'kind', 'dayId', 'position', 'color', 'contentid', 'intent']) && typeof item.contentid === 'number' && Number.isInteger(item.contentid) && item.contentid >= -2147483648 && item.contentid <= 2147483647 && (item.intent === 'route' || item.intent === 'candidate')) nodes.push({ id: item.id, kind: 'place', dayId: item.dayId, position: { x: item.position.x, y: item.position.y }, color: item.color as CanvasColor, contentid: item.contentid, intent: item.intent });
    else if (item.kind === 'comment' && keys(item, ['id', 'kind', 'dayId', 'position', 'color', 'text']) && typeof item.text === 'string' && text(item.text, 1, 1000) && item.text.trim()) nodes.push({ id: item.id, kind: 'comment', dayId: item.dayId, position: { x: item.position.x, y: item.position.y }, color: item.color as CanvasColor, text: item.text });
    else return null;
    nodeIds.add(item.id);
  }
  const edges: CanvasEdge[] = []; const edgeIds = new Set<string>(); const placeNodes = new Map(nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place').map((node) => [node.id, node.dayId]));
  for (const edge of value.edges) { if (!isRecord(edge) || !keys(edge, ['id', 'source', 'target']) || !uuid(edge.id) || edgeIds.has(edge.id) || !uuid(edge.source) || !uuid(edge.target) || !canConnectRoute(edge.source, edge.target, placeNodes, edges)) return null; edgeIds.add(edge.id); edges.push({ id: edge.id, source: edge.source, target: edge.target }); }
  return { schemaVersion: 3, days, nodes, edges };
}

export function mergeCanvasDocuments(base: CanvasDocument, local: CanvasDocument, remote: CanvasDocument, conflictChoice?: 'local' | 'remote'): { document: CanvasDocument | null; conflicts: string[] } {
  const conflicts: string[] = [];
  const mergeFields = <T extends { id: string }>(kind: string, b: T[], l: T[], r: T[]): T[] => {
    const bm = new Map(b.map((x) => [x.id, x])); const lm = new Map(l.map((x) => [x.id, x])); const rm = new Map(r.map((x) => [x.id, x])); const out: T[] = [];
    for (const id of new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])) {
      const bv = bm.get(id); const lv = lm.get(id); const rv = rm.get(id); const path = `${kind}:${id}`;
      if (same(lv, bv)) { if (rv) out.push(rv); continue; }
      if (same(rv, bv) || same(lv, rv)) { if (lv) out.push(lv); continue; }
      if (!bv) { if (lv && rv) { if (same(lv, rv)) out.push(lv); else conflicts.push(`${path}:add`); } else if (lv || rv) out.push((lv ?? rv)!); continue; }
      if (!lv || !rv) { if (conflictChoice) { const chosen = conflictChoice === 'local' ? lv : rv; if (chosen) out.push(chosen); continue; } conflicts.push(`${path}:delete`); continue; }
      const merged = { ...bv } as Record<string, unknown>; const br = bv as Record<string, unknown>; const lr = lv as Record<string, unknown>; const rr = rv as Record<string, unknown>;
      for (const key of new Set([...Object.keys(br), ...Object.keys(lr), ...Object.keys(rr)])) {
        if (same(lr[key], br[key])) merged[key] = rr[key]; else if (same(rr[key], br[key]) || same(lr[key], rr[key])) merged[key] = lr[key]; else if (conflictChoice) merged[key] = conflictChoice === 'local' ? lr[key] : rr[key]; else conflicts.push(`${path}.${key}`);
      }
      out.push(merged as T);
    }
    return out;
  };
  const days = mergeFields('day', base.days, local.days, remote.days); const nodes = mergeFields('node', base.nodes, local.nodes, remote.nodes); const edges = mergeFields('edge', base.edges, local.edges, remote.edges);
  const doc = parseCanvasDocument({ schemaVersion: 3, days, nodes, edges });
  if (!doc) conflicts.push('graph:invalid');
  return { document: conflicts.length ? null : doc, conflicts };
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
