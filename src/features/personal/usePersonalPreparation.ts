import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyPersonalDraft, type PersonalDraft } from '../room/roomData.ts';
import {
  confirmMyPreferences, fetchMyPreferences, interpretMyPreferences, PersonalApiError, saveMyPreferences,
  type PersonalConfirmation,
} from './personalApi.ts';
import { derivePersonalSaveStatus, type PersonalSaveStatus } from './personalStatus.ts';
import {
  initialConditionsNoticeState, transitionConditionsNotice, type ConditionsNoticeState,
} from './conditionsChangedNotice.ts';

type HookState = {
  tripId: string | null;
  draft: PersonalDraft;
  savedDraft: PersonalDraft;
  state: 'loading' | 'ready' | 'error' | 'fatal';
  phase: 'idle' | 'saving' | 'analyzing' | 'confirming';
  resultStatus: 'empty' | 'stored' | 'analyzed' | 'stale';
  resultsVisible: boolean;
  analysisStep: 'source' | 'interpret' | 'result' | null;
  dirty: boolean;
  message: string;
  operationError: string;
  needsWalkingAnswer: boolean;
  confirmation: PersonalConfirmation | null;
  loadedConditionsVersion: number | null;
  preferenceVersion: number;
  reviewed: boolean;
};

const initialState = (tripId: string | null): HookState => ({
  tripId, draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, state: 'loading', phase: 'idle', resultStatus: 'empty', resultsVisible: false, analysisStep: null, dirty: false,
  message: '', operationError: '', needsWalkingAnswer: false, confirmation: null, loadedConditionsVersion: null, preferenceVersion: 0, reviewed: false,
});

function fatalError(error: unknown): boolean {
  return error instanceof PersonalApiError && (
    error.status === 401 || error.status === 403 || error.status === 404 || error.code === 'TRIP_CLOSED' || error.code === 'MEMBERSHIP_INACTIVE' || error.code === 'TRIP_NOT_ACCESSIBLE'
  );
}

function errorMessage(error: unknown, write = false, confirming = false): string {
  if (error instanceof PersonalApiError) {
    if (error.uncertain) return confirming ? '확인 결과를 알 수 없어요. 입력을 보존했어요. 새로고침해 최신 상태를 확인해 주세요.' : '저장 결과를 확인할 수 없어요. 입력은 유지했어요. 새로고침해 최신 저장 상태를 확인해 주세요.';
    if (error.status === 409) return confirming ? '공통 조건이나 저장된 취향이 바뀌었어요. 최신 내용을 다시 불러와 확인해 주세요.' : '다른 변경이 먼저 저장됐어요. 입력은 유지했어요. 새로고침해 최신 상태를 확인해 주세요.';
    if (error.code === 'ORIGINAL_TEXT_REQUIRED') return '먼저 개인 원문을 저장해 주세요.';
    if (error.code === 'PREFERENCES_INCOMPLETE' || error.code === 'WALKING_REQUIRED') return '걷기 시간을 선택해 주세요.';
    if (error.code === 'AI_UNAVAILABLE' || error.code === 'AI_TIMEOUT' || error.code === 'AI_INVALID_RESPONSE') return 'AI 해석을 완료하지 못했어요. 입력을 확인하고 다시 시도해 주세요.';
    if (Object.keys(error.fieldErrors).length) return Object.values(error.fieldErrors).filter(Boolean).join(' ');
    if (error.status === 401 || error.status === 403 || error.status === 404 || error.code === 'TRIP_CLOSED' || error.code === 'MEMBERSHIP_INACTIVE') return '이 여행방의 개인 준비 정보를 볼 수 없어요.';
    return confirming ? '준비를 완료하지 못했어요. 내용을 확인하고 다시 시도해 주세요.' : error.message;
  }
  return confirming ? '준비를 완료하지 못했어요. 입력은 유지했어요. 연결을 확인해 주세요.' : write ? '저장하지 못했어요. 입력은 유지했어요. 연결을 확인해 주세요.' : '개인 준비 정보를 불러오지 못했어요. 다시 시도해 주세요.';
}

