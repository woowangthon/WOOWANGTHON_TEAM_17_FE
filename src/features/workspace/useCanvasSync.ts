import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { CanvasSyncEngine } from './canvasSyncEngine.ts';
import type { CanvasState } from './canvasModel.ts';

// Public drafts and unresolved request keys stay in memory when switching views.
// Normal rooms never fall back to localStorage or fabricated place data.
const engines = new Map<string, CanvasSyncEngine>();
function getEngine(tripId: string, preview: boolean, initialState?: CanvasState) {
  const key = (preview ? 'preview:' : 'shared:') + tripId;
  let engine = engines.get(key);
  if (!engine) {
    engine = new CanvasSyncEngine(tripId, { preview, initialState });
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
  const sourceEpoch = snapshot.sourceEpoch;
  return useMemo(() => {
    const isCurrentSource = () => engine.isCurrentSource(sourceEpoch);
    return { ...snapshot, sourceEpoch, isCurrentSource,
      update: (next: Parameters<typeof engine.update>[0]) => isCurrentSource() && engine.update(next),
      updateLatest: (next: Parameters<typeof engine.update>[0]) => isCurrentSource() && engine.update(next),
      retry: () => { if (isCurrentSource()) engine.retry(); },
      resolve: (choice: 'local' | 'remote') => { if (isCurrentSource()) engine.resolve(choice); },
      undo: () => isCurrentSource() && engine.undo(),
      redo: () => isCurrentSource() && engine.redo() };
  }, [engine, snapshot, sourceEpoch]);
}

export async function acceptImportedCanvasState(tripId: string, state: CanvasState, signal?: AbortSignal): Promise<void> {
  const engine = getEngine(tripId, false, state);
  await engine.acceptImportedStateAndWait(state, signal);
}
