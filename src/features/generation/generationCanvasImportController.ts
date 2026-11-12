import type { CanvasState } from '../workspace/canvasModel.ts';
import { CanvasHttpError } from '../workspace/canvasApi.ts';

type PendingImport = { tripId: string; planId: string; versionId: string; expectedRevision: number; key: string };
type Dependencies = {
  getRevision: (tripId: string, signal: AbortSignal) => Promise<number>;
  importPlan: (tripId: string, planId: string, versionId: string, expectedRevision: number, key: string, signal: AbortSignal) => Promise<CanvasState>;
  createKey: () => string;
};

/** Retains one exact request after an unknown outcome; a known CAS rejection gets a fresh revision and key. */
export function createGenerationCanvasImportController({ getRevision, importPlan, createKey }: Dependencies) {
  let pending: PendingImport | null = null;
  return {
    async run(tripId: string, planId: string, versionId: string, signal: AbortSignal): Promise<CanvasState> {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!pending || pending.tripId !== tripId || pending.planId !== planId || pending.versionId !== versionId) {
          pending = { tripId, planId, versionId, expectedRevision: await getRevision(tripId, signal), key: createKey() };
        }
        try {
          const result = await importPlan(tripId, planId, versionId, pending.expectedRevision, pending.key, signal);
          pending = null;
          return result;
        } catch (error) {
          if (error instanceof CanvasHttpError && error.code === 'VERSION_CONFLICT') {
            pending = null;
            if (attempt < 2) continue;
          }
          if (error instanceof CanvasHttpError && error.status >= 400 && error.status < 500 && error.code !== 'VERSION_CONFLICT') pending = null;
          throw error;
        }
      }
      throw new CanvasHttpError(409, 'VERSION_CONFLICT', '캔버스 버전이 바뀌었어요. 다시 시도해 주세요.');
    },
    reset() { pending = null; },
    getPending() { return pending ? { ...pending } : null; },
  };
}
