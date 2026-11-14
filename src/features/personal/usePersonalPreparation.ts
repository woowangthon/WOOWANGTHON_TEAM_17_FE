import { useCallback, useEffect, useRef, useState } from 'react';
import { draftChangeInvalidatesAtomicProfile, emptyPersonalDraft, projectInterpretedWalking, type PersonalDraft, type UnresolvedAcknowledgement, type UnresolvedAcknowledgements, type UnresolvedNote } from '../room/roomData.ts';
import {
  confirmMyPreferences, fetchMyPreferences, interpretMyPreferences, PersonalApiError, saveMyPreferences,
  type PersonalConfirmation,
} from './personalApi.ts';
import { derivePersonalSaveStatus, type PersonalSaveStatus } from './personalStatus.ts';
import {
  initialConditionsNoticeState, transitionConditionsNotice, type ConditionsNoticeState,
} from './conditionsChangedNotice.ts';
import type { PersonalPreferences } from './personalApi.ts';

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
  clarifications: PersonalPreferences['clarifications'];
  reviewAcknowledgements: UnresolvedAcknowledgements | null;
  savedReviewAcknowledgements: UnresolvedAcknowledgements | null;
};

const initialState = (tripId: string | null): HookState => ({
  tripId, draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, state: 'loading', phase: 'idle', resultStatus: 'empty', resultsVisible: false, analysisStep: null, dirty: false,
  message: '', operationError: '', needsWalkingAnswer: false, confirmation: null, loadedConditionsVersion: null, preferenceVersion: 0, clarifications: [], reviewAcknowledgements: null, savedReviewAcknowledgements: null,
});

function fatalError(error: unknown): boolean {
  return error instanceof PersonalApiError && (
    error.status === 401 || error.status === 403 || error.status === 404 || error.code === 'TRIP_CLOSED' || error.code === 'MEMBERSHIP_INACTIVE' || error.code === 'TRIP_NOT_ACCESSIBLE'
  );
}

function errorMessage(error: unknown, write = false, confirming = false): string {
  if (error instanceof PersonalApiError) {
    if (error.code === 'INVALID_ANALYSIS_PROFILE') return '새 분석 결과의 세부 조건을 확인할 수 없어요. 다시 분석해 주세요.';
    if (error.uncertain) return confirming ? '확인 결과를 알 수 없어요. 입력을 보존했어요. 새로고침해 최신 상태를 확인해 주세요.' : '저장 결과를 확인할 수 없어요. 입력은 유지했어요. 새로고침해 최신 저장 상태를 확인해 주세요.';
    if (error.code === 'STALE_AI_RESULT') return '분석 결과가 최신 입력과 맞지 않아요. 원문을 다시 분석해 주세요.';
    if (error.status === 409) return confirming ? '공통 조건이나 저장된 취향이 바뀌었어요. 최신 내용을 다시 불러와 확인해 주세요.' : '다른 변경이 먼저 저장됐어요. 입력은 유지했어요. 새로고침해 최신 상태를 확인해 주세요.';
    if (error.code === 'ORIGINAL_TEXT_REQUIRED') return '먼저 개인 원문을 저장해 주세요.';
    if (error.code === 'WALKING_REQUIRED') return '걷기 시간을 선택해 주세요.';
    if (error.code === 'PREFERENCES_INCOMPLETE') return Object.values(error.fieldErrors).filter(Boolean).join(' ') || '저장된 취향과 세부 조건을 확인해 주세요.';
    if (error.code === 'AI_UNAVAILABLE') return 'AI 분석 서비스를 사용할 수 없어요. 원문은 저장돼 있어요. 잠시 후 다시 분석해 주세요.';
    if (error.code === 'AI_TIMEOUT') return 'AI 분석 응답 시간이 초과됐어요. 원문은 저장돼 있어요. 다시 분석해 주세요.';
    if (error.code === 'AI_INVALID_RESPONSE') return 'AI 분석 결과가 올바르지 않아 적용하지 않았어요. 원문은 저장돼 있어요. 다시 분석해 주세요.';
    if (Object.keys(error.fieldErrors).length) return Object.values(error.fieldErrors).filter(Boolean).join(' ');
    if (error.status === 401 || error.status === 403 || error.status === 404 || error.code === 'TRIP_CLOSED' || error.code === 'MEMBERSHIP_INACTIVE') return '이 여행방의 개인 준비 정보를 볼 수 없어요.';
    return confirming ? '준비를 완료하지 못했어요. 내용을 확인하고 다시 시도해 주세요.' : error.message;
  }
  return confirming ? '준비를 완료하지 못했어요. 입력은 유지했어요. 연결을 확인해 주세요.' : write ? '저장하지 못했어요. 입력은 유지했어요. 연결을 확인해 주세요.' : '개인 준비 정보를 불러오지 못했어요. 다시 시도해 주세요.';
}

