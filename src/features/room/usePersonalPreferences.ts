import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmPersonal, getPersonal, interpretPersonal, parsePersonal, PersonalApiError, putPersonal, type PersonalDraft, type PersonalProposal, type PersonalRecord } from './personalApi';

function lostAccess(error: unknown): boolean {
  return error instanceof PersonalApiError && ([401, 403, 404].includes(error.status) || error.code === 'TRIP_CLOSED');
}

export function usePersonalPreferences(tripId: string | null, enabled: boolean) {
  const [record, setRecord] = useState<PersonalRecord | null>(null);
  const [proposal, setProposal] = useState<PersonalProposal | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'fatal'>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const interpretKey = useRef<string | null>(null);
  const clearPrivateState = useCallback(() => {
    epoch.current += 1;
    controller.current?.abort();
    controller.current = null;
    lock.current = false;
    interpretKey.current = null;
    setBusy(false);
    setRecord(null);
    setProposal(null);
    setState('fatal');
  }, []);
  const refresh = useCallback(async () => {
    if (!tripId || !enabled) return null;
    controller.current?.abort();
    lock.current = false;
    setBusy(false);
    const own = ++epoch.current;
    const abort = new AbortController(); controller.current = abort;
    setState('loading'); setMessage('');
    try {
      const result = await getPersonal(tripId, abort.signal);
      if (own !== epoch.current) return null;
      const parsed = parsePersonal(result);
      if (!parsed) throw new Error('개인 조건 응답을 읽을 수 없어요.');
      setRecord(parsed); setProposal(null); setState('ready'); return parsed;
    } catch (error) {
      if (abort.signal.aborted || own !== epoch.current) return null;
      if (lostAccess(error)) { clearPrivateState(); return null; }
      setMessage(error instanceof Error ? error.message : '개인 조건을 불러오지 못했어요.'); setState('error'); return null;
    }
  }, [clearPrivateState, enabled, tripId]);
  useEffect(() => {
    epoch.current += 1; controller.current?.abort(); controller.current = null; lock.current = false; interpretKey.current = null;
    setBusy(false); setRecord(null); setProposal(null); setMessage('');
    if (enabled && tripId) void refresh(); else setState('loading');
    return () => { epoch.current += 1; controller.current?.abort(); controller.current = null; lock.current = false; setBusy(false); };
  }, [enabled, tripId, refresh]);
  const run = useCallback(async <T,>(task: (signal: AbortSignal) => Promise<T>, apply: (value: T) => void, retryKey?: { current: string | null }): Promise<boolean> => {
    if (lock.current || !tripId || !record) return false;
    lock.current = true; setBusy(true); controller.current?.abort();
    const own = ++epoch.current; const abort = new AbortController(); controller.current = abort;
    try { const result = await task(abort.signal); if (own !== epoch.current) return false; apply(result); setMessage(''); return true; }
    catch (error) { if (own === epoch.current && !abort.signal.aborted) { if (lostAccess(error)) { clearPrivateState(); return false; } if (retryKey && error instanceof PersonalApiError && error.status >= 400 && error.status < 500) retryKey.current = null; setMessage(error instanceof PersonalApiError ? error.message : '요청을 완료하지 못했어요. 입력은 보관했어요.'); } return false; }
    finally { if (own === epoch.current) { lock.current = false; setBusy(false); } }
  }, [clearPrivateState, record, tripId]);
  const save = useCallback((draft: PersonalDraft) => run((signal) => putPersonal(tripId!, record!, draft, signal), (next) => { const parsed = parsePersonal(next); if (parsed) setRecord(parsed); setProposal(null); }), [record, run, tripId]);
  const interpret = useCallback(async (current?: PersonalRecord) => { if (!interpretKey.current) interpretKey.current = crypto.randomUUID(); const ok = await run((signal) => interpretPersonal(tripId!, current ?? record!, signal, interpretKey.current ?? undefined), (next) => setProposal(next), interpretKey); if (ok) interpretKey.current = null; return ok; }, [record, run, tripId]);
  const confirm = useCallback((current?: PersonalRecord) => run((signal) => confirmPersonal(tripId!, current ?? record!, signal), (next) => { const parsed = parsePersonal(next); if (parsed) setRecord(parsed); }), [record, run, tripId]);
  const applyProposal = useCallback((next: PersonalDraft) => { setRecord((current) => current ? { ...current, draft: next, confirmation: { ...current.confirmation, status: 'writing' } } : current); setProposal(null); }, []);
  const invalidateProposal = useCallback(() => { epoch.current += 1; controller.current?.abort(); lock.current = false; setBusy(false); setProposal(null); interpretKey.current = null; }, []);
  return { record, proposal, state, message, busy, fatal: state === 'fatal', invalidateProposal, refresh, save, interpret, confirm, applyProposal, clearProposal: () => setProposal(null) };
}
