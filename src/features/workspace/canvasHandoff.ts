import type { CanvasDocument } from './canvasModel.ts';

export type CanvasWarningCode = 'MEAL_SLOT_UNFILLED' | 'TRANSFER_TIME_ESTIMATED' | 'STAY_TIME_ESTIMATED';
export type CanvasHandoff = { tripId: string; planId: string; versionId: string; handoffId: string; warningCodes?: CanvasWarningCode[] };
export type CanvasHandoffTarget = { dayId: string; nodeIds: string[]; matched: boolean };
export type CanvasViewport = { x: number; y: number; zoom: number };
export type CanvasViewMemory = { dayId: string; viewport: CanvasViewport | null };
export type CanvasMountView =
  | { kind: 'handoff'; key: string; target: CanvasHandoffTarget }
  | { kind: 'restore'; dayId: string; viewport: CanvasViewport | null; initialFitNodeIds: string[] };

const viewMemory = new Map<string, CanvasViewMemory>();
const consumedHandoffs = new Set<string>();
const fittedHandoffs = new Set<string>();
export function canvasViewScope(tripId: string, preview: boolean): string {
  return `${preview ? 'preview' : 'shared'}:${tripId}`;
}
export function readCanvasView(scope: string): CanvasViewMemory | null {
  const value = viewMemory.get(scope);
  return value ? { ...value, viewport: value.viewport ? { ...value.viewport } : null } : null;
}
export function writeCanvasView(scope: string, value: CanvasViewMemory): void {
  const viewport = value.viewport;
  if (viewport && (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) || !Number.isFinite(viewport.zoom) || viewport.zoom <= 0 || viewport.zoom > 10)) return;
  if (!value.dayId) return;
  viewMemory.delete(scope);
  viewMemory.set(scope, { ...value, viewport: value.viewport ? { ...value.viewport } : null });
  if (viewMemory.size > 100) viewMemory.delete(viewMemory.keys().next().value!);
}
function handoffScopeKey(scope: string, handoffId: string): string { return `${scope}:${handoffId}`; }
export function hasConsumedHandoff(scope: string, handoffId: string): boolean { return consumedHandoffs.has(handoffScopeKey(scope, handoffId)); }
export function consumeHandoff(scope: string, handoffId: string): void {
  const key = handoffScopeKey(scope, handoffId);
  consumedHandoffs.add(key);
  if (consumedHandoffs.size > 100) consumedHandoffs.delete(consumedHandoffs.values().next().value!);
}

export function resolveCanvasMountView(document: CanvasDocument, scope: string, handoff?: CanvasHandoff | null): CanvasMountView {
  if (handoff?.tripId && handoff.handoffId && !hasConsumedHandoff(scope, handoff.handoffId)) {
    const target = chooseHandoffTarget(document, handoff);
    if (target.dayId) return { kind: 'handoff', key: handoffScopeKey(scope, handoff.handoffId), target };
  }
  const cached = readCanvasView(scope);
  const cachedDayIsValid = Boolean(cached && document.days.some(day => day.id === cached.dayId));
  const dayId = cachedDayIsValid ? cached!.dayId : firstRouteDay(document);
  const viewport = cachedDayIsValid ? cached!.viewport : null;
  const initialFitNodeIds = viewport ? [] : document.days.map(day => `day-frame:${day.id}`);
  return { kind: 'restore', dayId, viewport, initialFitNodeIds };
}

/** Selects only nodes that still carry the server-issued source metadata. */
export function chooseHandoffTarget(document: CanvasDocument, handoff: CanvasHandoff): CanvasHandoffTarget {
  const generated = document.nodes.filter(node => node.kind === 'place'
    && node.source?.planId === handoff.planId && node.source.versionId === handoff.versionId);
  if (generated.length) {
    const dayId = document.days.find(day => generated.some(node => node.dayId === day.id))?.id;
    if (dayId) return { dayId, nodeIds: generated.filter(node => node.dayId === dayId).map(node => node.id), matched: true };
  }
  const routeEdgeNodeIds = new Set(document.edges.flatMap(edge => [edge.source, edge.target]));
  const fallback = document.days.find(day => document.nodes.some(node => node.kind === 'place' && node.dayId === day.id && routeEdgeNodeIds.has(node.id)))
    ?? document.days.find(day => document.nodes.some(node => node.kind === 'place' && node.dayId === day.id && node.intent === 'route'))
    ?? document.days.find(day => document.nodes.some(node => node.kind === 'place' && node.dayId === day.id))
    ?? document.days[0];
  const fallbackPlaceIds = fallback ? document.nodes.filter(node => node.kind === 'place' && node.dayId === fallback.id).map(node => node.id) : [];
  return { dayId: fallback?.id ?? '', nodeIds: fallbackPlaceIds, matched: false };
}

export function firstRouteDay(document: CanvasDocument): string {
  const routeEdgeNodeIds = new Set(document.edges.flatMap(edge => [edge.source, edge.target]));
  return document.days.find(day => document.nodes.some(node => node.kind === 'place' && node.dayId === day.id && routeEdgeNodeIds.has(node.id)))?.id
    ?? document.days.find(day => document.nodes.some(node => node.kind === 'place' && node.dayId === day.id && node.intent === 'route'))?.id
    ?? document.days.find(day => document.nodes.some(node => node.kind === 'place' && node.dayId === day.id))?.id
    ?? document.days[0]?.id ?? '';
}

/** Module-level memory prevents an already-consumed handoff refitting on remount. */
export function hasFittedHandoff(handoffId: string): boolean { return fittedHandoffs.has(handoffId); }
export function markHandoffFitted(handoffId: string): void {
  fittedHandoffs.add(handoffId);
  if (fittedHandoffs.size > 100) fittedHandoffs.delete(fittedHandoffs.values().next().value!);
}
