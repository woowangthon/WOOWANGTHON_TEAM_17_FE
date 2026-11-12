export type CanvasColor = 'default' | 'lime' | 'sky' | 'rose' | 'amber';
export type CanvasDay = { id: string; date: string | null; position?: { x: number; y: number } };
export type CanvasDayLink = { id: string; source: string; target: string };
export type CanvasPlaceNode = { id: string; kind: 'place'; dayId: string; position: { x: number; y: number }; color: CanvasColor; contentid: number; intent: 'route' | 'candidate'; source?: { planId: string; versionId: string; nodeId: string }; schedule?: { startAt: string | null; endAt: string | null; locked: boolean } };
export type CanvasCommentNode = { id: string; kind: 'comment'; dayId: string; position: { x: number; y: number }; color: CanvasColor; text: string };
export type CanvasNode = CanvasPlaceNode | CanvasCommentNode;
export type CanvasEdge = { id: string; source: string; target: string };
export type CanvasDocumentV3 = { schemaVersion: 3; days: CanvasDay[]; nodes: CanvasNode[]; edges: CanvasEdge[] };
export type CanvasDocumentV4 = { schemaVersion: 4; days: CanvasDay[]; nodes: CanvasNode[]; edges: CanvasEdge[]; dayLinks: CanvasDayLink[] };
export type CanvasDocument = CanvasDocumentV3 | CanvasDocumentV4;
export type CanvasPlaceDetail = { contentid: number; title: string; address: string | null; adminCity: string | null; category: string | null; planningRole: string | null; coordinate: { latitude: number; longitude: number; crs: 'WGS84' } | null; overviewText: string | null; menuText: string | null; openingHoursText: string | null; closedDaysText: string | null; feeText: string | null; priceLabel?: string | null; bookingText: string | null; parkingText: string | null; tel: string | null; homepageUrl: string | null; imageUrl?: string | null; estimatedStayMinutes?: number | null };
export type CanvasState = { tripId: string; revision: number; document: CanvasDocument; places: CanvasPlaceDetail[]; sourcePlan: { planId: string; versionId: string } | null; updatedAt: string };
export type CanvasEdgeRef = Pick<CanvasEdge, 'source' | 'target'>;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
export const isCanonicalCanvasUuid = uuid;
function stableCanvasUuid(seed: string): string {
  const hash = (salt: number) => {
    let value = (0x811c9dc5 ^ salt) >>> 0;
    for (const char of seed) { value ^= char.charCodeAt(0); value = Math.imul(value, 0x01000193) >>> 0; }
    return value.toString(16).padStart(8, '0');
  };
  const first = hash(0); const second = hash(1); const third = hash(2); const fourth = hash(3);
  return `${first}-${second.slice(0, 4)}-5${second.slice(5, 8)}-8${third.slice(1, 4)}-${third.slice(4, 8)}${fourth}`;
}
const validCanvasPosition = (position: unknown): position is { x: number; y: number } => isRecord(position)
  && Object.keys(position).length === 2 && Object.hasOwn(position, 'x') && Object.hasOwn(position, 'y')
  && typeof position.x === 'number' && Number.isFinite(position.x) && Math.abs(position.x) <= 100000
  && typeof position.y === 'number' && Number.isFinite(position.y) && Math.abs(position.y) <= 100000;

export function getDayLinks(document: CanvasDocument): CanvasDayLink[] {
  if (document.schemaVersion === 4) return document.dayLinks.map(link => ({ ...link }));
  return document.days.slice(0, -1).map((day, index) => {
    const next = document.days[index + 1];
    return { id: stableCanvasUuid(`canvas-day-link:${day.id}:${next.id}`), source: day.id, target: next.id };
  });
}

function asCanvasDocumentV4(document: CanvasDocument): CanvasDocumentV4 {
  return document.schemaVersion === 4
    ? document
    : { schemaVersion: 4, days: document.days, nodes: document.nodes, edges: document.edges, dayLinks: getDayLinks(document) };
}

export function moveDayFrame(document: CanvasDocument, dayId: string, position: { x: number; y: number }): CanvasDocument | null {
  if (!uuid(dayId) || !validCanvasPosition(position) || !document.days.some(day => day.id === dayId)) return null;
  const current = document.days.find(day => day.id === dayId)!;
  if (document.schemaVersion === 4 && current.position?.x === position.x && current.position.y === position.y) return document;
  const versioned = asCanvasDocumentV4(document);
  return { ...versioned, days: versioned.days.map(day => day.id === dayId ? { ...day, position: { x: position.x, y: position.y } } : day) };
}

