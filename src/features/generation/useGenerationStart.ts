import { useCallback, useEffect, useRef, useState } from 'react';
import { createJob, GenerationError, getGeneration, getJob, getPlan, getSelfPreparationIssues, type GenerationState, type Job, type SelfDto } from './generationApi';
import { createGenerationStartController } from './generationStartController';
import { CanvasHttpError, getCanvas, importPlanToCanvas } from '../workspace/canvasApi.ts';
import { acceptImportedCanvasState } from '../workspace/useCanvasSync.ts';
import { createGenerationCanvasImportController } from './generationCanvasImportController.ts';
import { isGenerationAccessLost } from './generationAccess.ts';
import type { GenerationLoadingPhase } from './generationProgress.ts';
import { mayCompleteHandoff, waitForTwoPaints } from './generationHandoff.ts';

export type GenerationCanvasHandoff = { tripId: string; planId: string; versionId: string; handoffId: string };
type Options = { tripId: string | null; enabled: boolean; blockedReason?: string; onStarted: (handoff: GenerationCanvasHandoff) => void; onAccessLost: () => void };
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
  });
}
function jobPhase(job: Job): 'generating' | 'routing' {
  const phase = job.phase.toLowerCase();
  return phase.includes('rout') || phase.includes('route') || phase.includes('validat') || phase.includes('persist') ? 'routing' : 'generating';
}

