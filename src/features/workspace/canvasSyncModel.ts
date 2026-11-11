import { mergeCanvasDocuments, type CanvasDocument, type CanvasState } from './canvasModel.ts';

export type CanvasSourcePlan = CanvasState['sourcePlan'];
export type PendingCanvasSave = { body: CanvasDocument; revision: number; key: string; base: CanvasDocument; expectedSourcePlan: CanvasSourcePlan };
export function reserveCanvasSave(existing: PendingCanvasSave | null, body: CanvasDocument, revision: number, base: CanvasDocument, expectedSourcePlan: CanvasSourcePlan = null): PendingCanvasSave {
  return existing ?? { body, revision, base, expectedSourcePlan: expectedSourcePlan ? { ...expectedSourcePlan } : null, key: crypto.randomUUID() };
}
export function reconcileCanvasSave(request: PendingCanvasSave, latestLocal: CanvasDocument, saved: CanvasState): { document: CanvasDocument | null; conflicts: string[] } {
  return mergeCanvasDocuments(request.body, latestLocal, saved.document);
}
export function resolveCanvasConflict(base: CanvasDocument, local: CanvasDocument, remote: CanvasDocument, choice: 'local' | 'remote') {
  return mergeCanvasDocuments(base, local, remote, choice);
}