export function connectDayFrames(document: CanvasDocument, source: string, target: string): CanvasDocument | null {
  if (!uuid(source) || !uuid(target) || source === target || !document.days.some(day => day.id === source) || !document.days.some(day => day.id === target)) return null;
  const links = getDayLinks(document);
  if (links.length >= 500) return null;
  if (links.some(link => link.source === source && link.target === target)) return null;
  const link: CanvasDayLink = { id: globalThis.crypto.randomUUID(), source, target };
  if (links.some(existing => existing.id === link.id)) return null;
  return { ...asCanvasDocumentV4(document), dayLinks: [...links, link] };
}

export function disconnectDayFrames(document: CanvasDocument, linkId: string): CanvasDocument | null {
  if (!uuid(linkId)) return null;
  const links = getDayLinks(document);
  if (!links.some(link => link.id === linkId)) return null;
  return { ...asCanvasDocumentV4(document), dayLinks: links.filter(link => link.id !== linkId) };
}

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

export function canvasClipboardCopy(node: CanvasNode): CanvasNode {
  const copy = structuredClone(node);
  if (copy.kind === 'place') { delete copy.source; delete copy.schedule; }
  return copy;
}

export function copyCanvasNode(node: CanvasNode, newId: string, dayId: string, offset = 36): CanvasNode {
  const copy = canvasClipboardCopy(node);
  return { ...copy, id: newId, dayId, position: { x: copy.position.x + offset, y: copy.position.y + offset } };
}

