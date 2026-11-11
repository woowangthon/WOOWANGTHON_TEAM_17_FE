import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import AsyncState from '../components/ui/AsyncState';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import CanvasPreview from '../features/workspace/CanvasPreview';
import { usePersonalPreparation } from '../features/personal/usePersonalPreparation';
import { useSharedPreparation } from '../features/room/useSharedPreparation';
import { useGenerationStart, type GenerationCanvasHandoff } from '../features/generation/useGenerationStart';
import { summarizePreparationReadiness } from '../features/generation/generationReadiness.ts';
import { GenerationLoadingOverlay } from '../features/generation/GenerationLoadingOverlay';
import ScheduleItemsEditor from '../features/personal/ScheduleItemsEditor';
import PreparationScheduleFields from '../features/preparation/PreparationScheduleFields';
import { conditionsToDraft } from '../features/room/preparationApi';
import { withPreservedHiddenConditions } from '../features/preparation/preparationModel';
import PreparationActionButton from '../features/preparation/PreparationActionButton';
import InfoTip from '../features/preparation/InfoTip';
import RegionPicker from '../features/preparation/RegionPicker';
import { CheckIcon, MapIcon, PanelIcon } from '../features/preparation/PreparationIcons';
import {
  emptyRoomDraft, formatDraftBudget, formatDraftDate, formatDraftPeople,
  formatDraftTransport, loadRoomEntry, previewPersonalDraft, validateRoomDraft, type PersonalDraft, type RoomDraft, type RoomEntry,
} from '../features/room/roomData';
import '../styles/workspace.css';
import '../styles/canvas-studio.css';
import '../styles/preparation.css';

const isPreview = new URLSearchParams(window.location.search).get('preview') === 'room';
const previewEntry: RoomEntry = {
  trip: { id: 'preview-room', name: '단양 주말 여행', status: 'OPEN', inviteCode: 'CB-DEMO' },
  member: { id: 'preview-member', nickname: '여행자 A', role: 'OWNER', status: 'ACTIVE' }, alreadyJoined: false,
};
const previewConditions: RoomDraft = {
  ...emptyRoomDraft, region: '충북 단양', startDate: '2026-11-14', endDate: '2026-11-15',
  expectedPeople: '3', budget: '600000', transport: 'car', departure: '청주역', returnRoute: '청주역',
  lodging: '1박 필요', fixedSchedule: '둘째 날 18:00까지 청주역 복귀',
};
type View = 'preparation' | 'canvas';

function PreferenceImportanceChoice({
  name, label, value, onChange,
}: { name: 'avoidImportance' | 'foodImportance'; label: string; value: 'preferred' | 'required'; onChange: (value: 'preferred' | 'required') => void }) {
  return <fieldset className="prep-importance-choice" aria-describedby="tw-importance-hint">
    <legend>{label}</legend>
    <div className="prep-importance-options">
      <label className={value === 'preferred' ? 'is-selected' : ''}><input type="radio" name={name} value="preferred" checked={value === 'preferred'} onChange={() => onChange('preferred')} /><span>가능하면 반영</span></label>
      <label className={value === 'required' ? 'is-selected' : ''}><input type="radio" name={name} value="required" checked={value === 'required'} onChange={() => onChange('required')} /><span>필수로 반영</span></label>
    </div>
  </fieldset>;
}

