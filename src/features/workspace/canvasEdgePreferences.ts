import { isCanonicalCanvasUuid, type CanvasDocument, type CanvasEdge, type CanvasPlaceNode } from './canvasModel.ts';
import type { CanvasTravelMode } from './canvasRoutes.ts';

export type CanvasEdgeMode = Exclude<CanvasTravelMode, null>;
export type CanvasEdgeOverride = {
  modeOverride: CanvasEdgeMode | null;
  manualMinutes: number | null;
};
export type CanvasEdgePreference = CanvasEdgeOverride & {
  edgeId: string;
  source: string;
  target: string;
  sourceContentid: number;
  targetContentid: number;
};
export type CanvasEdgePreferenceStore = Record<string, CanvasEdgePreference>;
export type CanvasEdgeTimeSource = 'common' | 'manual' | 'required';
export type CanvasEdgeTimeResolution = {
  mode: CanvasTravelMode;
  source: CanvasEdgeTimeSource;
  minutes: number | null;
};

const edgeModes: CanvasEdgeMode[] = ['car', 'walk', 'transit', 'charter'];
const nullableMode = (value: unknown): value is CanvasEdgeMode | null => value === null || edgeModes.includes(value as CanvasEdgeMode);
const validMinutes = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1440);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const canvasEdgePreferenceStorageKey = (tripId: string, preview: boolean): string =>
  `canvas-edge-preferences:v1:${preview ? 'preview' : 'shared'}:${encodeURIComponent(tripId)}`;

type EdgeIdentity = Pick<CanvasEdgePreference, 'edgeId' | 'source' | 'target' | 'sourceContentid' | 'targetContentid'>;
function edgeIdentity(edge: CanvasEdge, document: CanvasDocument): EdgeIdentity | null {
  if (!isCanonicalCanvasUuid(edge.id) || !isCanonicalCanvasUuid(edge.source) || !isCanonicalCanvasUuid(edge.target)) return null;
  if (!document.edges.some(item => item.id === edge.id && item.source === edge.source && item.target === edge.target)) return null;
  const source = document.nodes.find((node): node is CanvasPlaceNode => node.id === edge.source && node.kind === 'place');
  const target = document.nodes.find((node): node is CanvasPlaceNode => node.id === edge.target && node.kind === 'place');
  if (!source || !target || !Number.isInteger(source.contentid) || !Number.isInteger(target.contentid)) return null;
  return { edgeId: edge.id, source: edge.source, target: edge.target, sourceContentid: source.contentid, targetContentid: target.contentid };
}

export function isCanvasEdgeOverride(value: unknown): value is CanvasEdgeOverride {
  return record(value) && exactKeys(value, ['modeOverride', 'manualMinutes']) && nullableMode(value.modeOverride) && validMinutes(value.manualMinutes)
    && (value.modeOverride !== null || value.manualMinutes !== null);
}

function storedPreference(value: unknown, edgeId: string): CanvasEdgePreference | null {
  if (!record(value) || !exactKeys(value, ['edgeId', 'source', 'target', 'sourceContentid', 'targetContentid', 'modeOverride', 'manualMinutes'])
    || value.edgeId !== edgeId || !isCanonicalCanvasUuid(value.edgeId) || !isCanonicalCanvasUuid(value.source) || !isCanonicalCanvasUuid(value.target)
    || typeof value.sourceContentid !== 'number' || !Number.isInteger(value.sourceContentid)
    || typeof value.targetContentid !== 'number' || !Number.isInteger(value.targetContentid)
    || !nullableMode(value.modeOverride) || !validMinutes(value.manualMinutes)
    || (value.modeOverride === null && value.manualMinutes === null)) return null;
  return value as CanvasEdgePreference;
}

export function parseCanvasEdgePreferenceStore(value: unknown): CanvasEdgePreferenceStore {
  if (!record(value) || !exactKeys(value, ['version', 'edges']) || value.version !== 1 || !record(value.edges)) return {};
  const result: CanvasEdgePreferenceStore = {};
  for (const [edgeId, item] of Object.entries(value.edges)) {
    const preference = storedPreference(item, edgeId);
    if (preference) result[edgeId] = preference;
  }
  return result;
}

