import { useCallback, useEffect, useRef, useState } from 'react';
import {
  conditionsToDraft,
  fetchPreparation,
  PreparationHttpError,
  saveSharedConditions,
  type Preparation,
} from './preparationApi';
import type { RoomDraft, RoomEntry } from './roomData';

type LoadState = 'loading' | 'ready' | 'error' | 'fatal';
type SaveResult = 'saved' | 'invalid' | 'conflict' | 'failed' | 'fatal';

function fatalError(error: unknown): boolean {
  if (!(error instanceof PreparationHttpError)) return false;
  return error.status === 401 || error.status === 404 || (error.status === 403 && error.code !== 'OWNER_REQUIRED') || error.code === 'TRIP_CLOSED';
}

function errorMessage(error: unknown): string {
  if (error instanceof PreparationHttpError && error.code === 'OWNER_REQUIRED') return '여행방 권한이 바뀌었어요. 권한을 다시 확인하고 있어요.';
  return error instanceof Error ? error.message : '여행 준비 정보를 불러오지 못했어요. 다시 시도해 주세요.';
}

export function useSharedPreparation(tripId: string | null, entry: RoomEntry | null, enabled: boolean) {
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [saveFieldErrors, setSaveFieldErrors] = useState<Partial<Record<keyof RoomDraft, string>>>({});
  const [saveMessage, setSaveMessage] = useState('');
  const requestId = useRef(0);
  const activeGet = useRef<AbortController | null>(null);
  const saveLock = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const fatalRef = useRef(false);
  const preparationRef = useRef<Preparation | null>(null);
  const pendingPersonalRefresh = useRef(false);

  const refresh = useCallback(async (quiet = false): Promise<Preparation | null> => {
    if (!enabled || !tripId || !entry || fatalRef.current || saveLock.current) return null;
    if (activeGet.current) return null;
    const controller = new AbortController();
    const ownRequest = ++requestId.current;
    const ownGeneration = generation.current;
    activeGet.current = controller;
    if (quiet) setRefreshing(true);
    if (!preparationRef.current) setState('loading');
    try {
      const result = await fetchPreparation(tripId, { signal: controller.signal });
      if (ownRequest !== requestId.current || ownGeneration !== generation.current || !mounted.current) return null;
      if (result.trip.id !== tripId || result.currentMember.id !== entry.member.id || result.currentMember.role !== entry.member.role) {
        const mismatch = new PreparationHttpError({ status: 403, code: 'MEMBERSHIP_REQUIRED', message: '현재 여행방 참여 정보와 서버 응답이 일치하지 않아요. 여행 시작 화면으로 돌아가 다시 참여해 주세요.' });
        throw mismatch;
      }
      preparationRef.current = result;
      setPreparation(result);
      setState('ready');
      setMessage('');
      setLastUpdated(Date.now());
      return result;
    } catch (error) {
      if (controller.signal.aborted || ownRequest !== requestId.current || ownGeneration !== generation.current) return null;
      if (fatalError(error)) {
        fatalRef.current = true;
        setState('fatal');
      } else if (!preparationRef.current) setState('error');
      setMessage(errorMessage(error));
      return null;
    } finally {
      if (activeGet.current === controller) activeGet.current = null;
      if (mounted.current && ownRequest === requestId.current) setRefreshing(false);
    }
  }, [enabled, entry, tripId]);

  const refreshAfterPersonalMutation = useCallback(() => {
    if (!enabled || !tripId || !entry || fatalRef.current) return;
    if (saveLock.current) {
      pendingPersonalRefresh.current = true;
      return;
    }
    requestId.current += 1;
    activeGet.current?.abort();
    activeGet.current = null;
    setRefreshing(false);
    void refresh(true);
  }, [enabled, entry, refresh, tripId]);

  useEffect(() => {
    mounted.current = true;
    fatalRef.current = false;
    pendingPersonalRefresh.current = false;
    generation.current += 1;
    saveLock.current = false;
    // Reset per-trip data when the route/session changes so a previous room cannot flash.
    // oxlint-disable-next-line react/set-state-in-effect
    setPreparation(null);
    preparationRef.current = null;
    // oxlint-disable-next-line react(set-state-in-effect)
    setState('loading');
    setMessage('');
    setLastUpdated(null);
    if (!enabled || !tripId || !entry) return () => { mounted.current = false; };
    void refresh(false);
    const onResume = () => { if (document.visibilityState === 'visible') void refresh(true); };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onResume);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, 10_000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onResume);
      activeGet.current?.abort();
      activeGet.current = null;
      requestId.current += 1;
    };
  }, [enabled, entry, refresh, tripId]);

  const save = useCallback(async (draft: RoomDraft, expectedVersion: number): Promise<SaveResult> => {
    if (!enabled || !tripId || saveLock.current) return 'failed';
    saveLock.current = true;
    setSaving(true);
    const ownSaveGeneration = ++generation.current;
    setSaveFieldErrors({});
    setSaveMessage('');
    requestId.current += 1;
    activeGet.current?.abort();
    activeGet.current = null;
    setRefreshing(false);
    let refreshAfterSave = false;
    try {
      const saved = await saveSharedConditions(tripId, expectedVersion, draft);
      if (!mounted.current || ownSaveGeneration !== generation.current) return 'failed';
      refreshAfterSave = true;
      setPreparation((current) => {
        if (!current) return current;
        const next = {
          ...current,
          conditionsVersion: saved.conditionsVersion,
          conditions: saved.conditions,
          ...(saved.requiresReconfirmation ? {
            members: current.members.map((member) => ({ ...member, preparationStatus: 'writing' as const })),
            readiness: { conditionsReady: false, reasons: current.members.map((member) => ({ code: 'PREFERENCES_UNCONFIRMED' as const, memberId: member.id })) },
          } : {}),
        };
        preparationRef.current = next;
        return next;
      });
      setLastUpdated(Date.now());
      setSaveMessage('공통 조건을 저장했어요. 참여자들의 확인 상태가 초기화되어 다시 확인이 필요해요.');
      setMessage('');
      return 'saved';
    } catch (error) {
      if (!mounted.current || ownSaveGeneration !== generation.current) return 'failed';
      if (error instanceof PreparationHttpError) {
        setSaveFieldErrors(error.fieldErrors);
        if (fatalError(error)) {
          fatalRef.current = true;
          setState('fatal');
          setMessage(errorMessage(error));
          return 'fatal';
        }
        if (error.code === 'VERSION_CONFLICT' || error.status === 409) {
          setSaveMessage('다른 참여자가 공통 조건을 바꿨어요. 최신 조건을 확인한 다음 내 변경을 다시 적용해 주세요.');
          return 'conflict';
        }
        setSaveMessage(error.message);
        if (error.code === 'OWNER_REQUIRED') return 'failed';
        return 'invalid';
      }
      setSaveMessage('저장 결과를 확인하지 못했어요. 입력은 보존했어요. 최신 공통 조건을 불러온 뒤 직접 다시 적용해 주세요.');
      return 'failed';
    } finally {
      if (ownSaveGeneration === generation.current) {
        saveLock.current = false;
      }
      if (mounted.current && ownSaveGeneration === generation.current) {
        setSaving(false);
        if (pendingPersonalRefresh.current && !fatalRef.current) {
          pendingPersonalRefresh.current = false;
          refreshAfterPersonalMutation();
        } else if (refreshAfterSave && !fatalRef.current) void refresh(true);
      }
    }
  }, [enabled, refresh, refreshAfterPersonalMutation, tripId]);

  const applyFresh = useCallback((next: Preparation) => {
    if (next.trip.id !== tripId || next.currentMember.id !== entry?.member.id || next.currentMember.role !== entry.member.role) return false;
    generation.current += 1;
    requestId.current += 1;
    activeGet.current?.abort();
    activeGet.current = null;
    setRefreshing(false);
    preparationRef.current = next;
    setPreparation(next);
    setState('ready');
    setMessage('');
    setLastUpdated(Date.now());
    return true;
  }, [entry, tripId]);

  return {
    preparation,
    conditions: preparation ? conditionsToDraft(preparation.conditions) : null,
    state,
    message,
    refreshing,
    saving,
    lastUpdated,
    saveFieldErrors,
    clearSaveFieldErrors: () => setSaveFieldErrors({}),
    saveMessage,
    refresh: () => refresh(true),
    save,
    applyFresh,
    refreshAfterPersonalMutation,
    setSaveMessage,
  };
}