function hasStoredResults(draft: PersonalDraft): boolean {
  return Boolean(draft.likes || draft.avoid || draft.food || draft.walking);
}

function hasSavedPreparation(draft: PersonalDraft, preferenceVersion: number): boolean {
  return hasStoredResults(draft) || preferenceVersion > 0;
}

export function usePersonalPreparation({
  tripId, enabled, conditionsVersion, onSaved,
}: { tripId: string | null; enabled: boolean; conditionsVersion: number; onSaved?: () => void }): {
  draft: PersonalDraft;
  savedDraft: PersonalDraft;
  state: 'loading' | 'ready' | 'error' | 'fatal';
  phase: 'idle' | 'saving' | 'analyzing' | 'confirming';
  resultStatus: 'empty' | 'stored' | 'analyzed' | 'stale';
  resultsVisible: boolean;
  analysisStep: 'source' | 'interpret' | 'result' | null;
  dirty: boolean;
  message: string;
  operationError: string;
  needsWalkingAnswer: boolean;
  confirmation: PersonalConfirmation | null;
  conditionsChangedNotice: { conditionsVersion: number } | null;
  reviewed: boolean;
  setReviewed: (reviewed: boolean) => void;
  canConfirm: boolean;
  saveStatus: PersonalSaveStatus;
  updateDraft: <K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) => void;
  reload: () => Promise<void>;
  save: () => Promise<boolean>;
  analyzeAndSave: () => Promise<boolean>;
  confirm: () => Promise<boolean>;
} {
  const [internal, setInternal] = useState(() => initialState(tripId));
  const internalRef = useRef(internal);
  const onSavedRef = useRef(onSaved);
  const editRevision = useRef(0);
  const sequence = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const [conditionsNotice, setConditionsNotice] = useState<ConditionsNoticeState>(initialConditionsNoticeState);
  const conditionsNoticeRef = useRef(conditionsNotice);
  const noticeTripIdRef = useRef(tripId);
  const conditionsVersionRef = useRef(conditionsVersion);
  conditionsVersionRef.current = conditionsVersion;

  const transitionNotice = useCallback((event: Parameters<typeof transitionConditionsNotice>[1]) => {
    const next = transitionConditionsNotice(conditionsNoticeRef.current, event);
    conditionsNoticeRef.current = next;
    setConditionsNotice(next);
  }, []);

  const update = useCallback((next: HookState) => {
    internalRef.current = next;
    setInternal(next);
  }, []);

  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  const reload = useCallback(async (): Promise<void> => {
    if (!tripId || !enabled) return;
    activeController.current?.abort();
    lock.current = false;
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++sequence.current;
    const beforeReload = internalRef.current;
    const retained = beforeReload.tripId === tripId ? beforeReload : initialState(tripId);
    update({ ...retained, state: 'loading', phase: 'idle',
      resultStatus: hasStoredResults(retained.draft) ? 'stale' : 'empty', analysisStep: null, needsWalkingAnswer: false,
      message: '저장된 개인 준비를 불러오는 중이에요.', operationError: '', reviewed: false });
    try {
      const result = await fetchMyPreferences(tripId, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== sequence.current) return;
      editRevision.current += 1;
      const conditionsMatch = result.conditionsVersion === conditionsVersionRef.current;
      if (conditionsMatch && result.confirmation.status === 'confirmed') {
        // A lost confirm response or another tab can already have completed this version.
        transitionNotice({ type: 'observe', conditionsVersion: conditionsVersionRef.current });
        transitionNotice({ type: 'confirmed', conditionsVersion: result.conditionsVersion });
      }
      update({
        tripId, draft: result.draft, savedDraft: result.draft, state: conditionsMatch ? 'ready' : 'error', phase: 'idle',
        resultStatus: hasStoredResults(result.draft) ? 'stored' : 'empty', resultsVisible: retained.resultsVisible || hasSavedPreparation(result.draft, result.preferenceVersion), analysisStep: null, dirty: false,
        message: conditionsMatch ? '' : '공통 여행 조건이 바뀌었어요. 개인 준비를 새로고침해 주세요.', operationError: conditionsMatch ? '' : '공통 여행 조건이 바뀌었어요. 개인 준비를 새로고침해 주세요.', needsWalkingAnswer: false, confirmation: result.confirmation, reviewed: false,
        loadedConditionsVersion: result.conditionsVersion, preferenceVersion: result.preferenceVersion,
      });
    } catch (error) {
      if (controller.signal.aborted || requestId !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      const fatal = fatalError(error);
      update({ ...internalRef.current, ...(fatal ? { draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, confirmation: null, needsWalkingAnswer: false, resultsVisible: false, preferenceVersion: 0, loadedConditionsVersion: null, dirty: false, reviewed: false } : {}), state: fatal ? 'fatal' : 'error', phase: 'idle', resultStatus: fatal ? 'empty' : hasStoredResults(internalRef.current.savedDraft) ? 'stale' : 'empty', analysisStep: null, message: errorMessage(error), operationError: errorMessage(error) });
    }
  }, [enabled, transitionNotice, tripId, update]);

  useEffect(() => {
    sequence.current += 1;
    activeController.current?.abort();
    lock.current = false;
    editRevision.current = 0;
    internalRef.current = initialState(tripId);
    // Loading the newly active trip is the effect's external synchronization step.
    // oxlint-disable-next-line react(set-state-in-effect)
    if (tripId && enabled) void reload();
    return () => {
      sequence.current += 1;
      activeController.current?.abort();
      activeController.current = null;
      lock.current = false;
    };
  }, [tripId, enabled, reload, update]);

  useEffect(() => {
    if (noticeTripIdRef.current !== tripId) {
      noticeTripIdRef.current = tripId;
      transitionNotice({ type: 'reset' });
    }
    transitionNotice({ type: 'observe', conditionsVersion });
  }, [conditionsVersion, transitionNotice, tripId]);

  useEffect(() => {
    const current = internalRef.current;
    if (current.tripId === tripId && current.loadedConditionsVersion !== null && current.loadedConditionsVersion !== conditionsVersion) {
      activeController.current?.abort();
      sequence.current += 1;
      lock.current = false;
      if ((current.state === 'ready' || current.state === 'loading') && !current.dirty && current.phase === 'idle' && enabled) {
        void reload();
      } else {
        update({ ...current, phase: 'idle', analysisStep: null, reviewed: false, resultStatus: hasStoredResults(current.draft) ? 'stale' : 'empty', message: '공통 여행 조건이 바뀌었어요. 최신 조건을 확인한 뒤 개인 준비를 다시 확인해 주세요.' });
      }
    }
  }, [conditionsVersion, enabled, reload, tripId, update]);

  const updateDraft = useCallback(<K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) => {
    const current = internalRef.current;
    if (!tripId || current.tripId !== tripId || current.state !== 'ready' || current.phase !== 'idle') return;
    const draft = { ...current.draft, [key]: value };
    editRevision.current += 1;
    const rawTextChanged = key === 'originalText' && value !== current.draft.originalText;
    update({ ...current, draft, dirty: JSON.stringify(draft) !== JSON.stringify(current.savedDraft),
      resultStatus: rawTextChanged ? (hasStoredResults(current.draft) ? 'stale' : 'empty') : current.resultStatus,
      needsWalkingAnswer: key === 'walking' && value !== '' ? false : current.needsWalkingAnswer, reviewed: false, message: '', operationError: '' });
  }, [tripId, update]);

  const save = useCallback(async (): Promise<boolean> => {
    const current = internalRef.current;
    if (!tripId || !enabled || lock.current || current.tripId !== tripId || current.state !== 'ready' || current.loadedConditionsVersion !== conditionsVersion) return false;
    lock.current = true;
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++sequence.current;
    const revision = editRevision.current;
    const snapshot = current.draft;
    update({ ...current, phase: 'saving', reviewed: false, analysisStep: null, message: '개인 준비를 저장하고 있어요.', operationError: '' });
    try {
      const result = await saveMyPreferences(tripId, conditionsVersion, current.preferenceVersion, snapshot, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      const unchanged = revision === editRevision.current;
      update({
        ...internalRef.current, ...(unchanged ? { draft: result.draft } : {}), savedDraft: result.draft,
        state: 'ready', phase: 'idle', analysisStep: null, dirty: !unchanged,
        message: '취향을 저장했어요.', confirmation: result.confirmation, preferenceVersion: result.preferenceVersion,
        loadedConditionsVersion: result.conditionsVersion,
      });
      onSavedRef.current?.();
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestId !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return false;
      const fatal = fatalError(error);
      const blocked = error instanceof PersonalApiError && (error.status === 409 || error.uncertain);
      update({ ...internalRef.current, ...(fatal ? { draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, confirmation: null, needsWalkingAnswer: false, resultsVisible: false, preferenceVersion: 0, loadedConditionsVersion: null, dirty: false, reviewed: false } : {}), state: fatal ? 'fatal' : blocked ? 'error' : 'ready', phase: 'idle', resultStatus: fatal ? 'empty' : internalRef.current.resultStatus, message: errorMessage(error, true), operationError: errorMessage(error, true) });
      return false;
    } finally {
      if (requestId === sequence.current) lock.current = false;
    }
  }, [conditionsVersion, enabled, tripId, update]);

  const analyzeAndSave = useCallback(async (): Promise<boolean> => {
    const current = internalRef.current;
    if (!tripId || !enabled || lock.current || current.tripId !== tripId || current.state !== 'ready' || current.loadedConditionsVersion !== conditionsVersion) return false;
    lock.current = true;
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++sequence.current;
    const revision = editRevision.current;
    const original = current.draft;
    update({ ...current, phase: 'analyzing', reviewed: false, operationError: '', analysisStep: 'source', resultStatus: hasStoredResults(current.draft) ? 'stale' : 'empty', message: '원문을 저장하고 내용을 분석하고 있어요.' });
    try {
      const savedRaw = await saveMyPreferences(tripId, conditionsVersion, current.preferenceVersion, original, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      if (revision !== editRevision.current) {
        update({ ...internalRef.current, savedDraft: savedRaw.draft, preferenceVersion: savedRaw.preferenceVersion, confirmation: savedRaw.confirmation, phase: 'idle', analysisStep: null, resultStatus: hasStoredResults(savedRaw.draft) ? 'stale' : 'empty', dirty: true, message: '입력이 바뀌어 분석을 멈췄어요. 다시 분석해 주세요.' });
        onSavedRef.current?.();
        return false;
      }
      update({ ...internalRef.current, draft: savedRaw.draft, savedDraft: savedRaw.draft, preferenceVersion: savedRaw.preferenceVersion, confirmation: savedRaw.confirmation, reviewed: false, dirty: false, analysisStep: 'interpret', message: '저장한 원문을 분석하고 있어요.' });
      onSavedRef.current?.();
      const interpreted = await interpretMyPreferences(tripId, conditionsVersion, savedRaw.preferenceVersion, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      if (revision !== editRevision.current || interpreted.sourceConditionsVersion !== conditionsVersion || interpreted.sourcePreferenceVersion !== savedRaw.preferenceVersion) {
        const conditionsChanged = interpreted.sourceConditionsVersion !== conditionsVersion;
        update({ ...internalRef.current, phase: 'idle', analysisStep: null, resultStatus: hasStoredResults(internalRef.current.savedDraft) ? 'stale' : 'empty', dirty: true,
          message: conditionsChanged
            ? '공통 여행 조건이 바뀌어 분석 결과를 저장하지 않았어요. 최신 조건을 확인한 뒤 개인 준비를 새로고침해 주세요.'
            : '입력이 바뀌어 분석 결과를 저장하지 않았어요. 새로고침해 확인해 주세요.' });
        return false;
      }
      const merged: PersonalDraft = {
        ...savedRaw.draft,
        likes: interpreted.suggestions.likes,
        avoid: interpreted.suggestions.avoid,
        avoidImportance: interpreted.suggestions.avoidImportance,
        food: interpreted.suggestions.food,
        foodImportance: interpreted.suggestions.foodImportance,
        walking: interpreted.needsWalkingAnswer ? savedRaw.draft.walking : interpreted.suggestions.walking,
      };
      update({ ...internalRef.current, phase: 'analyzing', analysisStep: 'result', message: '분석 결과를 저장하고 있어요.' });
      const finalResult = await saveMyPreferences(tripId, conditionsVersion, savedRaw.preferenceVersion, merged, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      if (revision !== editRevision.current) {
        update({ ...internalRef.current, savedDraft: finalResult.draft, preferenceVersion: finalResult.preferenceVersion, confirmation: finalResult.confirmation, phase: 'idle', resultsVisible: true, analysisStep: null, resultStatus: 'stale', dirty: true, message: '입력이 바뀌어 분석 결과를 화면에 적용하지 않았어요. 새로고침해 확인해 주세요.' });
        onSavedRef.current?.();
        return false;
      }
      update({ ...internalRef.current, draft: finalResult.draft, savedDraft: finalResult.draft, state: 'ready', phase: 'idle', resultStatus: 'analyzed', resultsVisible: true, analysisStep: null, dirty: false, reviewed: false, confirmation: finalResult.confirmation, preferenceVersion: finalResult.preferenceVersion, loadedConditionsVersion: finalResult.conditionsVersion, needsWalkingAnswer: interpreted.needsWalkingAnswer, message: interpreted.needsWalkingAnswer ? '걷기 시간을 선택해 주세요.' : '취향을 분석하고 저장했어요.' });
      onSavedRef.current?.();
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestId !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return false;
      const fatal = fatalError(error);
      const blocked = error instanceof PersonalApiError && (error.status === 409 || error.uncertain);
      update({ ...internalRef.current, ...(fatal ? { draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, confirmation: null, needsWalkingAnswer: false, resultsVisible: false, preferenceVersion: 0, loadedConditionsVersion: null, dirty: false, reviewed: false } : {}), state: fatal ? 'fatal' : blocked ? 'error' : 'ready', phase: 'idle', analysisStep: null, resultStatus: fatal ? 'empty' : hasStoredResults(internalRef.current.savedDraft) ? 'stale' : 'empty', message: errorMessage(error, true), operationError: errorMessage(error, true) });
      return false;
    } finally {
      if (requestId === sequence.current) lock.current = false;
    }
  }, [conditionsVersion, enabled, tripId, update]);

  const setReviewed = useCallback((reviewed: boolean) => {
    const current = internalRef.current;
    if (!tripId || current.tripId !== tripId || current.state !== 'ready' || current.phase !== 'idle' || current.loadedConditionsVersion !== conditionsVersion) return;
    update({ ...current, reviewed, message: '', operationError: '' });
  }, [conditionsVersion, tripId, update]);

  const confirm = useCallback(async (): Promise<boolean> => {
    const current = internalRef.current;
    const saved = current.savedDraft;
    const eligible = Boolean(
      tripId && enabled && !lock.current && current.tripId === tripId && current.state === 'ready' &&
      current.phase === 'idle' && current.reviewed && !current.dirty &&
      current.loadedConditionsVersion === conditionsVersion && saved.originalText.trim() && saved.likes.trim() &&
      (saved.walking === '20' || saved.walking === '40' || saved.walking === 'unlimited') &&
      current.confirmation?.status !== 'confirmed'
    );
    if (!eligible || !tripId) return false;

    lock.current = true;
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++sequence.current;
    const revision = editRevision.current;
    update({ ...current, phase: 'confirming', message: '개인 준비를 확인하고 있어요.', operationError: '' });
    try {
      const result = await confirmMyPreferences(tripId, conditionsVersion, current.preferenceVersion, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== sequence.current || revision !== editRevision.current) return false;
      transitionNotice({ type: 'observe', conditionsVersion: conditionsVersionRef.current });
      transitionNotice({ type: 'confirmed', conditionsVersion: result.conditionsVersion });
      update({ ...internalRef.current, state: 'ready', phase: 'idle', confirmation: result.confirmation, preferenceVersion: result.preferenceVersion,
        loadedConditionsVersion: result.conditionsVersion, reviewed: false, message: '준비를 완료했어요.' });
      onSavedRef.current?.();
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestId !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return false;
      const fatal = fatalError(error);
      const blocked = error instanceof PersonalApiError && (error.status === 409 || error.uncertain);
      update({ ...internalRef.current, ...(fatal ? { draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, confirmation: null, needsWalkingAnswer: false, resultsVisible: false, preferenceVersion: 0, loadedConditionsVersion: null, dirty: false, reviewed: false } : { reviewed: true }), state: fatal ? 'fatal' : blocked ? 'error' : 'ready', phase: 'idle', message: errorMessage(error, true, true), operationError: errorMessage(error, true, true) });
      return false;
    } finally {
      if (requestId === sequence.current) lock.current = false;
    }
  }, [conditionsVersion, enabled, transitionNotice, tripId, update]);

  const visible = internal.tripId === tripId && enabled ? internal : initialState(tripId);
  const staleConditions = visible.state !== 'loading' && visible.loadedConditionsVersion !== null && visible.loadedConditionsVersion !== conditionsVersion;
  const effectiveState = staleConditions ? 'error' : visible.state;
  const effectivePhase = staleConditions ? 'idle' : visible.phase;
  const conditionsChanged = visible.loadedConditionsVersion !== null && visible.loadedConditionsVersion !== conditionsVersion;
  const canConfirm = Boolean(
    effectiveState === 'ready' && effectivePhase === 'idle' && visible.reviewed && !visible.dirty && !conditionsChanged &&
    visible.loadedConditionsVersion === conditionsVersion && visible.savedDraft.originalText.trim() && visible.savedDraft.likes.trim() &&
    (visible.savedDraft.walking === '20' || visible.savedDraft.walking === '40' || visible.savedDraft.walking === 'unlimited') &&
    visible.confirmation?.status !== 'confirmed'
  );
  return {
    draft: visible.draft, savedDraft: visible.savedDraft, state: effectiveState, phase: effectivePhase,
    resultStatus: visible.resultStatus, resultsVisible: visible.resultsVisible, analysisStep: staleConditions ? null : visible.analysisStep,
    dirty: visible.dirty, message: staleConditions ? '공통 여행 조건이 바뀌었어요. 개인 준비를 새로고침해 주세요.' : visible.message, operationError: staleConditions ? '' : visible.operationError, needsWalkingAnswer: visible.needsWalkingAnswer,
    confirmation: visible.confirmation,
    conditionsChangedNotice: visible.state !== 'fatal' && internal.state !== 'fatal' && internal.tripId === tripId && conditionsNotice.pendingVersion !== null
      ? { conditionsVersion: conditionsNotice.pendingVersion }
      : null,
    reviewed: visible.reviewed, setReviewed, canConfirm, confirm,
    saveStatus: derivePersonalSaveStatus({
      state: effectiveState, phase: effectivePhase, dirty: visible.dirty, savedDraft: visible.savedDraft,
      preferenceVersion: visible.preferenceVersion, confirmation: visible.confirmation, conditionsChanged,
    }),
    updateDraft, reload, save, analyzeAndSave,
  };
}