export default function RoomPage() {
  const query = new URLSearchParams(window.location.search);
  const tripId = query.get('tripId');
  const [entry, setEntry] = useState<RoomEntry | null>(isPreview ? previewEntry : null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(isPreview ? 'ready' : tripId ? 'loading' : 'error');
  const [errorMessage, setErrorMessage] = useState('여행방 주소가 없어요. 시작 화면에서 방을 만들거나 초대 코드로 참여해 주세요.');
  const [view, setView] = useState<View>(query.get('view') === 'canvas' ? 'canvas' : 'preparation');
  const [canvasHandoff, setCanvasHandoff] = useState<GenerationCanvasHandoff | null>(null);
  const [accessLostTripId, setAccessLostTripId] = useState<string | null>(null);
  const [conditions, setConditions] = useState<RoomDraft>(isPreview ? previewConditions : { ...emptyRoomDraft });
  const [conditionForm, setConditionForm] = useState<RoomDraft>(isPreview ? previewConditions : { ...emptyRoomDraft });
  const [conditionDirty, setConditionDirty] = useState(false);
  const [conditionErrors, setConditionErrors] = useState<Partial<Record<keyof RoomDraft, string>>>({});
  const [conditionMessage, setConditionMessage] = useState('');
  const [legacyAnchorsMoved, setLegacyAnchorsMoved] = useState(false);
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [rebaseRequired, setRebaseRequired] = useState(false);
  const [rebaseAccepted, setRebaseAccepted] = useState(false);
  const [rebaseVersion, setRebaseVersion] = useState<number | null>(null);
  const [previewPersonal, setPreviewPersonal] = useState<PersonalDraft>({ ...previewPersonalDraft });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const navCloseRef = useRef<HTMLButtonElement>(null);
  const navPanelRef = useRef<HTMLElement>(null);
  const preparationRailRef = useRef<HTMLButtonElement>(null);
  const canvasRailRef = useRef<HTMLButtonElement>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ message: string; success: boolean; roomId: string; view: View } | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyAttemptRef = useRef(0);
  const [openParticipantRoomId, setOpenParticipantRoomId] = useState<string | null>(null);
  const participantWrapRef = useRef<HTMLDivElement>(null);
  const participantTriggerRef = useRef<HTMLButtonElement>(null);
  const participantPanelId = useId();
  const [localPersonalMessage, setLocalPersonalMessage] = useState('');
  const requestRef = useRef(0);
  const shared = useSharedPreparation(tripId, entry, Boolean(!isPreview && status === 'ready' && entry));
  const baseFatalAccess = status === 'ready' && Boolean(entry) && !isPreview && (shared.state === 'fatal' || accessLostTripId === tripId);
  const onGenerationAccessLost = useCallback(() => setAccessLostTripId(tripId), [tripId]);
  const personalHook = usePersonalPreparation({ tripId, enabled: Boolean(!isPreview && status === 'ready' && entry && shared.state === 'ready' && !baseFatalAccess), conditionsVersion: shared.preparation?.conditionsVersion ?? 0, onSaved: () => { void shared.refreshAfterPersonalMutation(); } });
  const fatalAccess = baseFatalAccess || (!isPreview && personalHook.state === 'fatal');
  const participantsOpen = openParticipantRoomId === entry?.trip.id && view === 'preparation' && !fatalAccess;
  const localGenerationBlocker = conditionDirty || shared.saving || rebaseRequired
    ? '여행 기본조건의 미저장 변경을 먼저 저장하거나 취소해 주세요.'
    : !isPreview && personalHook.state !== 'ready'
      ? '내 취향과 준비 상태를 불러온 뒤 다시 시도해 주세요.'
    : !isPreview && personalHook.saveStatus !== 'confirmed'
      ? '내 취향을 저장하고 준비 완료를 눌러 주세요.'
    : personalHook.dirty || personalHook.phase !== 'idle'
      ? '내 취향 변경을 저장하고 준비 처리를 마친 뒤 다시 시도해 주세요.'
      : undefined;
  const generationStart = useGenerationStart({
    tripId,
    enabled: Boolean(!isPreview && status === 'ready' && entry?.member.role === 'OWNER' && shared.state === 'ready' && !fatalAccess),
    blockedReason: localGenerationBlocker,
    onStarted: handoff => { setCanvasHandoff(handoff); changeView('canvas'); },
    onAccessLost: onGenerationAccessLost,
  });
  const refreshGeneration = generationStart.refresh;
  const confirmedRoster = (shared.preparation?.members ?? []).map(member => `${member.id}:${member.preparationStatus}`).join('|');
  const readinessFreshnessKey = [shared.preparation?.conditionsVersion ?? '', personalHook.confirmation?.confirmedConditionsVersion ?? '', personalHook.confirmation?.confirmedPreferenceVersion ?? '', confirmedRoster].join(':');
  useEffect(() => {
    if (status === 'ready' && entry?.member.role === 'OWNER' && shared.state === 'ready') void refreshGeneration();
  }, [entry?.member.role, readinessFreshnessKey, refreshGeneration, shared.state, status]);

  function invalidateCopyFeedback() {
    copyAttemptRef.current += 1;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
  }

  /* eslint-disable react/set-state-in-effect */
  useEffect(() => {
    invalidateCopyFeedback();
    // These transient controls belong to the current room, view, and access state.
    setCopyFeedback(null);
    setOpenParticipantRoomId(null);
    return () => {
      invalidateCopyFeedback();
    };
  }, [tripId, entry?.trip.id, view, fatalAccess]);
  /* eslint-enable react/set-state-in-effect */

  useEffect(() => {
    if (!participantsOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const focusWasInside = participantWrapRef.current?.contains(document.activeElement) ?? false;
      setOpenParticipantRoomId(null);
      if (focusWasInside) participantTriggerRef.current?.focus();
    }
    function closeOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && !participantWrapRef.current?.contains(event.target)) setOpenParticipantRoomId(null);
    }
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutside);
    return () => { document.removeEventListener('keydown', closeOnEscape); document.removeEventListener('pointerdown', closeOnOutside); };
  }, [participantsOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    navCloseRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
        navToggleRef.current?.focus();
      }
    }
    function closeOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && !navPanelRef.current?.contains(event.target) && !navToggleRef.current?.contains(event.target)) setMobileNavOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape, true);
    document.addEventListener('pointerdown', closeOnOutside);
    return () => { document.removeEventListener('keydown', closeOnEscape, true); document.removeEventListener('pointerdown', closeOnOutside); };
  }, [mobileNavOpen]);

  // The inline editor follows stable server snapshots, while dirty input keeps its original CAS version.
  /* eslint-disable react/set-state-in-effect */
  useEffect(() => {
    if (!shared.preparation || isPreview) return;
    const incoming = conditionsToDraft(shared.preparation.conditions);
    // oxlint-disable-next-line react(set-state-in-effect)
    setConditions(incoming);
    // oxlint-disable-next-line react(set-state-in-effect)
    if (!conditionDirty) { setConditionForm(incoming); setEditVersion(shared.preparation.conditionsVersion); }
  }, [shared.preparation, conditionDirty]);
  /* eslint-enable react/set-state-in-effect */
  useEffect(() => {
    if (isPreview || !tripId) return;
    const requestId = ++requestRef.current;
    let active = true;
    loadRoomEntry(tripId).then((result) => { if (active && requestRef.current === requestId) { setEntry(result); setStatus('ready'); } })
      .catch((error: unknown) => { if (active && requestRef.current === requestId) { setErrorMessage(error instanceof Error ? error.message : '여행방 정보를 불러오지 못했어요.'); setStatus('error'); } });
    return () => { active = false; };
  }, [tripId]);

  function updateCondition<K extends keyof RoomDraft>(key: K, value: RoomDraft[K]) {
    setConditionDirty(true);
    setConditionMessage('');
    setConditionForm((current) => ({ ...current, [key]: value }));
    setConditionErrors((current) => ({ ...current, [key]: undefined, ...(key === 'startDate' || key === 'endDate' ? { startDate: undefined, endDate: undefined } : {}) }));
  }
  async function saveConditions() {
    if (shared.saving) return;
    if (!conditionDirty) { setConditionMessage('변경된 공통 조건이 없어요.'); return; }
    const errors = validateRoomDraft(conditionForm);
    setConditionErrors(errors);
    if (Object.keys(errors).length) return;
    if (isPreview) { setConditions({ ...conditionForm }); setConditionDirty(false); setConditionMessage('예시 조건을 이 화면에 반영했어요.'); return; }
    if (!shared.preparation?.canEditConditions || editVersion === null) return;
    if (rebaseRequired && !rebaseAccepted) { document.getElementById('room-rebase-accept')?.focus(); return; }
    const result = await shared.save(withPreservedHiddenConditions(conditionForm, shared.conditions, { clearLegacyAnchors: legacyAnchorsMoved }), editVersion);
    if (result === 'saved' || result === 'unchanged') {
      const savedDraft = legacyAnchorsMoved ? { ...conditionForm, lodging: '', fixedSchedule: '' } : { ...conditionForm };
      setConditions(savedDraft); setConditionForm(savedDraft); setConditionDirty(false);
      setRebaseRequired(false); setRebaseAccepted(false); setRebaseVersion(null); setLegacyAnchorsMoved(false);
      setConditionMessage(result === 'unchanged' ? '변경된 공통 조건이 없어요.'
        : legacyAnchorsMoved ? '공통 조건을 저장했어요. 내 취향에서 옮긴 정보를 분석한 뒤 저장해 주세요.' : '공통 조건을 저장했어요.');
      return;
    }
    if (result === 'conflict' || result === 'failed') {
      setRebaseRequired(true); setRebaseAccepted(false); setRebaseVersion(null);
      const latest = await shared.refresh();
      if (latest) { setRebaseVersion(latest.conditionsVersion); setConditionMessage('최신 조건과 내 입력을 비교한 뒤 다시 적용해 주세요.'); }
    }
  }
  function moveLegacyAnchorsToPersonal() {
    const oldLodging = conditions.lodging.trim(); const oldSchedule = conditions.fixedSchedule.trim();
    const addition = [oldLodging ? `기존 공통 숙소 정보: ${oldLodging}` : '', oldSchedule ? `기존 공통 약속 정보: ${oldSchedule}` : ''].filter(Boolean).join('\n');
    if (!addition) return;
    const existing = personalHook.draft.originalText.trim();
    const next = [existing, addition].filter(Boolean).join('\n\n');
    if ([...next].length > 5000) { setConditionMessage('내 취향 원문에 들어갈 공간이 부족해요. 내용을 복사해 직접 옮겨 주세요.'); return; }
    personalHook.updateDraft('originalText', next);
    setConditionForm(current => ({ ...current, lodging: '', fixedSchedule: '' }));
    setConditionDirty(true); setLegacyAnchorsMoved(true);
    setConditionMessage('기존 내용을 내 취향 원문에 복사했어요. 조건 저장 후 내 취향에서 분석해 주세요.');
  }
  async function copyInvite() {
    if (!entry) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
    setCopyFeedback(null);
    const attempt = ++copyAttemptRef.current;
    const roomId = entry.trip.id;
    const attemptView = view;
    const copiedFeedback = (success: boolean) => {
      if (copyAttemptRef.current !== attempt || view !== attemptView || entry?.trip.id !== roomId) return;
      const message = success ? '초대 코드를 복사했어요.' : `초대 코드 ${entry.trip.inviteCode}를 직접 복사해 주세요.`;
      setCopyFeedback({ message, success, roomId, view: attemptView });
      copyTimerRef.current = setTimeout(() => {
        if (copyAttemptRef.current === attempt) setCopyFeedback(null);
        copyTimerRef.current = null;
      }, success ? 2500 : 5000);
    };
    try { await navigator.clipboard.writeText(entry.trip.inviteCode); copiedFeedback(true); }
    catch { copiedFeedback(false); }
  }
  function changeView(next: View) {
    if (next !== view) {
      setOpenParticipantRoomId(null);
      copyAttemptRef.current += 1;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
      setCopyFeedback(null);
    }
    setMobileNavOpen(false);
    setView(next);
    const nextQuery = new URLSearchParams(window.location.search);
    if (next === 'preparation') nextQuery.delete('view'); else nextQuery.set('view', next);
    window.history.replaceState(null, '', `${window.location.pathname}?${nextQuery.toString()}`);
  }
  const personal = isPreview ? previewPersonal : personalHook.draft;
  const updatePersonal = <K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) => {
    if (isPreview) { setPreviewPersonal((draft) => ({ ...draft, [key]: value })); setLocalPersonalMessage('미리보기 취향을 수정했어요.'); }
    else {
      if (key === 'originalText') generationStart.clearPersonalIssue();
      else if (key === 'likes' || key === 'avoid' || key === 'food' || key === 'walking') generationStart.clearPersonalIssue(key);
      else if (key === 'avoidImportance') generationStart.clearPersonalIssue('avoid');
      else if (key === 'foodImportance') generationStart.clearPersonalIssue('food');
      personalHook.updateDraft(key, value);
    }
  };
  const people = isPreview ? [
    { id: previewEntry.member.id, nickname: '여행자 A', role: 'OWNER' as const, preparationStatus: 'writing' as const },
    { id: 'preview-b', nickname: '여행자 B', role: 'MEMBER' as const, preparationStatus: 'writing' as const },
    { id: 'preview-c', nickname: '여행자 C', role: 'MEMBER' as const, preparationStatus: 'confirmed' as const },
  ] : shared.preparation?.members ?? [];
  const canEdit = isPreview || Boolean(shared.preparation?.canEditConditions);
  const fieldErrors = { ...shared.saveFieldErrors, ...conditionErrors };
  const readinessCodes = new Set(generationStart.data?.reasons.map(reason => reason.code) ?? []);
  const sharedReadiness = summarizePreparationReadiness(shared.preparation ? {
    expectedPeople: shared.preparation.conditions.expectedPeople,
    activeMemberCount: shared.preparation.activeMemberCount,
    members: shared.preparation.members.map(member => ({ preparationStatus: member.preparationStatus })),
    reasons: shared.preparation.readiness.reasons,
    conditionsReady: shared.preparation.readiness.conditionsReady,
  } : null);
  const confirmedMemberCount = people.filter(member => member.preparationStatus === 'confirmed').length;
  const participantCount = people.length;
  const rosterSummary = `참여자 ${participantCount}명 중 ${confirmedMemberCount}명 준비 완료`;
  const confirmedRatio = participantCount > 0 ? confirmedMemberCount / participantCount : 0;
  const sharedGenerationBlocker = sharedReadiness.blockers.join(' ');
  const resumableJob = ['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(generationStart.data?.latestJob?.status ?? '');
  const generationCtaBlocker = localGenerationBlocker || (sharedGenerationBlocker && !resumableJob ? sharedGenerationBlocker : '');
  const legacyLodgingNeedsAnchor = readinessCodes.has('LODGING_ANCHOR_REQUIRED') || readinessCodes.has('COMMON_REVIEW_REQUIRED');
  const legacyScheduleNeedsAnchor = readinessCodes.has('FIXED_SCHEDULE_ANCHOR_REQUIRED') || readinessCodes.has('COMMON_REVIEW_REQUIRED');
  const showLegacyAnchorGuide = canEdit && ((legacyLodgingNeedsAnchor && Boolean(conditions.lodging.trim())) || (legacyScheduleNeedsAnchor && Boolean(conditions.fixedSchedule.trim())));
  const sampleTrip = isPreview;
  const issueFor = (field: 'likes' | 'avoid' | 'food' | 'walking') => generationStart.personalIssues?.find(issue => issue.field === field);
  const issueMessage = (field: 'likes' | 'avoid' | 'food' | 'walking') => {
    if (!issueFor(field)) return '';
    if (field === 'food') return '장소 정보로 이 음식 조건을 확인할 수 없어요. 필수라면 방문할 식당에 확인해 주세요.';
    if (field === 'avoid') return '장소 정보로 이 조건을 확인할 수 없어요. 단순한 선호라면 ‘가능하면 반영’을 선택해 주세요.';
    if (field === 'likes') return '좋아하는 것과 피하고 싶은 것이 함께 있어요. 싫어하는 항목을 ‘피하고 싶은 장소나 활동’으로 옮겨 주세요.';
    return '걷기 제한을 선택하고 내 취향을 다시 저장해 주세요.';
  };
  const privateSaveLabel = { loading: '불러오는 중', saving: '저장 중', unsaved: '미저장', saved: '저장됨', confirmed: '준비 완료', unknown: '확인 필요', empty: '입력 전' }[personalHook.saveStatus];
  return <main className="travel-workspace prep-room-shell">
    <header className="tw-topbar prep-topbar">
      <a className="tw-brand" href="/">충북 여행 계획</a>
      <div className="tw-topbar-actions">{entry && <><span className="prep-invite-code">초대 코드 <code>{entry.trip.inviteCode}</code></span><span className="prep-copy-wrap"><Button variant="secondary" onClick={() => void copyInvite()}>초대 코드 복사</Button>{!fatalAccess && copyFeedback && copyFeedback.roomId === entry.trip.id && copyFeedback.view === view && <span className={`prep-copy-feedback ${copyFeedback.success ? 'is-success' : 'is-error'}`} role="status">{copyFeedback.message}</span>}</span><span className="tw-user">{entry.member.nickname}</span></>}</div>
    </header>
    {sampleTrip && <p className="tw-preview-note">화면과 입력은 예시이며 실제 여행방에 저장되지 않아요.</p>}
    {status === 'loading' && <section className="tw-state"><AsyncState status="loading" title="여행방을 확인하고 있어요" description="잠시만 기다려 주세요." /></section>}
    {status === 'error' && <section className="tw-state">{tripId ? <AsyncState status="error" title="여행방에 들어오지 못했어요" description={errorMessage} onRetry={() => { setStatus('loading'); loadRoomEntry(tripId).then((result) => { setEntry(result); setStatus('ready'); }).catch((error: unknown) => { setErrorMessage(error instanceof Error ? error.message : '여행방 정보를 불러오지 못했어요.'); setStatus('error'); }); }} /> : <div role="alert"><h2>여행방 주소를 확인할 수 없어요</h2><p>{errorMessage}</p></div>}<a href="/">여행 시작으로 돌아가기</a></section>}
    {status === 'ready' && entry && !isPreview && shared.state === 'loading' && <section className="tw-state"><AsyncState status="loading" title="공통 조건을 불러오고 있어요" description="참여자와 공유된 정보만 확인하고 있어요." /></section>}
    {status === 'ready' && entry && !isPreview && shared.state === 'error' && <section className="tw-state"><AsyncState status="error" title="여행 준비 정보를 불러오지 못했어요" description={shared.message} onRetry={() => void shared.refresh()} /></section>}
    {fatalAccess && <section className="tw-state" role="alert"><h2>여행방에 계속 접근할 수 없어요</h2><p>{shared.message || '참여 권한이나 여행방 상태가 바뀌었어요. 다시 참여해 주세요.'}</p><a href="/">여행 시작으로 돌아가기</a></section>}
    {status === 'ready' && entry && (isPreview || shared.state === 'ready') && !fatalAccess && <div className="prep-workspace">
      <aside className="prep-icon-rail" aria-label="여행 탐색">
        <button ref={navToggleRef} type="button" className="prep-rail-button" aria-expanded={mobileNavOpen} aria-label={mobileNavOpen ? '탐색 메뉴 닫기' : '탐색 메뉴 열기'} title={mobileNavOpen ? '탐색 메뉴 닫기' : '탐색 메뉴 열기'} onClick={() => setMobileNavOpen((open) => !open)}><PanelIcon /></button>
        <span className="prep-rail-rule" />
        <button ref={preparationRailRef} type="button" className={`prep-rail-button ${view === 'preparation' ? 'is-active' : ''}`} aria-current={view === 'preparation' ? 'page' : undefined} aria-label="여행 준비" title="여행 준비" onClick={() => changeView('preparation')}><CheckIcon /></button>
        <button ref={canvasRailRef} type="button" className={`prep-rail-button ${view === 'canvas' ? 'is-active' : ''}`} aria-current={view === 'canvas' ? 'page' : undefined} aria-label="일정 캔버스" title="일정 캔버스" onClick={() => changeView('canvas')}><MapIcon /></button>
      </aside>
      {mobileNavOpen && <aside ref={navPanelRef} className="prep-nav-overlay" aria-label="여행 메뉴">
        <div className="prep-nav-heading"><strong>메뉴</strong><button ref={navCloseRef} type="button" className="prep-nav-close" aria-label="탐색 메뉴 닫기" onClick={() => { setMobileNavOpen(false); navToggleRef.current?.focus(); }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></div>
        <nav className="prep-nav-links" aria-label="여행방 메뉴"><button className={view === 'preparation' ? 'is-selected' : ''} type="button" aria-current={view === 'preparation' ? 'page' : undefined} onClick={() => { changeView('preparation'); preparationRailRef.current?.focus(); }}><CheckIcon /><span>여행 준비</span></button><button className={view === 'canvas' ? 'is-selected' : ''} type="button" aria-current={view === 'canvas' ? 'page' : undefined} onClick={() => { changeView('canvas'); canvasRailRef.current?.focus(); }}><MapIcon /><span>일정 캔버스</span></button></nav>
        <a className="prep-nav-return" href="/">여행 시작으로 돌아가기</a>
      </aside>}
      {view === 'canvas' ? <CanvasPreview key={entry.trip.id} tripId={entry.trip.id} preview={isPreview} startDate={conditions.startDate} endDate={conditions.endDate} conditionsVersion={isPreview ? null : shared.preparation?.conditionsVersion ?? null} transport={isPreview ? null : shared.preparation?.conditions.transport ?? null} handoff={canvasHandoff?.tripId === entry.trip.id ? canvasHandoff : null} /> : <section className="prep-main" aria-label="여행 준비 작업 공간">
        <header className="prep-page-heading">
          <div className="prep-heading-info">
            <h1>{entry.trip.name || '여행 준비'}</h1>
            <div className="prep-heading-meta" aria-label="저장된 여행 조건">
              <span>{conditions.startDate && conditions.endDate ? formatDraftDate(conditions.startDate, conditions.endDate) : '날짜 미정'}</span>
              <span>{conditions.region || '지역 미정'}</span>
            </div>
          </div>
          <div className="prep-participant-disclosure" ref={participantWrapRef}>
            <button
              ref={participantTriggerRef}
              className="prep-participant-trigger"
              type="button"
              aria-label={rosterSummary}
              title={rosterSummary}
              aria-expanded={participantsOpen}
              aria-controls={participantPanelId}
              onClick={() => setOpenParticipantRoomId(participantsOpen ? null : entry.trip.id)}
            >
              <span>참여자</span>
              <span className="prep-participant-donut" aria-hidden="true" style={{ '--roster-progress': `${confirmedRatio * 360}deg` } as CSSProperties} />
              <span className="prep-participant-count">{confirmedMemberCount}/{participantCount}</span>
              <svg className="prep-participant-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
            </button>
            {participantsOpen && <section className="prep-participant-panel" id={participantPanelId} aria-label="참여자 준비 상태">
              <ul className="prep-participant-list">
                {people.map(person => {
                  const isOwn = person.id === entry.member.id;
                  const confirmed = person.preparationStatus === 'confirmed';
                  return <li className="prep-participant" data-member-id={isOwn ? 'me' : person.id} key={person.id}>
                    <span className="prep-person-name">{person.nickname}<small>{person.role === 'OWNER' ? '방장' : isOwn ? '나' : ''}</small></span>
                    <span className={`prep-person-status ${confirmed ? 'is-confirmed' : ''}`}>{confirmed ? '준비 완료' : '준비 중'}</span>
                  </li>;
                })}
              </ul>
            </section>}
          </div>
        </header>
        {!isPreview && shared.message && shared.state === 'ready' && <div className="prep-shared-refresh-error" role="alert"><span>{shared.message}</span><Button variant="secondary" disabled={shared.refreshing} onClick={() => void shared.refresh()}>{shared.refreshing ? '새로고침 중…' : '다시 불러오기'}</Button></div>}
        <div className="prep-grid">
          <section className="prep-condition-section" aria-labelledby="tw-condition-title">
            <header className="prep-section-heading"><div className="prep-title-line"><h2 id="tw-condition-title">여행 기본조건</h2><InfoTip label="여행 기본조건 도움말" text={sampleTrip ? '편집 가능한 예시 조건이에요.' : '참여자 모두에게 공유되는 조건이에요. 바꾸면 참여자들이 새 조건을 확인해야 해요.'} /></div></header>
            {!canEdit && <p className="prep-readonly-note">조건 입력은 방장에게 요청해 주세요.</p>}
            <fieldset className={`prep-condition-fields ${!canEdit ? 'is-readonly' : ''}`} disabled={!canEdit || shared.saving}>
              <RegionPicker value={conditionForm.region} error={fieldErrors.region} disabled={!canEdit || shared.saving} onChange={(value) => updateCondition('region', value)} />
              <div className="prep-date-fields"><Input id="start-date" label="여행 시작일" type="date" value={conditionForm.startDate} error={fieldErrors.startDate} onChange={(event) => updateCondition('startDate', event.target.value)} /><Input id="end-date" label="여행 마지막 날" type="date" value={conditionForm.endDate} error={fieldErrors.endDate} onChange={(event) => updateCondition('endDate', event.target.value)} /></div>
              <div className="prep-two-fields"><div className="prep-input-wrap"><Input id="people" label="예정 인원" type="number" min="1" max="50" value={conditionForm.expectedPeople} placeholder="인원" error={fieldErrors.expectedPeople} onChange={(event) => updateCondition('expectedPeople', event.target.value)} /><small>현재 참여 {people.length}명</small></div><Input id="budget" label="전체 여행 예산 (원)" type="number" min="1" max="1000000000" value={conditionForm.budget} placeholder="예산 입력" error={fieldErrors.budget} onChange={(event) => updateCondition('budget', event.target.value)} /></div>
              <fieldset className="prep-transport" id="transport" aria-describedby={fieldErrors.transport ? 'transport-error' : undefined}><legend>이동수단</legend><div className="prep-transport-options">{([['car', '자가용'], ['transit', '대중교통'], ['charter', '전세버스'], ['walk', '도보'], ['undecided', '미정']] as const).map(([value, label]) => <button type="button" className={`prep-transport-option ${conditionForm.transport === value ? 'is-selected' : ''}`} key={value} aria-pressed={conditionForm.transport === value} onClick={() => updateCondition('transport', value)}>{label}</button>)}</div>{fieldErrors.transport && <p className="field-error" id="transport-error" role="alert">{fieldErrors.transport}</p>}</fieldset>
              <PreparationScheduleFields key={tripId ?? ''} tripId={tripId ?? ''} value={{ departureTime: conditionForm.departureTime }} departure={conditionForm.departure} returnRoute={conditionForm.returnRoute} departureError={fieldErrors.departure} departureTimeError={fieldErrors.departureTime} departureContentidError={fieldErrors.departureContentid} returnRouteError={fieldErrors.returnRoute} disabled={!canEdit || shared.saving} onChange={(key, value) => updateCondition(key, value)} onDepartureChange={value => updateCondition('departure', value)} onDepartureContentidChange={value => updateCondition('departureContentid', value)} onReturnRouteChange={value => updateCondition('returnRoute', value)} />
              {showLegacyAnchorGuide && <aside className="prep-schedule-hint" aria-label="기존 공통 일정 정보 안내"><p>기존 공통 정보에 장소와 시간이 지정되지 않았어요. 그대로 보관하거나 내 취향 원문으로 옮길 수 있어요.</p>{legacyLodgingNeedsAnchor && conditions.lodging.trim() && <p><strong>기존 공통 숙소 정보:</strong> {conditions.lodging}</p>}{legacyScheduleNeedsAnchor && conditions.fixedSchedule.trim() && <p><strong>기존 공통 약속 정보:</strong> {conditions.fixedSchedule}</p>}{legacyAnchorsMoved ? <p role="status">내 취향 원문으로 복사했어요. 조건 저장 후 내 취향에서 분석해 주세요.</p> : <Button variant="secondary" disabled={personalHook.state !== 'ready' || personalHook.phase !== 'idle'} onClick={moveLegacyAnchorsToPersonal}>내 취향으로 옮기기</Button>}</aside>}
            </fieldset>
            {canEdit && <div className="prep-condition-save">{(conditionMessage || (!rebaseRequired && shared.saveMessage)) && <span className="prep-condition-status" role="status">{conditionMessage || shared.saveMessage}</span>}<PreparationActionButton label="조건 저장" loading={shared.saving} loadingLabel="조건 저장 중" disabled={!conditionDirty || shared.saving} onClick={() => void saveConditions()} /></div>}
            {!canEdit && <dl className="prep-readonly-values"><div><dt>지역</dt><dd>{conditions.region || '미정'}</dd></div><div><dt>여행 기간</dt><dd>{conditions.startDate && conditions.endDate ? formatDraftDate(conditions.startDate, conditions.endDate) : '미정'}</dd></div><div><dt>예정 인원</dt><dd>{formatDraftPeople(conditions.expectedPeople)}</dd></div><div><dt>전체 예산</dt><dd>{formatDraftBudget(conditions.budget)}</dd></div><div><dt>이동수단</dt><dd>{formatDraftTransport(conditions.transport)}</dd></div><div><dt>출발지와 복귀</dt><dd>{conditions.departure || '미정'} / {conditions.returnRoute || '미정'}</dd></div></dl>}
            {rebaseRequired && <section className="tw-conflict" aria-live="polite"><h3>공통 조건이 먼저 바뀌었어요</h3><p>{shared.saveMessage || '최신 조건을 확인한 뒤 내 입력을 다시 적용해 주세요.'}</p><dl>{(['region', 'startDate', 'endDate', 'expectedPeople', 'budget', 'transport', 'departure', 'returnRoute'] as const).map((key) => <div key={key}><dt>{key === 'region' ? '지역' : key === 'startDate' ? '시작일' : key === 'endDate' ? '마지막 날' : key === 'expectedPeople' ? '인원' : key === 'budget' ? '예산' : key === 'transport' ? '이동수단' : key === 'departure' ? '출발지' : '복귀 장소'}</dt><dd><span>최신: {key === 'transport' ? formatDraftTransport(shared.conditions?.transport ?? 'undecided') : shared.conditions?.[key] || '미정'}</span><span>내 입력: {key === 'transport' ? formatDraftTransport(conditionForm.transport) : conditionForm[key] || '미정'}</span></dd></div>)}</dl>{rebaseVersion === null ? <Button variant="secondary" onClick={() => { void shared.refresh().then((latest) => { if (latest) setRebaseVersion(latest.conditionsVersion); }); }} disabled={shared.refreshing}>최신 조건 불러오기</Button> : <Button id="room-rebase-accept" variant="secondary" onClick={() => { setEditVersion(rebaseVersion); setRebaseAccepted(true); }}>최신 조건 확인 후 내 변경 다시 적용</Button>}{rebaseAccepted && <p>최신 버전 {editVersion}에 내 변경을 적용할 준비가 됐어요. 저장을 눌러 주세요.</p>}</section>}
          </section>

          <section className="prep-personal-section" aria-labelledby="tw-personal-title">
            <header className="prep-section-heading"><div className="prep-title-line"><h2 id="tw-personal-title" tabIndex={-1}>내 취향</h2><InfoTip label="개인 정보 안내" text="원문과 취향 입력은 본인에게만 표시돼요." /></div></header>
            {!isPreview && personalHook.state !== 'fatal' && personalHook.conditionsChangedNotice && <p className="prep-conditions-changed-notice" role="status">공통 여행 조건이 바뀌었어요. 최신 조건과 내 취향을 확인한 뒤 준비 완료를 눌러 주세요.</p>}
            {isPreview ? <p className="prep-personal-message">예시 입력이에요. 분석 기능은 연결되지 않았어요.</p> : personalHook.state === 'fatal' ? <p className="prep-personal-message" role="alert">접근 권한을 확인할 수 없어 개인 입력을 숨겼어요.</p> : null}
            {(!isPreview && personalHook.state === 'fatal') ? null : <>
              {!isPreview && personalHook.state === 'error' && <div className="prep-recovery" role="alert"><p>{personalHook.conditionsChangedNotice ? '개인 입력의 저장 상태를 확인해야 해요.' : personalHook.message} 현재 입력은 남아 있어요. 저장본을 불러오면 미저장 입력이 대체돼요.</p><Button variant="secondary" onClick={() => void personalHook.reload()}>미저장 입력을 지우고 저장본 불러오기</Button></div>}
              <fieldset className="prep-personal-editor" disabled={!isPreview && (personalHook.state !== 'ready' || personalHook.phase !== 'idle')}>
                <div className={`prep-original-wrap ${!isPreview && personalHook.phase === 'analyzing' ? 'is-busy' : ''}`} aria-busy={!isPreview && personalHook.phase === 'analyzing'}>
                  <div className="prep-original-field"><label htmlFor="tw-original">어떤 여행을 하고 싶나요?</label><textarea id="tw-original" maxLength={5000} className="text-input prep-original-input" value={personal.originalText} onChange={(event) => updatePersonal('originalText', event.target.value)} placeholder="예: 자연 풍경을 보며 여유롭게 쉬고 싶어요. 오래 걷는 일정은 어려워요." /></div>
                  {!isPreview && personalHook.phase === 'analyzing' && <div className="prep-progress" role="status"><svg className="prep-progress-spinner" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" /></svg>{personalHook.analysisStep === 'source' ? '입력 내용을 저장하고 있어요' : personalHook.analysisStep === 'interpret' ? '취향을 분석하고 있어요' : '분석 결과를 저장하고 있어요'}</div>}
                </div>
                <div className="prep-analysis-row"><PreparationActionButton label="취향 분석하기" loading={personalHook.phase === 'analyzing'} loadingLabel="취향 분석 중" disabled={isPreview || personalHook.state !== 'ready' || personalHook.phase !== 'idle' || !personal.originalText.trim()} onClick={() => { if (!isPreview) void personalHook.analyzeAndSave(); }} />{isPreview && <span>예시 화면에서는 분석할 수 없어요.</span>}</div>
                {!isPreview && personalHook.state === 'ready' && personalHook.phase === 'idle' && personalHook.operationError && <p className="prep-operation-error" role="alert">{personalHook.operationError}</p>}
                {(!isPreview && personalHook.state === 'ready' && personalHook.resultStatus === 'stale' && personalHook.phase === 'idle') && <p className="prep-stale-note" role="status">입력 내용이 바뀌었어요. 필요하면 다시 분석해 주세요.</p>}
                {(personalHook.resultsVisible || isPreview) ? <>
                  <div className="prep-parsed-heading"><h3>내 취향</h3><span>{isPreview ? '예시 결과' : personalHook.resultStatus === 'analyzed' ? '분석 완료' : '저장된 내용'}</span></div>
                  <p className="prep-importance-hint" id="tw-importance-hint">선호하는 내용은 가능한 만큼 반영해요. 필수 조건은 장소 정보로 확인할 수 있어야 일정을 만들어요.</p>
                  <div className="prep-personal-fields"><div className="field"><label htmlFor="tw-likes">좋아하는 것</label><input id="tw-likes" className="text-input" maxLength={500} value={personal.likes} placeholder="예: 자연 풍경, 조용한 카페" aria-invalid={Boolean(issueFor('likes'))} aria-describedby={issueFor('likes') ? 'tw-likes-issue' : undefined} onChange={(event) => updatePersonal('likes', event.target.value)} />{issueFor('likes') && <p className="prep-personal-field-error" id="tw-likes-issue" role="alert">{issueMessage('likes')}</p>}</div>
                    <div className="field"><label htmlFor="tw-avoid">피하고 싶은 장소나 활동</label><input id="tw-avoid" className="text-input" maxLength={500} value={personal.avoid} placeholder="예: 계단이 많은 코스, 30분 넘는 도보" aria-invalid={Boolean(issueFor('avoid'))} aria-describedby={issueFor('avoid') ? 'tw-avoid-issue' : undefined} onChange={(event) => updatePersonal('avoid', event.target.value)} />{issueFor('avoid') && <p className="prep-personal-field-error" id="tw-avoid-issue" role="alert">{issueMessage('avoid')}</p>}{personal.avoid && <PreferenceImportanceChoice name="avoidImportance" label="피하기 반영 수준" value={personal.avoidImportance} onChange={value => updatePersonal('avoidImportance', value)} />}</div>
                    <div className="field"><label htmlFor="tw-food">먹고 싶거나 피하고 싶은 음식</label><input id="tw-food" className="text-input" maxLength={500} value={personal.food} placeholder="예: 회는 먹고 싶고, 우유는 피하고 싶어요" aria-invalid={Boolean(issueFor('food'))} aria-describedby={issueFor('food') ? 'tw-food-issue' : undefined} onChange={(event) => updatePersonal('food', event.target.value)} />{issueFor('food') && <p className="prep-personal-field-error" id="tw-food-issue" role="alert">{issueMessage('food')}</p>}{personal.food && <PreferenceImportanceChoice name="foodImportance" label="식사 반영 수준" value={personal.foodImportance} onChange={value => updatePersonal('foodImportance', value)} />}</div>
                    <fieldset className="prep-walking" aria-describedby={issueFor('walking') ? 'tw-walking-issue' : undefined} aria-invalid={Boolean(issueFor('walking'))}><legend>걷기</legend><div>{([['20', '20분 이내'], ['40', '40분 이내'], ['unlimited', '제한 없음']] as const).map(([value, label]) => <button type="button" key={value} className={personal.walking === value ? 'is-selected' : ''} aria-pressed={personal.walking === value} onClick={() => updatePersonal('walking', value)}>{label}</button>)}</div>{issueFor('walking') && <p className="prep-personal-field-error" id="tw-walking-issue" role="alert">{issueMessage('walking')}</p>}</fieldset>
                  </div>
                  {!isPreview && personal.scheduleItems.length > 0 && <ScheduleItemsEditor tripId={tripId ?? ''} items={personal.scheduleItems} clarifications={personalHook.clarifications} canSetGroup={entry.member.role === 'OWNER'} disabled={personalHook.state !== 'ready' || personalHook.phase !== 'idle'} onChange={items => personalHook.updateDraft('scheduleItems', items)} />}
                </> : <div className="prep-parsed-empty"><h3>내 취향</h3><p>원하는 내용을 적고 분석하면 여기에 정리돼요.</p></div>}
                {isPreview ? <div className="prep-confirm-row"><span role="status">{localPersonalMessage || '예시 입력은 실제 여행방 상태에 반영되지 않아요.'}</span></div> : <div className="prep-confirm-row prep-personal-actions">
                  {!personalHook.resultsVisible && personalHook.dirty && <div className="prep-personal-save-row"><span className="prep-private-save-status" role="status">{privateSaveLabel}</span><PreparationActionButton label="초안 저장" loading={personalHook.phase === 'saving'} loadingLabel="초안 저장 중" disabled={personalHook.state !== 'ready' || personalHook.phase !== 'idle' || conditionDirty || shared.saving || rebaseRequired} onClick={() => void personalHook.save()} /></div>}
                  {personalHook.resultsVisible && <div className="prep-personal-save-row"><span className="prep-private-save-status" role="status">{privateSaveLabel}</span>{!(personalHook.saveStatus === 'confirmed' && !personalHook.dirty) && <PreparationActionButton label="저장하고 준비 완료" loading={personalHook.phase === 'saving' || personalHook.phase === 'confirming'} loadingLabel={personalHook.phase === 'saving' ? '취향 저장 중' : '준비 완료 처리 중'} disabled={personalHook.state !== 'ready' || personalHook.phase !== 'idle' || conditionDirty || shared.saving || rebaseRequired} onClick={() => void personalHook.saveAndConfirm()} />}</div>}
                </div>}
              </fieldset>
            </>}
          </section>
        </div>
        <section className="prep-generation">
          <div>
            <h2>일정 만들기</h2>
            <p id="tw-generation-note" role="status">{isPreview ? '예시 여행방이에요.' : entry?.member.role !== 'OWNER'
              ? '방장이 일정을 만들면 캔버스에서 함께 편집할 수 있어요.'
              : localGenerationBlocker || sharedGenerationBlocker || generationStart.message
                || (generationStart.busy ? '저장된 조건을 확인하고 있어요.' : '준비 완료한 사람의 취향으로 경로를 만들어요.')}</p>
          </div>
          <PreparationActionButton label={isPreview ? '일정 만들기' : entry?.member.role !== 'OWNER' ? '방장이 시작할 수 있어요' : generationStart.hasCurrentPlan ? '일정 열기' : '새 일정 만들기'} loading={generationStart.busy} loadingLabel="생성 가능 여부 확인 중" disabled={isPreview || status !== 'ready' || !entry || entry.member.role !== 'OWNER' || fatalAccess || generationStart.busy || Boolean(generationCtaBlocker)} onClick={() => { if (entry?.member.role === 'OWNER') void generationStart.start(); }} ariaDescribedBy="tw-generation-note" />
        </section>
      </section>}
    </div>}
    <GenerationLoadingOverlay open={generationStart.overlayOpen} phase={generationStart.phase} error={generationStart.error} message={generationStart.message || undefined} onRetry={generationStart.retryAction} onReturn={generationStart.returnAction} />
  </main>;
}