export function readCanvasEdgePreferenceStore(storage: Pick<Storage, 'getItem'>, key: string): { store: CanvasEdgePreferenceStore; error: string | null } {
  try {
    const raw = storage.getItem(key);
    if (!raw) return { store: {}, error: null };
    return { store: parseCanvasEdgePreferenceStore(JSON.parse(raw)), error: null };
  } catch {
    return { store: {}, error: '개인 이동 설정을 읽지 못했어요. 브라우저 저장 공간을 확인해 주세요.' };
  }
}

export function writeCanvasEdgePreferenceStore(storage: Pick<Storage, 'setItem'>, key: string, store: CanvasEdgePreferenceStore): boolean {
  try { storage.setItem(key, JSON.stringify({ version: 1, edges: store })); return true; }
  catch { return false; }
}

export function getCanvasEdgePreference(edge: CanvasEdge, document: CanvasDocument, store: CanvasEdgePreferenceStore): CanvasEdgePreference | null {
  const identity = edgeIdentity(edge, document);
  if (!identity) return null;
  const saved = storedPreference(store[edge.id], edge.id);
  return saved && saved.source === identity.source && saved.target === identity.target
    && saved.sourceContentid === identity.sourceContentid && saved.targetContentid === identity.targetContentid ? { ...saved } : null;
}

export function setCanvasEdgePreference(
  edge: CanvasEdge, document: CanvasDocument, store: CanvasEdgePreferenceStore, override: CanvasEdgeOverride | null,
): CanvasEdgePreferenceStore | null {
  const identity = edgeIdentity(edge, document);
  if (!identity || (override !== null && !isCanvasEdgeOverride(override))) return null;
  const next = { ...store };
  if (!override) delete next[edge.id];
  else next[edge.id] = { ...identity, ...override };
  return next;
}

export function resolveCanvasEdgeTime(preference: CanvasEdgeOverride | null, commonMode: CanvasTravelMode): CanvasEdgeTimeResolution {
  const mode = preference?.modeOverride ?? commonMode;
  if (preference?.manualMinutes !== null && preference?.manualMinutes !== undefined) return { mode, source: 'manual', minutes: preference.manualMinutes };
  if (preference?.modeOverride && preference.modeOverride !== commonMode) return { mode, source: 'required', minutes: null };
  return { mode, source: 'common', minutes: null };
}

export function modeLabel(mode: CanvasTravelMode): string {
  if (mode === 'car') return '차량';
  if (mode === 'walk') return '도보';
  if (mode === 'transit') return '대중교통';
  if (mode === 'charter') return '전세버스';
  return '미정';
}

export function canvasEdgeDraftModeKey(mode: CanvasTravelMode): string { return mode ?? 'none'; }

export function canvasEdgeOverrideFromFields(mode: string, minutes: string): { value: CanvasEdgeOverride | null; error: string | null } {
  const modeOverride: CanvasEdgeMode | null = mode === '' ? null : edgeModes.includes(mode as CanvasEdgeMode) ? mode as CanvasEdgeMode : null;
  if (mode !== '' && modeOverride === null) return { value: null, error: '이동 수단을 다시 선택해 주세요.' };
  if (minutes !== '' && !/^\d+$/u.test(minutes)) return { value: null, error: '시간은 정수 분으로 입력해 주세요.' };
  const manualMinutes = minutes === '' ? null : Number(minutes);
  if (manualMinutes !== null && (!Number.isSafeInteger(manualMinutes) || manualMinutes < 1 || manualMinutes > 1440)) return { value: null, error: '시간은 1분부터 1,440분까지 입력해 주세요.' };
  return { value: modeOverride === null && manualMinutes === null ? null : { modeOverride, manualMinutes }, error: null };
}
