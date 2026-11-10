import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { CanvasSyncEngine } from './canvasSyncEngine.ts';

// Public drafts and unresolved request keys stay in memory when switching views.
// Normal rooms never fall back to localStorage or fabricated place data.
const engines = new Map<string, CanvasSyncEngine>();
function getEngine(tripId: string, preview: boolean) {
  const key = (preview ? 'preview:' : 'shared:') + tripId;
  let engine = engines.get(key);
  if (!engine) {
    engine = new CanvasSyncEngine(tripId, { preview });
    engines.set(key, engine);
  }
  return engine;
}

export function useCanvasSync(tripId: string, preview: boolean) {
  const engine = useMemo(() => getEngine(tripId, preview), [tripId, preview]);
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const refresh = () => {
      if (globalThis.document.visibilityState === 'visible') void engine.refresh(controller.signal);
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);
    globalThis.document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      globalThis.document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [engine, preview]);
  return { ...snapshot, update: engine.update, updateLatest: engine.update, retry: engine.retry,
    resolve: engine.resolve, undo: engine.undo, redo: engine.redo };
}

export function acceptImportedCanvasState(tripId: string, state: Parameters<CanvasSyncEngine['acceptImportedState']>[0]) {
  const engine = engines.get(`shared:${tripId}`);
  engine?.acceptImportedState(state);
}