function hasStoredResults(draft: PersonalDraft): boolean {
  return Boolean(draft.likes || draft.avoid || draft.food || draft.walking || draft.atomicPreferences);
}

function hasCurrentAtomicProfile(draft: PersonalDraft): boolean {
  return draft.atomicPreferences?.status === 'current' && Boolean(draft.originalText.trim());
}

function hasSavedPreparation(draft: PersonalDraft, preferenceVersion: number): boolean {
  return hasStoredResults(draft) || preferenceVersion > 0;
}

function acknowledgementsForProfile(draft: PersonalDraft, savedDraft: PersonalDraft, current: UnresolvedAcknowledgements | null, saved: UnresolvedAcknowledgements | null, reset = false): UnresolvedAcknowledgements | undefined {
  const digest = draft.atomicPreferences?.sourceDigest;
  if (!digest) return undefined;
  if (reset) return { sourceDigest: digest, items: [] };
  if (savedDraft.atomicPreferences?.sourceDigest && savedDraft.atomicPreferences.sourceDigest !== digest) return { sourceDigest: digest, items: [] };
  if (current?.sourceDigest === digest && JSON.stringify(current) !== JSON.stringify(saved)) return current;
  return undefined;
}
function acknowledgementsPersisted(expected: UnresolvedAcknowledgements | undefined, actual: UnresolvedAcknowledgements | null): boolean {
  if (!expected) return true;
  if (expected.items.length === 0) return !actual || (actual.sourceDigest === expected.sourceDigest && actual.items.length === 0);
  return JSON.stringify(expected) === JSON.stringify(actual);
}
function acknowledgementsAfterSourceSave(draft: PersonalDraft, saved: PersonalPreferences, local: UnresolvedAcknowledgements | null): UnresolvedAcknowledgements | null {
  const profile = saved.draft.atomicPreferences;
  return profile?.status === 'current' && draft.atomicPreferences?.sourceDigest === profile.sourceDigest && (!local || local.sourceDigest === profile.sourceDigest)
    ? local : saved.unresolvedAcknowledgements;
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
  preferenceVersion: number;
  conditionsChangedNotice: { conditionsVersion: number } | null;
  clarifications: PersonalPreferences['clarifications'];
  reviewAcknowledgements: UnresolvedAcknowledgements | null;
  savedReviewAcknowledgements: UnresolvedAcknowledgements | null;
  acknowledgeUnresolved: (note: UnresolvedNote, disposition: UnresolvedAcknowledgement['disposition'] | null) => void;
  saveStatus: PersonalSaveStatus;
  updateDraft: <K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) => void;
  reload: () => Promise<void>;
  save: () => Promise<boolean>;
  analyzeAndSave: (nextOriginalText?: string) => Promise<boolean>;
  saveAndConfirm: () => Promise<boolean>;
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
      message: '저장된 개인 준비를 불러오는 중이에요.', operationError: '' });
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
        resultStatus: result.draft.atomicPreferences?.status === 'stale' ? 'stale' : hasStoredResults(result.draft) ? 'stored' : 'empty', resultsVisible: retained.resultsVisible || hasSavedPreparation(result.draft, result.preferenceVersion), analysisStep: null, dirty: false,
        message: conditionsMatch ? '' : '공통 여행 조건이 바뀌었어요. 개인 준비를 새로고침해 주세요.', operationError: conditionsMatch ? '' : '공통 여행 조건이 바뀌었어요. 개인 준비를 새로고침해 주세요.', needsWalkingAnswer: false, confirmation: result.confirmation,
        loadedConditionsVersion: result.conditionsVersion, preferenceVersion: result.preferenceVersion, clarifications: result.clarifications,
        reviewAcknowledgements: result.unresolvedAcknowledgements, savedReviewAcknowledgements: result.unresolvedAcknowledgements,
      });
    } catch (error) {
      if (controller.signal.aborted || requestId !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return;
      const fatal = fatalError(error);
      update({ ...internalRef.current, ...(fatal ? { draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, confirmation: null, needsWalkingAnswer: false, resultsVisible: false, preferenceVersion: 0, loadedConditionsVersion: null, dirty: false, reviewAcknowledgements: null, savedReviewAcknowledgements: null } : {}), state: fatal ? 'fatal' : 'error', phase: 'idle', resultStatus: fatal ? 'empty' : hasStoredResults(internalRef.current.savedDraft) ? 'stale' : 'empty', analysisStep: null, message: errorMessage(error), operationError: errorMessage(error) });
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
        const draft = current.draft.atomicPreferences?.status === 'current'
          ? { ...current.draft, atomicPreferences: { ...current.draft.atomicPreferences, status: 'stale' as const } }
          : current.draft;
        update({ ...current, draft, phase: 'idle', analysisStep: null, resultStatus: hasStoredResults(draft) ? 'stale' : 'empty', message: '공통 여행 조건이 바뀌었어요. 최신 조건을 확인한 뒤 개인 준비를 다시 확인해 주세요.' });
      }
    }
  }, [conditionsVersion, enabled, reload, tripId, update]);

  const updateDraft = useCallback(<K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) => {
    const current = internalRef.current;
    if (!tripId || current.tripId !== tripId || current.state !== 'ready' || current.phase !== 'idle') return;
    const draft = { ...current.draft, [key]: value };
    editRevision.current += 1;
    const sourceChanged = draftChangeInvalidatesAtomicProfile(key) && value !== current.draft[key];
    if (sourceChanged && draft.atomicPreferences?.status === 'current') draft.atomicPreferences = { ...draft.atomicPreferences, status: 'stale' };
    const reviewAcknowledgements = sourceChanged ? null : current.reviewAcknowledgements;
    update({ ...current, draft,
      resultStatus: sourceChanged ? (hasStoredResults(current.draft) ? 'stale' : 'empty') : current.resultStatus,
      reviewAcknowledgements, dirty: JSON.stringify(draft) !== JSON.stringify(current.savedDraft) || JSON.stringify(reviewAcknowledgements) !== JSON.stringify(current.savedReviewAcknowledgements),
      needsWalkingAnswer: key === 'walking' && value !== '' ? false : current.needsWalkingAnswer, message: '', operationError: '' });
  }, [tripId, update]);

  const acknowledgeUnresolved = useCallback((note: UnresolvedNote, disposition: UnresolvedAcknowledgement['disposition'] | null) => {
    const current = internalRef.current;
    const profile = current.draft.atomicPreferences;
    if (!profile || profile.status !== 'current' || current.state !== 'ready' || current.phase !== 'idle') return;
    const base = current.reviewAcknowledgements?.sourceDigest === profile.sourceDigest ? current.reviewAcknowledgements.items : [];
    const matches = (item: UnresolvedAcknowledgement) => item.note.code === note.code && item.note.evidence === note.evidence && item.note.message === note.message;
    const items = base.filter(item => !matches(item));
    if (disposition) items.push({ note, disposition });
    const reviewAcknowledgements = { sourceDigest: profile.sourceDigest, items };
    editRevision.current += 1;
    update({ ...current, reviewAcknowledgements, dirty: JSON.stringify(current.draft) !== JSON.stringify(current.savedDraft) || JSON.stringify(reviewAcknowledgements) !== JSON.stringify(current.savedReviewAcknowledgements), message: '', operationError: '' });
  }, [update]);

  const save = useCallback(async (): Promise<boolean> => {
    const current = internalRef.current;
    if (!tripId || !enabled || lock.current || current.tripId !== tripId || current.state !== 'ready' || current.loadedConditionsVersion !== conditionsVersion) return false;
    lock.current = true;
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++sequence.current;
    const revision = editRevision.current;
    const snapshot = current.draft;
    update({ ...current, phase: 'saving', analysisStep: null, message: '개인 준비를 저장하고 있어요.', operationError: '' });
    try {
      const sourceOnly = snapshot.atomicPreferences?.status === 'stale';
      const reviewCommand = sourceOnly ? undefined : acknowledgementsForProfile(snapshot, current.savedDraft, current.reviewAcknowledgements, current.savedReviewAcknowledgements);
      const saveOptions = sourceOnly
        ? { signal: controller.signal, sourceOnly: true as const }
        : { signal: controller.signal, ...(reviewCommand ? { unresolvedAcknowledgements: reviewCommand } : {}) };
      const result = await saveMyPreferences(tripId, conditionsVersion, current.preferenceVersion, snapshot, saveOptions);
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      const unchanged = revision === editRevision.current;
      const acknowledgementsSaved = acknowledgementsPersisted(reviewCommand, result.unresolvedAcknowledgements);
      const displayDraft = sourceOnly && snapshot.atomicPreferences
        ? { ...result.draft, atomicPreferences: snapshot.atomicPreferences }
        : result.draft;
      const currentDraft = unchanged ? displayDraft : internalRef.current.draft;
      const currentAcknowledgements = sourceOnly ? acknowledgementsAfterSourceSave(snapshot, result, current.reviewAcknowledgements) : (unchanged && acknowledgementsSaved ? result.unresolvedAcknowledgements : internalRef.current.reviewAcknowledgements);
      update({
        ...internalRef.current, ...(unchanged ? { draft: displayDraft } : {}), savedDraft: result.draft,
        state: 'ready', phase: 'idle', analysisStep: null, dirty: JSON.stringify(currentDraft) !== JSON.stringify(result.draft) || JSON.stringify(currentAcknowledgements) !== JSON.stringify(result.unresolvedAcknowledgements),
        message: '취향을 저장했어요.', confirmation: result.confirmation, preferenceVersion: result.preferenceVersion,
        loadedConditionsVersion: result.conditionsVersion, clarifications: result.clarifications,
        reviewAcknowledgements: currentAcknowledgements, savedReviewAcknowledgements: result.unresolvedAcknowledgements,
      });
      if (current.dirty) onSavedRef.current?.();
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestId !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return false;
      const fatal = fatalError(error);
      const blocked = error instanceof PersonalApiError && (error.status === 409 || error.uncertain);
      update({ ...internalRef.current, ...(fatal ? { draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, confirmation: null, needsWalkingAnswer: false, resultsVisible: false, preferenceVersion: 0, loadedConditionsVersion: null, dirty: false, reviewAcknowledgements: null, savedReviewAcknowledgements: null } : {}), state: fatal ? 'fatal' : blocked ? 'error' : 'ready', phase: 'idle', resultStatus: fatal ? 'empty' : internalRef.current.resultStatus, message: errorMessage(error, true), operationError: errorMessage(error, true) });
      return false;
    } finally {
      if (requestId === sequence.current) lock.current = false;
    }
  }, [conditionsVersion, enabled, tripId, update]);

  const analyzeAndSave = useCallback(async (nextOriginalText?: string): Promise<boolean> => {
    const current = internalRef.current;
    if (!tripId || !enabled || lock.current || current.tripId !== tripId || current.state !== 'ready' || current.phase !== 'idle' || current.loadedConditionsVersion !== conditionsVersion || conditionsVersionRef.current !== conditionsVersion) return false;
    const text = nextOriginalText ?? current.draft.originalText;
    if (!text.trim() || [...text].length > 5000) return false;
    const sourceChanged = text !== current.draft.originalText;
    const original: PersonalDraft = sourceChanged ? {
      ...current.draft, originalText: text,
      ...(current.draft.atomicPreferences && { atomicPreferences: { ...current.draft.atomicPreferences, status: 'stale' } }),
    } : current.draft;
    if (sourceChanged) editRevision.current += 1;
    const localAcknowledgements = sourceChanged ? null : current.reviewAcknowledgements;
    lock.current = true;
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++sequence.current;
    const revision = editRevision.current;
    update({ ...current, draft: original, dirty: sourceChanged || current.dirty, reviewAcknowledgements: localAcknowledgements,
      phase: 'analyzing', operationError: '', analysisStep: 'source', resultStatus: hasStoredResults(current.draft) ? 'stale' : 'empty', message: '원문을 저장하고 내용을 분석하고 있어요.' });
    try {
      const savedRaw = await saveMyPreferences(tripId, conditionsVersion, current.preferenceVersion, original, { signal: controller.signal, sourceOnly: true });
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      const staleDisplay = original.atomicPreferences
        ? { ...savedRaw.draft, atomicPreferences: { ...original.atomicPreferences, status: 'stale' as const } }
        : savedRaw.draft;
      const sourceDisplay = revision === editRevision.current ? staleDisplay : internalRef.current.draft;
      const savedSourceAcks = savedRaw.unresolvedAcknowledgements;
      const sourceAcks = acknowledgementsAfterSourceSave(original, savedRaw, localAcknowledgements);
      update({ ...internalRef.current, draft: sourceDisplay, savedDraft: savedRaw.draft,
        preferenceVersion: savedRaw.preferenceVersion, confirmation: savedRaw.confirmation,
        clarifications: savedRaw.clarifications, loadedConditionsVersion: savedRaw.conditionsVersion,
        reviewAcknowledgements: sourceAcks, savedReviewAcknowledgements: savedSourceAcks,
        dirty: JSON.stringify(sourceDisplay) !== JSON.stringify(savedRaw.draft) || JSON.stringify(sourceAcks) !== JSON.stringify(savedSourceAcks),
        resultsVisible: current.resultsVisible || hasSavedPreparation(savedRaw.draft, savedRaw.preferenceVersion),
        phase: 'analyzing', analysisStep: 'interpret', resultStatus: hasStoredResults(staleDisplay) ? 'stale' : 'empty',
        message: '저장한 원문을 분석하고 있어요.' });
      onSavedRef.current?.();
      if (revision !== editRevision.current) {
        update({ ...internalRef.current, phase: 'idle', analysisStep: null, resultStatus: hasStoredResults(internalRef.current.draft) ? 'stale' : 'empty', dirty: JSON.stringify(internalRef.current.draft) !== JSON.stringify(savedRaw.draft) || JSON.stringify(internalRef.current.reviewAcknowledgements) !== JSON.stringify(savedRaw.unresolvedAcknowledgements), message: '입력이 바뀌어 분석을 멈췄어요. 다시 분석해 주세요.' });
        return false;
      }
      if (conditionsVersionRef.current !== conditionsVersion || savedRaw.conditionsVersion !== conditionsVersion) {
        update({ ...internalRef.current, state: 'error', phase: 'idle', analysisStep: null, dirty: JSON.stringify(internalRef.current.draft) !== JSON.stringify(savedRaw.draft) || JSON.stringify(internalRef.current.reviewAcknowledgements) !== JSON.stringify(savedRaw.unresolvedAcknowledgements), message: '공통 여행 조건이 바뀌어 분석을 멈췄어요. 최신 조건을 확인해 주세요.' });
        return false;
      }
      const interpreted = await interpretMyPreferences(tripId, conditionsVersion, savedRaw.preferenceVersion, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      if (revision !== editRevision.current || conditionsVersionRef.current !== conditionsVersion || interpreted.sourceConditionsVersion !== conditionsVersion || interpreted.sourcePreferenceVersion !== savedRaw.preferenceVersion) {
        const conditionsChanged = conditionsVersionRef.current !== conditionsVersion || interpreted.sourceConditionsVersion !== conditionsVersion;
        update({ ...internalRef.current, phase: 'idle', analysisStep: null, resultStatus: hasStoredResults(internalRef.current.savedDraft) ? 'stale' : 'empty', dirty: JSON.stringify(internalRef.current.draft) !== JSON.stringify(savedRaw.draft) || JSON.stringify(internalRef.current.reviewAcknowledgements) !== JSON.stringify(savedRaw.unresolvedAcknowledgements),
          message: conditionsChanged
            ? '공통 여행 조건이 바뀌어 분석 결과를 저장하지 않았어요. 최신 조건을 확인한 뒤 개인 준비를 새로고침해 주세요.'
            : '입력이 바뀌어 분석 결과를 저장하지 않았어요. 새로고침해 확인해 주세요.' });
        return false;
      }
      const interpretedProfile = interpreted.suggestions.atomicPreferences;
      const versionTwoInterpretation = original.atomicPreferences !== undefined || savedRaw.draft.atomicPreferences !== undefined || interpreted.analysisMeta !== undefined;
      if (versionTwoInterpretation && (!interpretedProfile || interpretedProfile.status !== 'current')) {
        update({ ...internalRef.current, resultStatus: 'stale', dirty: JSON.stringify(internalRef.current.draft) !== JSON.stringify(savedRaw.draft) || JSON.stringify(internalRef.current.reviewAcknowledgements) !== JSON.stringify(savedRaw.unresolvedAcknowledgements) });
        throw new PersonalApiError({ status: 502, code: 'INVALID_ANALYSIS_PROFILE', message: '새 분석 결과의 세부 조건을 확인할 수 없어요. 다시 분석해 주세요.' });
      }
      const merged: PersonalDraft = {
        ...savedRaw.draft,
        likes: interpreted.suggestions.likes,
        avoid: interpreted.suggestions.avoid,
        avoidImportance: interpreted.suggestions.avoidImportance,
        food: interpreted.suggestions.food,
        foodImportance: interpreted.suggestions.foodImportance,
        walking: projectInterpretedWalking(savedRaw.draft.walking, interpreted.suggestions.walking,
          interpreted.needsWalkingAnswer, interpreted.suggestions.atomicPreferences ?? undefined),
        scheduleItems: interpreted.suggestions.scheduleItems,
        ...(interpretedProfile ? { atomicPreferences: interpretedProfile } : {}),
      };
      update({ ...internalRef.current, phase: 'analyzing', analysisStep: 'result', message: '분석 결과를 저장하고 있어요.' });
      const reviewCommand = interpretedProfile ? { sourceDigest: interpretedProfile.sourceDigest, items: [] } : undefined;
      const finalResult = await saveMyPreferences(tripId, conditionsVersion, savedRaw.preferenceVersion, merged, { signal: controller.signal, ...(interpreted.analysisMeta?.requestId ? { analysisReceipt: interpreted.analysisMeta.requestId } : {}), ...(reviewCommand ? { unresolvedAcknowledgements: reviewCommand } : {}) });
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      if (interpretedProfile && (finalResult.draft.atomicPreferences?.status !== 'current' || finalResult.draft.atomicPreferences.sourceDigest !== interpretedProfile.sourceDigest)) {
        throw new PersonalApiError({ status: 0, code: 'INVALID_WRITE_RESPONSE', message: '저장된 분석 결과를 확인할 수 없어요. 입력은 유지했어요. 저장본을 다시 불러와 확인해 주세요.', uncertain: true });
      }
      if (conditionsVersionRef.current !== conditionsVersion || finalResult.conditionsVersion !== conditionsVersion) {
        update({ ...internalRef.current, state: 'error', phase: 'idle', analysisStep: null, savedDraft: finalResult.draft, preferenceVersion: finalResult.preferenceVersion, confirmation: finalResult.confirmation, clarifications: finalResult.clarifications, loadedConditionsVersion: finalResult.conditionsVersion, resultStatus: 'stale', dirty: true, message: '공통 여행 조건이 바뀌어 분석 결과를 적용하지 않았어요. 최신 상태를 확인해 주세요.' });
        onSavedRef.current?.();
        return false;
      }
      if (revision !== editRevision.current) {
        update({ ...internalRef.current, savedDraft: finalResult.draft, preferenceVersion: finalResult.preferenceVersion, confirmation: finalResult.confirmation, clarifications: finalResult.clarifications, phase: 'idle', resultsVisible: true, analysisStep: null, resultStatus: 'stale', dirty: JSON.stringify(internalRef.current.draft) !== JSON.stringify(finalResult.draft) || JSON.stringify(internalRef.current.reviewAcknowledgements) !== JSON.stringify(finalResult.unresolvedAcknowledgements), message: '입력이 바뀌어 분석 결과를 화면에 적용하지 않았어요. 새로고침해 확인해 주세요.' });
        onSavedRef.current?.();
        return false;
      }
      const acknowledgementsSaved = acknowledgementsPersisted(reviewCommand, finalResult.unresolvedAcknowledgements);
      update({ ...internalRef.current, draft: finalResult.draft, savedDraft: finalResult.draft, state: 'ready', phase: 'idle', resultStatus: 'analyzed', resultsVisible: true, analysisStep: null, dirty: !acknowledgementsSaved, confirmation: finalResult.confirmation, preferenceVersion: finalResult.preferenceVersion, loadedConditionsVersion: finalResult.conditionsVersion, needsWalkingAnswer: interpreted.needsWalkingAnswer, clarifications: finalResult.clarifications, reviewAcknowledgements: acknowledgementsSaved ? finalResult.unresolvedAcknowledgements : reviewCommand ?? current.reviewAcknowledgements, savedReviewAcknowledgements: finalResult.unresolvedAcknowledgements, message: acknowledgementsSaved ? interpreted.needsWalkingAnswer ? '걷기 시간을 선택해 주세요.' : '취향을 분석하고 저장했어요.' : '분석 결과는 저장했지만 확인 기록을 반영하지 못했어요. 다시 저장해 주세요.' });
      onSavedRef.current?.();
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestId !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return false;
      const fatal = fatalError(error);
      const blocked = error instanceof PersonalApiError && (error.status === 409 || error.uncertain);
      const invalidProfile = error instanceof PersonalApiError && error.code === 'INVALID_ANALYSIS_PROFILE';
      update({ ...internalRef.current, ...(fatal ? { draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, confirmation: null, needsWalkingAnswer: false, resultsVisible: false, preferenceVersion: 0, loadedConditionsVersion: null, dirty: false, reviewAcknowledgements: null, savedReviewAcknowledgements: null } : {}), state: fatal ? 'fatal' : blocked ? 'error' : 'ready', phase: 'idle', analysisStep: null, resultStatus: fatal ? 'empty' : invalidProfile || hasStoredResults(internalRef.current.savedDraft) ? 'stale' : 'empty', message: errorMessage(error, true), operationError: errorMessage(error, true) });
      return false;
    } finally {
      if (requestId === sequence.current) lock.current = false;
    }
  }, [conditionsVersion, enabled, tripId, update]);

  const saveAndConfirm = useCallback(async (): Promise<boolean> => {
    const current = internalRef.current;
    if (!tripId || !enabled || lock.current || current.tripId !== tripId || current.state !== 'ready' ||
        current.phase !== 'idle' || current.loadedConditionsVersion !== conditionsVersion || conditionsVersionRef.current !== conditionsVersion) return false;
    if (current.resultStatus === 'stale') {
      update({ ...current, message: '원문을 수정했어요. 취향을 다시 분석한 뒤 준비 완료를 눌러 주세요.', operationError: '' });
      return false;
    }

    lock.current = true;
    const controller = new AbortController();
    activeController.current = controller;
    const requestId = ++sequence.current;
    const revision = editRevision.current;
    const snapshot = current.draft;
    update({ ...current, phase: current.dirty ? 'saving' : 'confirming', message: current.dirty ? '취향을 저장하고 준비를 확인하고 있어요.' : '저장한 취향을 확인하고 있어요.', operationError: '' });
    try {
      const reviewCommand = acknowledgementsForProfile(snapshot, current.savedDraft, current.reviewAcknowledgements, current.savedReviewAcknowledgements);
      const saved = current.dirty
        ? await saveMyPreferences(tripId, conditionsVersion, current.preferenceVersion, snapshot, { signal: controller.signal, ...(reviewCommand ? { unresolvedAcknowledgements: reviewCommand } : {}) })
        : {
            draft: current.savedDraft, confirmation: current.confirmation ?? { status: 'writing' as const, confirmedConditionsVersion: null, confirmedPreferenceVersion: null, confirmedAt: null }, preferenceVersion: current.preferenceVersion,
            conditionsVersion: current.loadedConditionsVersion!, clarifications: current.clarifications, unresolvedAcknowledgements: current.savedReviewAcknowledgements,
          };
      if (controller.signal.aborted || requestId !== sequence.current) return false;
      const unchanged = revision === editRevision.current;
      const acknowledgementsSaved = acknowledgementsPersisted(reviewCommand, saved.unresolvedAcknowledgements);
      update({
        ...internalRef.current,
        ...(unchanged ? { draft: saved.draft } : {}), savedDraft: saved.draft,
        dirty: !unchanged || !acknowledgementsSaved, state: 'ready', phase: 'confirming', analysisStep: null,
        confirmation: saved.confirmation, preferenceVersion: saved.preferenceVersion,
        loadedConditionsVersion: saved.conditionsVersion, clarifications: saved.clarifications,
        reviewAcknowledgements: acknowledgementsSaved ? saved.unresolvedAcknowledgements : current.reviewAcknowledgements, savedReviewAcknowledgements: saved.unresolvedAcknowledgements,
        message: unchanged ? '취향을 저장했어요. 준비 상태를 확인하고 있어요.' : '입력이 바뀌어 저장한 내용만 보관했어요. 다시 눌러 최신 입력을 확인해 주세요.',
      });
      if (current.dirty) onSavedRef.current?.();
      if (!unchanged || !acknowledgementsSaved || controller.signal.aborted || requestId !== sequence.current || conditionsVersionRef.current !== conditionsVersion || saved.conditionsVersion !== conditionsVersion) {
        update({ ...internalRef.current, phase: 'idle', message: '입력이나 공통 조건이 바뀌어 준비 완료로 처리하지 않았어요. 최신 내용을 확인해 다시 눌러 주세요.' });
        return false;
      }
      const valid = hasCurrentAtomicProfile(saved.draft) || (saved.draft.originalText.trim() && saved.draft.likes.trim() &&
        (saved.draft.walking === '20' || saved.draft.walking === '40' || saved.draft.walking === 'unlimited'));
      if (!valid) {
        update({ ...internalRef.current, phase: 'idle', message: '원하는 여행 내용과 필요한 취향을 확인한 뒤 다시 눌러 주세요.' });
        return false;
      }
      if (saved.confirmation.status === 'confirmed' && saved.confirmation.confirmedConditionsVersion === conditionsVersion && saved.confirmation.confirmedPreferenceVersion === saved.preferenceVersion) {
        transitionNotice({ type: 'observe', conditionsVersion: conditionsVersionRef.current });
        transitionNotice({ type: 'confirmed', conditionsVersion: saved.conditionsVersion });
        update({ ...internalRef.current, phase: 'idle', message: '준비 완료예요.' });
        return true;
      }
      const result = await confirmMyPreferences(tripId, conditionsVersion, saved.preferenceVersion, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== sequence.current || revision !== editRevision.current || conditionsVersionRef.current !== conditionsVersion) return false;
      transitionNotice({ type: 'observe', conditionsVersion: conditionsVersionRef.current });
      transitionNotice({ type: 'confirmed', conditionsVersion: result.conditionsVersion });
      update({ ...internalRef.current, state: 'ready', phase: 'idle', confirmation: result.confirmation, preferenceVersion: result.preferenceVersion,
        loadedConditionsVersion: result.conditionsVersion, message: '준비 완료예요.' });
      onSavedRef.current?.();
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestId !== sequence.current || (error instanceof DOMException && error.name === 'AbortError')) return false;
      const fatal = fatalError(error);
      const blocked = error instanceof PersonalApiError && (error.status === 409 || error.uncertain);
      update({ ...internalRef.current, ...(fatal ? { draft: emptyPersonalDraft, savedDraft: emptyPersonalDraft, confirmation: null, needsWalkingAnswer: false, resultsVisible: false, preferenceVersion: 0, loadedConditionsVersion: null, dirty: false, reviewAcknowledgements: null, savedReviewAcknowledgements: null } : {}), state: fatal ? 'fatal' : blocked ? 'error' : 'ready', phase: 'idle', message: errorMessage(error, true, true), operationError: errorMessage(error, true, true) });
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
  return {
    draft: visible.draft, savedDraft: visible.savedDraft, state: effectiveState, phase: effectivePhase, clarifications: visible.clarifications,
    reviewAcknowledgements: visible.reviewAcknowledgements, savedReviewAcknowledgements: visible.savedReviewAcknowledgements, acknowledgeUnresolved,
    resultStatus: visible.resultStatus, resultsVisible: visible.resultsVisible, analysisStep: staleConditions ? null : visible.analysisStep,
    dirty: visible.dirty, message: staleConditions ? '공통 여행 조건이 바뀌었어요. 개인 준비를 새로고침해 주세요.' : visible.message, operationError: staleConditions ? '' : visible.operationError, needsWalkingAnswer: visible.needsWalkingAnswer,
    confirmation: visible.confirmation, preferenceVersion: visible.preferenceVersion,
    conditionsChangedNotice: visible.state !== 'fatal' && internal.state !== 'fatal' && internal.tripId === tripId && conditionsNotice.pendingVersion !== null
      ? { conditionsVersion: conditionsNotice.pendingVersion }
      : null,
    saveAndConfirm,
    saveStatus: derivePersonalSaveStatus({
      state: effectiveState, phase: effectivePhase, dirty: visible.dirty, savedDraft: visible.savedDraft,
      preferenceVersion: visible.preferenceVersion, confirmation: visible.confirmation, conditionsChanged,
    }),
    updateDraft, reload, save, analyzeAndSave,
  };
}
