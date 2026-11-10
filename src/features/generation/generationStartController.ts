import type { GenerationState, Job } from './generationApi';

type Dependencies = {
  getLatest: (tripId: string, signal: AbortSignal) => Promise<GenerationState>;
  create: (tripId: string, inputToken: string, settingsVersion: number, idempotencyKey: string, signal: AbortSignal) => Promise<Job>;
  createKey: () => string;
  isCurrentCompleted?: (tripId: string, job: Job, data: GenerationState, signal: AbortSignal) => Promise<boolean>;
};

export type StartResult =
  | { kind: 'busy' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'not-ready'; data: GenerationState }
  | { kind: 'active'; data: GenerationState }
  | { kind: 'started'; data: GenerationState; job: Job };

/** Keeps generation idempotency stable across uncertain retries for identical inputs. */
export function createGenerationStartController({ getLatest, create, createKey, isCurrentCompleted }: Dependencies) {
  let inFlight = false;
  let retry: { tripId: string; inputToken: string; settingsVersion: number; key: string } | null = null;

  return {
    async start(tripId: string, signal: AbortSignal, blockedReason?: string | (() => string | undefined)): Promise<StartResult> {
      if (inFlight) return { kind: 'busy' };
      const currentBlocker = () => typeof blockedReason === 'function' ? blockedReason() : blockedReason;
      if (currentBlocker()) return { kind: 'blocked', reason: currentBlocker()! };
      inFlight = true;
      try {
        const data = await getLatest(tripId, signal);
        if (signal.aborted) return { kind: 'busy' };
        if (currentBlocker()) return { kind: 'blocked', reason: currentBlocker()! };
        if (data.latestJob?.status === 'QUEUED' || data.latestJob?.status === 'RUNNING') {
          retry = null;
          return { kind: 'active', data };
        }
        if (data.latestJob?.status === 'SUCCEEDED' && isCurrentCompleted) {
          const completedIsCurrent = await isCurrentCompleted(tripId, data.latestJob, data, signal);
          if (signal.aborted) return { kind: 'busy' };
          if (currentBlocker()) return { kind: 'blocked', reason: currentBlocker()! };
          if (completedIsCurrent) { retry = null; return { kind: 'active', data }; }
        }
        if (!data.readyForGeneration) {
          retry = null;
          return { kind: 'not-ready', data };
        }
        const sameInputs = retry?.tripId === tripId && retry.inputToken === data.inputToken && retry.settingsVersion === data.settingsVersion;
        const key = sameInputs ? retry!.key : createKey();
        retry = { tripId, inputToken: data.inputToken, settingsVersion: data.settingsVersion, key };
        try {
          const job = await create(tripId, data.inputToken, data.settingsVersion, key, signal);
          if (signal.aborted) return { kind: 'busy' };
          retry = null;
          return { kind: 'started', data, job };
        } catch (error) {
          const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
          if (status >= 400 && status < 500) retry = null;
          throw error;
        }
      } finally {
        inFlight = false;
      }
    },
    reset() { retry = null; },
  };
}