export function replaceCanvasPlace(node: CanvasPlaceNode, contentid: number): CanvasPlaceNode {
  const { source: _source, schedule: _schedule, ...editable } = node;
  return { ...editable, contentid };
}

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
  if (!isRecord(value) || (value.schemaVersion !== 3 && value.schemaVersion !== 4)
    || !(value.schemaVersion === 3 ? keys(value, ['schemaVersion', 'days', 'nodes', 'edges']) : keys(value, ['schemaVersion', 'days', 'nodes', 'edges', 'dayLinks']))
    || !Array.isArray(value.days) || value.days.length < 1 || value.days.length > 31 || !Array.isArray(value.nodes) || value.nodes.length > 500 || !Array.isArray(value.edges) || value.edges.length > 500
    || (value.schemaVersion === 4 && (!Array.isArray(value.dayLinks) || value.dayLinks.length > 500))) return null;
  try { if (new TextEncoder().encode(JSON.stringify(value)).length > 1_048_576) return null; } catch { return null; }
  const days: CanvasDay[] = []; const dayIds = new Set<string>(); const dayDates = new Set<string>();
  for (const item of value.days) {
    if (!isRecord(item) || !(value.schemaVersion === 3 ? keys(item, ['id', 'date']) : keys(item, ['id', 'date']) || keys(item, ['id', 'date', 'position']))
      || !uuid(item.id) || dayIds.has(item.id) || (item.date !== null && (!date(item.date) || dayDates.has(item.date)))) return null;
    if (Object.hasOwn(item, 'position') && !validCanvasPosition(item.position)) return null;
    dayIds.add(item.id);
    if (item.date !== null) dayDates.add(item.date);
    days.push({ id: item.id, date: item.date as string | null, ...(Object.hasOwn(item, 'position') ? { position: { x: (item.position as { x: number; y: number }).x, y: (item.position as { x: number; y: number }).y } } : {}) });
  }
  const nodes: CanvasNode[] = []; const nodeIds = new Set<string>();
  for (const item of value.nodes) {
    if (!isRecord(item) || !uuid(item.id) || nodeIds.has(item.id) || !uuid(item.dayId) || !dayIds.has(item.dayId) || !isRecord(item.position) || !keys(item.position, ['x', 'y']) || typeof item.position.x !== 'number' || !Number.isFinite(item.position.x) || Math.abs(item.position.x) > 100000 || typeof item.position.y !== 'number' || !Number.isFinite(item.position.y) || Math.abs(item.position.y) > 100000 || !colors.includes(item.color as CanvasColor)) return null;
    if (item.kind === 'place' && (keys(item, ['id', 'kind', 'dayId', 'position', 'color', 'contentid', 'intent']) || keys(item, ['id', 'kind', 'dayId', 'position', 'color', 'contentid', 'intent', 'source', 'schedule'])) && typeof item.contentid === 'number' && Number.isInteger(item.contentid) && item.contentid >= -2147483648 && item.contentid <= 2147483647 && (item.intent === 'route' || item.intent === 'candidate')) {
      let source: CanvasPlaceNode['source']; let schedule: CanvasPlaceNode['schedule'];
      if ('source' in item || 'schedule' in item) {
        if (!isRecord(item.source) || !keys(item.source, ['planId', 'versionId', 'nodeId']) || !uuid(item.source.planId) || !uuid(item.source.versionId) || !uuid(item.source.nodeId) || !isRecord(item.schedule) || !keys(item.schedule, ['startAt', 'endAt', 'locked']) || typeof item.schedule.locked !== 'boolean') return null;
        const validTime = (v: unknown) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(v) && !Number.isNaN(Date.parse(v)));
        if (!validTime(item.schedule.startAt) || !validTime(item.schedule.endAt)) return null;
        source = { planId: item.source.planId, versionId: item.source.versionId, nodeId: item.source.nodeId };
        schedule = { startAt: item.schedule.startAt as string | null, endAt: item.schedule.endAt as string | null, locked: item.schedule.locked };
      }
      nodes.push({ id: item.id, kind: 'place', dayId: item.dayId, position: { x: item.position.x, y: item.position.y }, color: item.color as CanvasColor, contentid: item.contentid, intent: item.intent, ...(source ? { source } : {}), ...(schedule ? { schedule } : {}) });
    }
    else if (item.kind === 'comment' && keys(item, ['id', 'kind', 'dayId', 'position', 'color', 'text']) && typeof item.text === 'string' && text(item.text, 1, 1000) && item.text.trim()) nodes.push({ id: item.id, kind: 'comment', dayId: item.dayId, position: { x: item.position.x, y: item.position.y }, color: item.color as CanvasColor, text: item.text });
    else return null;
    nodeIds.add(item.id);
  }
  const edges: CanvasEdge[] = []; const edgeIds = new Set<string>(); const placeNodes = new Map(nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place').map((node) => [node.id, node.dayId]));
  for (const edge of value.edges) { if (!isRecord(edge) || !keys(edge, ['id', 'source', 'target']) || !uuid(edge.id) || edgeIds.has(edge.id) || !uuid(edge.source) || !uuid(edge.target) || !canConnectRoute(edge.source, edge.target, placeNodes, edges)) return null; edgeIds.add(edge.id); edges.push({ id: edge.id, source: edge.source, target: edge.target }); }
  if (value.schemaVersion === 3) return { schemaVersion: 3, days, nodes, edges };
  const dayLinks: CanvasDayLink[] = [];
  const linkIds = new Set<string>();
  const linkPairs = new Set<string>();
  for (const item of value.dayLinks as unknown[]) {
    if (!isRecord(item) || !keys(item, ['id', 'source', 'target']) || !uuid(item.id) || linkIds.has(item.id)
      || !uuid(item.source) || !uuid(item.target) || item.source === item.target || !dayIds.has(item.source) || !dayIds.has(item.target)) return null;
    const pair = `${item.source}>${item.target}`;
    if (linkPairs.has(pair)) return null;
    linkIds.add(item.id); linkPairs.add(pair);
    dayLinks.push({ id: item.id, source: item.source, target: item.target });
  }
  return { schemaVersion: 4, days, nodes, edges, dayLinks };
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
      const selectField = (source: Record<string, unknown>, key: string) => {
        if (Object.hasOwn(source, key)) merged[key] = source[key];
        else delete merged[key];
      };
      for (const key of new Set([...Object.keys(br), ...Object.keys(lr), ...Object.keys(rr)])) {
        if (same(lr[key], br[key])) selectField(rr, key);
        else if (same(rr[key], br[key]) || same(lr[key], rr[key])) selectField(lr, key);
        else if (conflictChoice) selectField(conflictChoice === 'local' ? lr : rr, key);
        else conflicts.push(`${path}.${key}`);
      }
      out.push(merged as T);
    }
    return out;
  };
  const days = mergeFields('day', base.days, local.days, remote.days);
  const nodes = mergeFields('node', base.nodes, local.nodes, remote.nodes);
  const edges = mergeFields('edge', base.edges, local.edges, remote.edges);
  const schemaVersion = Math.max(base.schemaVersion, local.schemaVersion, remote.schemaVersion) as 3 | 4;
  const dayLinks = schemaVersion === 4 ? mergeFields('dayLink', getDayLinks(base), getDayLinks(local), getDayLinks(remote)) : undefined;
  const merged = schemaVersion === 4 ? { schemaVersion, days, nodes, edges, dayLinks } : { schemaVersion, days, nodes, edges };
  const doc = parseCanvasDocument(merged);
  if (!doc) conflicts.push('graph:invalid');
  return { document: conflicts.length ? null : doc, conflicts };
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
