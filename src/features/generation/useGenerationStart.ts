import { useCallback, useEffect, useRef, useState } from 'react';
import { createJob, GenerationError, getGeneration, type GenerationState } from './generationApi';
import { createGenerationStartController } from './generationStartController';

type Options = {
  tripId: string | null;
  enabled: boolean;
  blockedReason?: string;
  onStarted: () => void;
  onAccessLost: () => void;
};

function isAccessLost(error: unknown): boolean {
  return error instanceof GenerationError && ([401, 403, 404].includes(error.status) || error.code === 'TRIP_CLOSED');
}

/** Loads public readiness and starts a job only after an explicit, fresh readiness check. */
export function useGenerationStart({ tripId, enabled, blockedReason, onStarted, onAccessLost }: Options) {
  const [data, setData] = useState<GenerationState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const starter = useRef<ReturnType<typeof createGenerationStartController> | null>(null);
  starter.current ??= createGenerationStartController({
    getLatest: (id, signal) => getGeneration(id, signal),
    create: (id, token, version, key, signal) => createJob(id, token, version, key, signal),
    createKey: () => crypto.randomUUID(),
  });
  const lock = useRef(false);
  const blockedReasonRef = useRef(blockedReason);
  useEffect(() => { blockedReasonRef.current = blockedReason; }, [blockedReason]);
  const callbacks = useRef({ onStarted, onAccessLost });
  useEffect(() => { callbacks.current = { onStarted, onAccessLost }; }, [onAccessLost, onStarted]);

  const refresh = useCallback(async () => {
    if (!enabled || !tripId || lock.current) return null;
    controller.current?.abort();
    const own = ++epoch.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const next = await getGeneration(tripId, abort.signal);
      if (own !== epoch.current || abort.signal.aborted) return null;
      setData(next);
      setMessage('');
      return next;
    } catch (error) {
      if (own === epoch.current && !abort.signal.aborted) {
        if (isAccessLost(error)) callbacks.current.onAccessLost();
        else setMessage(error instanceof Error ? error.message : '일정 준비 상태를 불러오지 못했어요.');
      }
      return null;
    } finally {
      if (own === epoch.current) setLoading(false);
    }
  }, [enabled, tripId]);

  useEffect(() => {
    epoch.current += 1;
    controller.current?.abort();
    controller.current = null;
    lock.current = false;
    starter.current?.reset();
    // Reset room-scoped public readiness before starting the new room request.
    // oxlint-disable-next-line react(set-state-in-effect)
    setData(null);
    setBusy(false);
    setMessage('');
    if (enabled && tripId) void refresh();
    return () => {
      epoch.current += 1;
      controller.current?.abort();
      controller.current = null;
      lock.current = false;
    };
  }, [enabled, refresh, tripId]);

  const start = useCallback(async () => {
    if (!enabled || !tripId || lock.current) return;
    if (blockedReason) { setMessage(blockedReason); return; }
    lock.current = true;
    setBusy(true);
    // The explicit fresh check supersedes any initial readiness fetch.
    setLoading(false);
    controller.current?.abort();
    const own = ++epoch.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await starter.current!.start(tripId, abort.signal, () => blockedReasonRef.current);
      if (own !== epoch.current || abort.signal.aborted) return;
      if ('data' in result) setData(result.kind === 'started' ? { ...result.data, latestJob: result.job } : result.data);
      if (result.kind === 'active' || result.kind === 'started') {
        if (blockedReasonRef.current) setMessage('일정 생성 작업은 시작했어요. 현재 수정 중인 입력을 먼저 저장하거나 확인한 뒤 일정 화면으로 이동해 주세요.');
        else callbacks.current.onStarted();
      }
      else if (result.kind === 'not-ready') setMessage('검토가 필요한 조건이 있어요. 아래 참여자 상태와 생성 설정을 확인해 주세요.');
      else if (result.kind === 'blocked') setMessage(result.reason);
    } catch (error) {
      if (own !== epoch.current || abort.signal.aborted) return;
      if (isAccessLost(error)) {
        starter.current?.reset();
        callbacks.current.onAccessLost();
      } else if (error instanceof GenerationError) {
        // A 409 is a known rejection. Refresh and require a new explicit click.
        if (error.status < 500) starter.current?.reset();
        setMessage(error.message);
        if (error.status === 409) {
          try {
            const fresh = await getGeneration(tripId, abort.signal);
            if (own === epoch.current && !abort.signal.aborted) setData(fresh);
          } catch (refreshError) {
            if (!abort.signal.aborted && isAccessLost(refreshError)) callbacks.current.onAccessLost();
          }
        }
      } else {
        // Keep the same key after an uncertain transport failure for a safe retry.
        setMessage(error instanceof Error ? error.message : '일정 생성 요청 결과를 확인하지 못했어요. 다시 시도해 주세요.');
      }
    } finally {
      if (own === epoch.current) { lock.current = false; setBusy(false); }
    }
  }, [blockedReason, enabled, tripId]);

  return { data, loading, busy, message, start, refresh };
}
