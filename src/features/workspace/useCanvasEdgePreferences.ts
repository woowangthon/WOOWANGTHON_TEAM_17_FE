import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CanvasDocument, CanvasEdge } from './canvasModel.ts';
import {
  canvasEdgePreferenceStorageKey, getCanvasEdgePreference, parseCanvasEdgePreferenceStore,
  readCanvasEdgePreferenceStore, setCanvasEdgePreference, writeCanvasEdgePreferenceStore,
  type CanvasEdgeOverride, type CanvasEdgePreference, type CanvasEdgePreferenceStore,
} from './canvasEdgePreferences.ts';

type Snapshot = { key: string; store: CanvasEdgePreferenceStore; error: string | null };
const emptyStore: CanvasEdgePreferenceStore = {};

/** Per-browser overrides are separated by shared/preview surface and trip; they never enter the shared document. */
export function useCanvasEdgePreferences(tripId: string, preview: boolean) {
  const key = useMemo(() => canvasEdgePreferenceStorageKey(tripId, preview), [preview, tripId]);
  const activeKey = useRef(key);
  useLayoutEffect(() => { activeKey.current = key; }, [key]);
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '', store: emptyStore, error: null });
  const store = snapshot.key === key ? snapshot.store : emptyStore;
  const storageError = snapshot.key === key ? snapshot.error : null;

  useEffect(() => {
    try {
      const read = readCanvasEdgePreferenceStore(window.localStorage, key);
      setSnapshot(previous => activeKey.current === key ? { key, store: read.store, error: read.error } : previous);
    } catch {
      setSnapshot(previous => activeKey.current === key ? { key, store: {}, error: '개인 이동 설정을 읽지 못했어요. 브라우저 저장 공간을 확인해 주세요.' } : previous);
    }
    const onStorage = (event: StorageEvent) => {
      if (activeKey.current !== key || (event.key !== key && event.key !== null)) return;
      if (event.key === null || event.newValue === null) {
        setSnapshot(previous => activeKey.current === key ? { key, store: {}, error: null } : previous);
        return;
      }
      try {
        const updated = parseCanvasEdgePreferenceStore(JSON.parse(event.newValue));
        setSnapshot(previous => activeKey.current === key ? { key, store: updated, error: null } : previous);
      }
      catch {
        setSnapshot(previous => activeKey.current === key ? { key, store: previous.key === key ? previous.store : {}, error: '개인 이동 설정을 읽지 못했어요. 브라우저 저장 공간을 확인해 주세요.' } : previous);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key]);

  const get = useCallback((edge: CanvasEdge, document: CanvasDocument): CanvasEdgePreference | null =>
    getCanvasEdgePreference(edge, document, store), [store]);

  const set = useCallback((edge: CanvasEdge, document: CanvasDocument, override: CanvasEdgeOverride | null): boolean => {
    if (activeKey.current !== key) return false;
    const current = setCanvasEdgePreference(edge, document, store, override);
    if (!current) return false;
    try {
      const storage = window.localStorage;
      const read = readCanvasEdgePreferenceStore(storage, key);
      if (read.error) { setSnapshot({ key, store, error: read.error }); return false; }
      const latest = setCanvasEdgePreference(edge, document, read.store, override);
      if (!latest || !writeCanvasEdgePreferenceStore(storage, key, latest)) {
        setSnapshot({ key, store, error: '개인 이동 설정을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.' });
        return false;
      }
      setSnapshot({ key, store: latest, error: null });
      return true;
    } catch {
      setSnapshot({ key, store, error: '개인 이동 설정을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.' });
      return false;
    }
  }, [key, store]);

  return { get, set, storageError };
}
