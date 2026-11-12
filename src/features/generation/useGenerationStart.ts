import { useCallback, useEffect, useRef, useState } from 'react';
import { createJob, GenerationError, getGeneration, getJob, getPlan, getSelfPreparationIssues, type GenerationState, type Job, type Plan, type SelfDto } from './generationApi';
import { createGenerationStartController } from './generationStartController';
import { CanvasHttpError, getCanvas, importPlanToCanvas } from '../workspace/canvasApi.ts';
import { acceptImportedCanvasState } from '../workspace/useCanvasSync.ts';
import { createGenerationCanvasImportController } from './generationCanvasImportController.ts';
import { isGenerationAccessLost } from './generationAccess.ts';
import type { GenerationLoadingPhase } from './generationProgress.ts';
import { mayCompleteHandoff, waitForTwoPaints } from './generationHandoff.ts';
import { readinessMessage } from './generationReadiness.ts';

export type GenerationPlanWarningCode = 'MEAL_SLOT_UNFILLED' | 'TRANSFER_TIME_ESTIMATED' | 'STAY_TIME_ESTIMATED';
export type GenerationCanvasHandoff = { tripId: string; planId: string; versionId: string; handoffId: string; warningCodes?: GenerationPlanWarningCode[] };
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
function jobFailureMessage(code: string | null): string {
  if (code === 'SCHEDULE_WINDOW_INFEASIBLE') return '확정된 약속과 실제 이동 시간을 포함하면 설정한 활동 종료 시각까지 일정을 마치기 어려워요. 약속 시간이나 활동 시간을 조정해 주세요.';
  if (code === 'REQUIRED_PREFERENCE_UNSUPPORTED' || code === 'REQUIRED_PREFERENCE_UNSATISFIED' || code === 'UNSATISFIED') return '필수 취향 조건을 일정에 안전하게 반영할 수 없어요. 내 취향 항목을 확인해 주세요.';
  return '일정 생성을 완료하지 못했어요. 준비 화면에서 다시 시작해 주세요.';
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
  const [dismissedIssueFields, setDismissedIssueFields] = useState<Set<string>>(() => new Set());
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const operationLock = useRef<symbol | null>(null);
  const refreshLock = useRef<symbol | null>(null);
  const starter = useRef<ReturnType<typeof createGenerationStartController> | null>(null);
  const callbacks = useRef({ onStarted, onAccessLost });
  const blockedReasonRef = useRef(blockedReason);
  const processing = useRef<string | null>(null);
  const importer = useRef<ReturnType<typeof createGenerationCanvasImportController> | null>(null);
  const failedPlan = useRef<{ planId: string; versionId: string; status: Plan['status']; warningCodes: GenerationPlanWarningCode[] } | null>(null);
  const issueInputToken = useRef<string | null>(null);
  const readinessRevision = useRef(0);
  const runReadinessRevision = useRef(0);
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
  /* eslint-disable react/set-state-in-effect */
  useEffect(() => {
    const changed = blockedReasonRef.current !== blockedReason;
    blockedReasonRef.current = blockedReason;
    if (changed) {
      readinessRevision.current += 1;
      failedPlan.current = null;
      importer.current?.reset();
      setMessage(''); setError(false); setRetryAvailable(false); setReturnAvailable(false);
      // A readiness edit invalidates stale request messages and the blocking overlay.
      if (blockedReason) setOverlayOpen(false);
    }
  }, [blockedReason]);
  /* eslint-enable react/set-state-in-effect */
  const acceptGenerationState = useCallback((next: GenerationState) => {
    if (issueInputToken.current && issueInputToken.current !== next.inputToken) { issueInputToken.current = null; setPersonalIssues(undefined); setDismissedIssueFields(new Set()); }
    setData(next);
  }, []);

  const importCompletedPlan = useCallback(async (id: string, planId: string, versionId: string, planStatus: Plan['status'], warningCodes: GenerationPlanWarningCode[], signal: AbortSignal, own: number) => {
    setPhase('opening');
    if (blockedReasonRef.current || runReadinessRevision.current !== readinessRevision.current) {
      setBusy(false); setOverlayOpen(false); setReturnAvailable(false); setError(false);
      setMessage('입력이 바뀌어 일정을 열지 않았어요. 변경 내용을 저장한 뒤 일정 만들기를 눌러 주세요.');
      return;
    }
    failedPlan.current = { planId, versionId, status: planStatus, warningCodes };
    const imported = await importer.current!.run(id, planId, versionId, signal);
    if (signal.aborted || own !== epoch.current) return;
    const latest = await getCanvas(id, { signal });
    if (signal.aborted || own !== epoch.current) return;
    if (latest.revision < imported.revision) throw new CanvasHttpError(502, 'INVALID_RESPONSE', '가져온 캔버스의 최신 상태를 확인할 수 없어요.');
    await acceptImportedCanvasState(id, latest, signal);
    setData(current => current ? { ...current, latestPlan: { planId, versionId, status: planStatus, current: true } } : current);
    if (!mayCompleteHandoff(signal, own, epoch.current, blockedReasonRef.current)
        || runReadinessRevision.current !== readinessRevision.current) {
      if (!signal.aborted && own === epoch.current && (blockedReasonRef.current || runReadinessRevision.current !== readinessRevision.current)) {
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
    if (blockedReasonRef.current || runReadinessRevision.current !== readinessRevision.current) {
      setMessage('생성한 일정은 캔버스에 담겼어요. 입력을 저장한 뒤 일정 캔버스를 열어 주세요.');
      setOverlayOpen(false); setReturnAvailable(false); setError(false);
      return;
    }
    const handoff: GenerationCanvasHandoff = { tripId: id, planId, versionId, handoffId: crypto.randomUUID(), warningCodes };
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
      if (job.status !== 'SUCCEEDED' || !job.planId) throw new GenerationError(409, job.errorCode ?? 'GENERATION_FAILED', jobFailureMessage(job.errorCode));
      if (blockedReasonRef.current || runReadinessRevision.current !== readinessRevision.current) {
        setOverlayOpen(false); setRetryAvailable(false); setReturnAvailable(false); setError(false);
        setMessage('입력이 바뀌어 일정을 열지 않았어요. 변경 내용을 저장한 뒤 일정 만들기를 눌러 주세요.');
        return;
      }
      setPhase('routing');
      const plan = await getPlan(id, job.planId, signal);
      if (signal.aborted || own !== epoch.current) return;
      if (plan.versionId.length === 0 || plan.stale) {
        failedPlan.current = null; importer.current?.reset();
        setData(current => current?.latestJob?.id === job.id && current.latestJob ? { ...current, latestJob: { ...current.latestJob, status: 'STALE' } } : current);
        throw new GenerationError(409, 'PLAN_STALE', '여행 조건이 바뀌어 생성한 일정을 가져오지 못했어요. 최신 조건으로 다시 만들어 주세요.');
      }
      const supportedWarnings = new Set<GenerationPlanWarningCode>(['MEAL_SLOT_UNFILLED', 'TRANSFER_TIME_ESTIMATED', 'STAY_TIME_ESTIMATED']);
      const warnings = plan.document?.validation?.warnings;
      const warningCodes = Array.isArray(warnings)
        ? [...new Set(warnings.filter((code): code is GenerationPlanWarningCode => supportedWarnings.has(code as GenerationPlanWarningCode)))]
        : [];
      await importCompletedPlan(id, plan.planId, plan.versionId, plan.status, warningCodes, signal, own);
    } finally {
      if (processing.current === initialJob.id) processing.current = null;
      if (own === epoch.current && !signal.aborted) setBusy(false);
    }
  }, [importCompletedPlan]);

  const fail = useCallback((error: unknown, own: number, signal: AbortSignal, showOverlay = true) => {
    if (own !== epoch.current || signal.aborted) return;
    if (isGenerationAccessLost(error)) { callbacks.current.onAccessLost(); setOverlayOpen(false); }
    else {
      const status = error && typeof error === 'object' && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
      const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
      const knownStop = status >= 400 && status < 500 && code !== 'VERSION_CONFLICT';
      if (knownStop) { failedPlan.current = null; importer.current?.reset(); }
      setMessage(error instanceof Error ? error.message : '일정 생성 상태를 확인하지 못했어요.');
      setOverlayOpen(showOverlay); setRetryAvailable(showOverlay && !knownStop); setReturnAvailable(showOverlay); setError(showOverlay); setBusy(false);
    }
  }, []);

  const loadOwnIssues = useCallback(async (id: string, state: GenerationState, signal: AbortSignal, own: number) => {
    const codes = new Set(state.reasons.map(reason => reason.code));
    if (!codes.has('REQUIRED_PREFERENCE_UNSUPPORTED') && !codes.has('REQUIRED_PREFERENCE_UNSATISFIED') && !codes.has('UNSATISFIED')) return;
    setPersonalIssues(undefined); setDismissedIssueFields(new Set()); issueInputToken.current = null;
    try {
      const issues = await getSelfPreparationIssues(id, state.conditionsVersion, signal);
      if (signal.aborted || own !== epoch.current || !issues) return;
      setPersonalIssues(issues); issueInputToken.current = state.inputToken;
    } catch { /* The public blocker remains accurate without private repair details. */ }
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled || !tripId || operationLock.current || processing.current || refreshLock.current) return null;
    const refreshToken = Symbol('generation-refresh');
    refreshLock.current = refreshToken;
    controller.current?.abort();
    const own = ++epoch.current;
    const abort = new AbortController(); controller.current = abort;
    setLoading(true);
    try {
      const next = await getGeneration(tripId, abort.signal);
      if (own !== epoch.current || abort.signal.aborted) return null;
      acceptGenerationState(next); setMessage('');
      if (next.latestJob && ['QUEUED','RUNNING'].includes(next.latestJob.status) && !blockedReasonRef.current) {
        setRetryAvailable(false);
        runReadinessRevision.current = readinessRevision.current;
        void processJob(tripId, next.latestJob, abort.signal, own).catch(error => fail(error, own, abort.signal));
      }
      return next;
    } catch (error) { fail(error, own, abort.signal, false); return null; }
    finally {
      if (refreshLock.current === refreshToken) refreshLock.current = null;
      if (own === epoch.current) setLoading(false);
    }
  }, [enabled, tripId, processJob, fail, acceptGenerationState]);

  // Reset all request-scoped state when the room scope changes.
  /* eslint-disable react/set-state-in-effect */
  useEffect(() => {
    epoch.current += 1; controller.current?.abort(); controller.current = null;
    operationLock.current = null; refreshLock.current = null;
    starter.current?.reset(); importer.current?.reset(); processing.current = null; failedPlan.current = null;
    setData(null); setBusy(false); setLoading(false); setMessage(''); setOverlayOpen(false); setRetryAvailable(false); setReturnAvailable(false); setPhase('checking'); setError(false); setPersonalIssues(undefined); issueInputToken.current = null;
    if (enabled && tripId) void refresh();
    return () => { epoch.current += 1; controller.current?.abort(); controller.current = null; processing.current = null; };
  }, [enabled, tripId, refresh]);
  /* eslint-enable react/set-state-in-effect */

  const start = useCallback(async () => {
    if (!enabled || !tripId || busy || operationLock.current || processing.current) return;
    if (blockedReasonRef.current) { setMessage(blockedReasonRef.current); return; }
    const operationToken = Symbol('generation-start');
    operationLock.current = operationToken;
    setLoading(false); setOverlayOpen(false); setRetryAvailable(false); setReturnAvailable(false); setError(false); setPhase('checking'); setBusy(true); setMessage('');
    runReadinessRevision.current = readinessRevision.current;
    controller.current?.abort(); const own = ++epoch.current; const abort = new AbortController(); controller.current = abort;
    refreshLock.current = null;
    let showOperationOverlay = false;
    try {
      if (failedPlan.current) {
        showOperationOverlay = true; setOverlayOpen(true);
        await importCompletedPlan(tripId, failedPlan.current.planId, failedPlan.current.versionId, failedPlan.current.status, failedPlan.current.warningCodes, abort.signal, own);
        return;
      }
      const openOnlyPlan = data?.latestPlan?.current && data.latestJob?.status === 'SUCCEEDED'
        ? { planId: data.latestPlan.planId, versionId: data.latestPlan.versionId }
        : undefined;
      const result = await starter.current!.start(tripId, abort.signal, () => blockedReasonRef.current, () => {
        showOperationOverlay = true; setOverlayOpen(true); setError(false); setPhase('generating');
      }, openOnlyPlan);
      if (own !== epoch.current || abort.signal.aborted) return;
      if ('data' in result) acceptGenerationState(result.kind === 'started' ? { ...result.data, latestJob: result.job } : result.data);
      if (result.kind === 'active') { showOperationOverlay = true; await processJob(tripId, result.data.latestJob!, abort.signal, own); }
      else if (result.kind === 'started') { showOperationOverlay = true; await processJob(tripId, result.job, abort.signal, own); }
      else if (result.kind === 'not-ready') { void loadOwnIssues(tripId, result.data, abort.signal, own); setOverlayOpen(false); setMessage(readinessMessage(result.data)); }
      else if (result.kind === 'changed') { setOverlayOpen(false); setError(false); setMessage('여행 조건이나 참여자 준비가 바뀌어 기존 일정이 최신이 아니에요. 새 일정을 만들려면 한 번 더 눌러 주세요.'); }
      else if (result.kind === 'blocked') { setOverlayOpen(false); setMessage(result.reason); }
      else if (result.kind === 'busy') { setOverlayOpen(false); setMessage('일정 생성 상태를 확인하고 있어요. 잠시 후 다시 시도해 주세요.'); }
    } catch (error) { fail(error, own, abort.signal, showOperationOverlay); }
    finally {
      if (own === epoch.current && !abort.signal.aborted) setBusy(false);
      if (operationLock.current === operationToken) operationLock.current = null;
    }
  }, [enabled, tripId, busy, data, importCompletedPlan, processJob, fail, loadOwnIssues, acceptGenerationState]);

  const retry = useCallback(async () => {
    if (!tripId || !enabled || busy || operationLock.current || processing.current) return;
    if (blockedReasonRef.current) { setMessage(blockedReasonRef.current); setOverlayOpen(false); return; }
    if (failedPlan.current && blockedReasonRef.current) { setMessage(blockedReasonRef.current); setOverlayOpen(false); return; }
    const operationToken = Symbol('generation-retry');
    operationLock.current = operationToken;
    setLoading(false); setBusy(true); setOverlayOpen(false); setRetryAvailable(false); setReturnAvailable(false); setError(false); setPhase('checking'); setMessage('');
    runReadinessRevision.current = readinessRevision.current;
    controller.current?.abort(); const own = ++epoch.current; const abort = new AbortController(); controller.current = abort;
    refreshLock.current = null;
    let showOperationOverlay = false;
    try {
      if (failedPlan.current) { showOperationOverlay = true; setOverlayOpen(true); await importCompletedPlan(tripId, failedPlan.current.planId, failedPlan.current.versionId, failedPlan.current.status, failedPlan.current.warningCodes, abort.signal, own); return; }
      const fresh = await getGeneration(tripId, abort.signal);
      if (own !== epoch.current || abort.signal.aborted) return;
      acceptGenerationState(fresh);
      const job = fresh.latestJob;
      if (job && ['QUEUED','RUNNING','SUCCEEDED'].includes(job.status)) { showOperationOverlay = true; await processJob(tripId, job, abort.signal, own); }
      else {
        const result = await starter.current!.start(tripId, abort.signal, () => blockedReasonRef.current, () => { showOperationOverlay = true; setOverlayOpen(true); setError(false); setPhase('generating'); });
        if (own !== epoch.current || abort.signal.aborted) return;
        if (result.kind === 'started') { showOperationOverlay = true; await processJob(tripId, result.job, abort.signal, own); }
        else if (result.kind === 'active') { showOperationOverlay = true; await processJob(tripId, result.data.latestJob!, abort.signal, own); }
        else { if (result.kind === 'not-ready') { void loadOwnIssues(tripId, result.data, abort.signal, own); setMessage(readinessMessage(result.data)); } else setMessage('준비 화면에서 일정을 다시 시작해 주세요.'); setOverlayOpen(false); setBusy(false); }
      }
    } catch (error) { fail(error, own, abort.signal, showOperationOverlay); }
    finally {
      if (own === epoch.current && !abort.signal.aborted) setBusy(false);
      if (operationLock.current === operationToken) operationLock.current = null;
    }
  }, [tripId, enabled, busy, importCompletedPlan, processJob, fail, loadOwnIssues, acceptGenerationState]);

  const dismiss = useCallback(() => setOverlayOpen(false), []);
  const clearPersonalIssue = useCallback((field?: NonNullable<SelfDto['preparationIssues']>[number]['field']) => {
    setDismissedIssueFields(current => field ? new Set([...current, field]) : new Set(['likes', 'avoid', 'food', 'walking']));
  }, []);
  const visiblePersonalIssues = personalIssues?.filter(issue => !dismissedIssueFields.has(issue.field));
  const hasCurrentPlan = Boolean(data?.latestPlan?.current && data.latestJob?.status === 'SUCCEEDED');
  return { data, loading, busy, message, hasCurrentPlan, personalIssues: visiblePersonalIssues, clearPersonalIssue, start, refresh, overlayOpen, phase, error, retry, retryAction: retryAvailable ? retry : undefined, retryAvailable, returnAction: returnAvailable && !busy ? dismiss : undefined, dismiss };
}