/** Freshly checks readiness, resumes an active job, and imports only its completed plan. */
export function useGenerationStart({ tripId, enabled, blockedReason, onStarted, onAccessLost }: Options) {
  const [data, setData] = useState<GenerationState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const [returnAvailable, setReturnAvailable] = useState(false);
  const [phase, setPhase] = useState<GenerationLoadingPhase>('checking');
  const [error, setError] = useState(false);
  const [personalIssues, setPersonalIssues] = useState<SelfDto['preparationIssues']>();
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const starter = useRef<ReturnType<typeof createGenerationStartController> | null>(null);
  const callbacks = useRef({ onStarted, onAccessLost });
  const blockedReasonRef = useRef(blockedReason);
  const processing = useRef<string | null>(null);
  const importer = useRef<ReturnType<typeof createGenerationCanvasImportController> | null>(null);
  const failedPlan = useRef<{ planId: string; versionId: string } | null>(null);
  const issueInputToken = useRef<string | null>(null);
  starter.current ??= createGenerationStartController({
    getLatest: (id, signal) => getGeneration(id, signal),
    create: (id, token, version, key, signal) => createJob(id, token, version, key, signal),
    createKey: () => crypto.randomUUID(),
    isCurrentCompleted: async (id, job, state, signal) => {
      if (!job.planId) return false;
      const plan = await getPlan(id, job.planId, signal);
      return !plan.stale && (!state.latestPlan || (state.latestPlan.planId === plan.planId && state.latestPlan.versionId === plan.versionId));
    },
  });
  importer.current ??= createGenerationCanvasImportController({
    getRevision: async (id, signal) => (await getCanvas(id, { signal })).revision,
    importPlan: (id, planId, versionId, revision, key, signal) => importPlanToCanvas(id, planId, versionId, revision, key, { signal }),
    createKey: () => crypto.randomUUID(),
  });
  useEffect(() => { callbacks.current = { onStarted, onAccessLost }; }, [onAccessLost, onStarted]);
  useEffect(() => { blockedReasonRef.current = blockedReason; }, [blockedReason]);
  const acceptGenerationState = useCallback((next: GenerationState) => {
    if (issueInputToken.current && issueInputToken.current !== next.inputToken) { issueInputToken.current = null; setPersonalIssues(undefined); }
    setData(next);
  }, []);

  const importCompletedPlan = useCallback(async (id: string, planId: string, versionId: string, signal: AbortSignal, own: number) => {
    setPhase('opening');
    failedPlan.current = { planId, versionId };
    const imported = await importer.current!.run(id, planId, versionId, signal);
    if (signal.aborted || own !== epoch.current) return;
    const latest = await getCanvas(id, { signal });
    if (signal.aborted || own !== epoch.current) return;
    if (latest.revision < imported.revision) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '가져온 캔버스의 최신 상태를 확인할 수 없어요.');
    await acceptImportedCanvasState(id, latest, signal);
    if (!mayCompleteHandoff(signal, own, epoch.current, blockedReasonRef.current)) {
      if (!signal.aborted && own === epoch.current && blockedReasonRef.current) {
        setBusy(false); setOverlayOpen(false); setReturnAvailable(false); setError(false);
        setMessage('생성한 일정은 캔버스에 담겼어요. 입력을 저장한 뒤 일정 캔버스를 열어 주세요.');
      }
      return;
    }
    failedPlan.current = null;
    setPhase('complete');
    await waitForTwoPaints(signal);
    if (signal.aborted || own !== epoch.current) return;
    setBusy(false);
    if (blockedReasonRef.current) {
      setMessage('생성한 일정은 캔버스에 담겼어요. 입력을 저장한 뒤 일정 캔버스를 열어 주세요.');
      setOverlayOpen(false); setReturnAvailable(false); setError(false);
      return;
    }
    const handoff: GenerationCanvasHandoff = { tripId: id, planId, versionId, handoffId: crypto.randomUUID() };
    setMessage(''); setOverlayOpen(false); setReturnAvailable(false); setError(false);
    callbacks.current.onStarted(handoff);
  }, []);

  const processJob = useCallback(async (id: string, initialJob: Job, signal: AbortSignal, own: number) => {
    if (processing.current === initialJob.id) return;
    processing.current = initialJob.id;
    setBusy(true); setOverlayOpen(true); setMessage('');
    try {
      let job = initialJob;
      while (job.status === 'QUEUED' || job.status === 'RUNNING') {
        setPhase(jobPhase(job));
        await pause(1200, signal);
        job = await getJob(id, job.id, signal);
        if (signal.aborted || own !== epoch.current) return;
        setData(current => current ? { ...current, latestJob: job } : current);
      }
      if (job.status !== 'SUCCEEDED' || !job.planId) throw new GenerationError(409, job.errorCode ?? 'GENERATION_FAILED', '일정 생성을 완료하지 못했어요. 준비 화면에서 다시 시작해 주세요.');
      setPhase('routing');
      const plan = await getPlan(id, job.planId, signal);
      if (signal.aborted || own !== epoch.current) return;
      if (plan.versionId.length === 0 || plan.stale) {
        failedPlan.current = null; importer.current?.reset();
        setData(current => current?.latestJob?.id === job.id && current.latestJob ? { ...current, latestJob: { ...current.latestJob, status: 'STALE' } } : current);
        throw new GenerationError(409, 'PLAN_STALE', '여행 조건이 바뀌어 생성한 일정을 가져오지 못했어요. 최신 조건으로 다시 만들어 주세요.');
      }
      await importCompletedPlan(id, plan.planId, plan.versionId, signal, own);
    } finally {
      if (processing.current === initialJob.id) processing.current = null;
      if (own === epoch.current && !signal.aborted) setBusy(false);
    }
  }, [importCompletedPlan]);

  const fail = useCallback((error: unknown, own: number, signal: AbortSignal) => {
    if (own !== epoch.current || signal.aborted) return;
    if (isGenerationAccessLost(error)) { callbacks.current.onAccessLost(); setOverlayOpen(false); }
    else {
      const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      const knownStop = status >= 400 && status < 500 && code !== 'VERSION_CONFLICT';
      if (knownStop) { failedPlan.current = null; importer.current?.reset(); }
      setMessage(error instanceof Error ? error.message : '일정 생성 상태를 확인하지 못했어요.'); setOverlayOpen(true); setRetryAvailable(!knownStop); setReturnAvailable(true); setError(true); setBusy(false);
    }
  }, []);

  const loadOwnIssues = useCallback(async (id: string, state: GenerationState, signal: AbortSignal, own: number) => {
    const codes = new Set(state.reasons.map(reason => reason.code));
    if (!codes.has('REQUIRED_PREFERENCE_UNSUPPORTED') && !codes.has('UNSATISFIED')) return;
    setPersonalIssues(undefined); issueInputToken.current = null;
    try {
      const issues = await getSelfPreparationIssues(id, state.conditionsVersion, signal);
      if (signal.aborted || own !== epoch.current || !issues) return;
      setPersonalIssues(issues); issueInputToken.current = state.inputToken;
    } catch { /* The public blocker remains accurate without private repair details. */ }
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !tripId) return null;
    controller.current?.abort();
    const own = ++epoch.current;
    const abort = new AbortController(); controller.current = abort;
    setLoading(true);
    try {
      const next = await getGeneration(tripId, abort.signal);
      if (own !== epoch.current || abort.signal.aborted) return null;
      acceptGenerationState(next); setMessage('');
      if (next.latestJob && ['QUEUED','RUNNING'].includes(next.latestJob.status) && !blockedReasonRef.current) {
        setOverlayOpen(true); setRetryAvailable(false);
        void processJob(tripId, next.latestJob, abort.signal, own).catch(error => fail(error, own, abort.signal));
      }
      return next;
    } catch (error) { fail(error, own, abort.signal); return null; }
    finally { if (own === epoch.current) setLoading(false); }
  }, [enabled, tripId, processJob, fail, acceptGenerationState]);

  useEffect(() => {
    epoch.current += 1; controller.current?.abort(); controller.current = null;
    starter.current?.reset(); importer.current?.reset(); processing.current = null; failedPlan.current = null;
    setData(null); setBusy(false); setLoading(false); setMessage(''); setOverlayOpen(false); setRetryAvailable(false); setReturnAvailable(false); setPhase('checking'); setError(false); setPersonalIssues(undefined); issueInputToken.current = null;
    if (enabled && tripId) void refresh();
    return () => { epoch.current += 1; controller.current?.abort(); controller.current = null; processing.current = null; };
  }, [enabled, tripId, refresh]);

  const start = useCallback(async () => {
    if (!enabled || !tripId || busy) return;
    if (blockedReason) { setMessage(blockedReason); return; }
    setOverlayOpen(true); setRetryAvailable(false); setReturnAvailable(false); setError(false); setPhase('checking'); setBusy(true); setMessage('');
    controller.current?.abort(); const own = ++epoch.current; const abort = new AbortController(); controller.current = abort;
    try {
      if (failedPlan.current) {
        await importCompletedPlan(tripId, failedPlan.current.planId, failedPlan.current.versionId, abort.signal, own);
        return;
      }
      const result = await starter.current!.start(tripId, abort.signal, () => blockedReasonRef.current);
      if (own !== epoch.current || abort.signal.aborted) return;
      if ('data' in result) acceptGenerationState(result.kind === 'started' ? { ...result.data, latestJob: result.job } : result.data);
      if (result.kind === 'active') await processJob(tripId, result.data.latestJob!, abort.signal, own);
      else if (result.kind === 'started') await processJob(tripId, result.job, abort.signal, own);
      else if (result.kind === 'not-ready') { await loadOwnIssues(tripId, result.data, abort.signal, own); setOverlayOpen(false); setMessage(readinessMessage(result.data)); }
      else if (result.kind === 'blocked') { setOverlayOpen(false); setMessage(result.reason); }
      else if (result.kind === 'busy') { setOverlayOpen(false); setMessage('일정 생성 상태를 확인하고 있어요. 잠시 후 다시 시도해 주세요.'); }
    } catch (error) { fail(error, own, abort.signal); }
    finally { if (own === epoch.current && !abort.signal.aborted) setBusy(false); }
  }, [blockedReason, enabled, tripId, busy, importCompletedPlan, processJob, fail, loadOwnIssues, acceptGenerationState]);

  const retry = useCallback(async () => {
    if (!tripId || !enabled || busy) return;
    setBusy(true); setOverlayOpen(true); setRetryAvailable(false); setReturnAvailable(false); setError(false); setPhase('checking'); setMessage('');
    controller.current?.abort(); const own = ++epoch.current; const abort = new AbortController(); controller.current = abort;
    try {
      if (failedPlan.current) { await importCompletedPlan(tripId, failedPlan.current.planId, failedPlan.current.versionId, abort.signal, own); return; }
      const fresh = await getGeneration(tripId, abort.signal);
      if (own !== epoch.current || abort.signal.aborted) return;
      acceptGenerationState(fresh);
      const job = fresh.latestJob;
      if (job && ['QUEUED','RUNNING','SUCCEEDED'].includes(job.status)) await processJob(tripId, job, abort.signal, own);
      else {
        const result = await starter.current!.start(tripId, abort.signal, () => blockedReasonRef.current);
        if (own !== epoch.current || abort.signal.aborted) return;
        if (result.kind === 'started') await processJob(tripId, result.job, abort.signal, own);
        else if (result.kind === 'active') await processJob(tripId, result.data.latestJob!, abort.signal, own);
        else { if (result.kind === 'not-ready') await loadOwnIssues(tripId, result.data, abort.signal, own); setOverlayOpen(false); setBusy(false); setMessage(result.kind === 'not-ready' ? readinessMessage(result.data) : '준비 화면에서 일정을 다시 시작해 주세요.'); }
      }
    } catch (error) { fail(error, own, abort.signal); }
    finally { if (own === epoch.current && !abort.signal.aborted) setBusy(false); }
  }, [tripId, enabled, busy, importCompletedPlan, processJob, fail, loadOwnIssues, acceptGenerationState]);

  const dismiss = useCallback(() => setOverlayOpen(false), []);
  return { data, loading, busy, message, personalIssues, start, refresh, overlayOpen, phase, error, retry, retryAction: retryAvailable ? retry : undefined, retryAvailable, returnAction: returnAvailable && !busy ? dismiss : undefined, dismiss };
}

function readinessMessage(state: GenerationState): string {
  const codes = new Set(state.reasons.map(reason => reason.code));
  if (codes.has('CONDITIONS_INCOMPLETE')) return '여행 날짜와 예산 등 기본조건을 저장해 주세요.';
  if (codes.has('MEMBER_COUNT_MISMATCH')) return '예정 인원과 현재 참여 인원을 맞춰 주세요.';
  if (codes.has('PREFERENCES_UNCONFIRMED') || codes.has('PREPARATION_INCOMPLETE')) return '참여자 모두 내 취향을 저장하고 준비 완료를 눌러야 해요.';
  if (codes.has('REQUIRED_PREFERENCE_UNSUPPORTED') || codes.has('UNSATISFIED')) return '내 취향에 생성 조건으로 반영할 수 없는 필수 항목이 있어요. 내 취향 입력을 확인해 주세요.';
  if (codes.has('COMMON_REVIEW_REQUIRED') || codes.has('LEGACY_ANCHOR_REQUIRED')) return '기존 숙소 또는 고정 약속 정보를 최신 장소·시간으로 확인해 주세요.';
  return '여행 준비 상태를 확인하고 빠진 조건을 저장해 주세요.';
}
