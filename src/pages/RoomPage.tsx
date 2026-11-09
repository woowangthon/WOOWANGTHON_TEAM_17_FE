import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncState from '../components/ui/AsyncState';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import Input from '../components/ui/Input';
import { useSharedPreparation } from '../features/room/useSharedPreparation';
import { canonicalPersonalDraft, sameReviewedVersion } from '../features/room/personalApi';
import { usePersonalPreferences } from '../features/room/usePersonalPreferences';
import { PersonalReviewPanel, default as GenerationWorkspace } from '../features/generation/GenerationWorkspace';
import {
  emptyPersonalDraft, emptyRoomDraft, formatDraftBudget, formatDraftDate, formatDraftPeople,
  formatDraftTransport, loadRoomEntry, personalDraftComplete, previewPersonalDraft,
  validateRoomDraft, type PersonalDraft, type RoomDraft, type RoomEntry,
} from '../features/room/roomData';

const isPreview = new URLSearchParams(window.location.search).get('preview') === 'room';
const previewEntry: RoomEntry = {
  trip: { id: 'preview-room', name: '단양 주말 여행', status: 'OPEN', inviteCode: 'CB-DEMO' },
  member: { id: 'preview-member', nickname: '여행자 A', role: 'OWNER', status: 'ACTIVE' },
  alreadyJoined: false,
};
const previewConditions: RoomDraft = {
  ...emptyRoomDraft, region: '충북 단양', startDate: '2026-11-14', endDate: '2026-11-15',
  expectedPeople: '3', budget: '600000', transport: 'car', departure: '청주역',
  returnRoute: '청주역', lodging: '1박 필요', fixedSchedule: '둘째 날 18:00까지 청주역 복귀',
};
const blankPersonal: PersonalDraft = { ...emptyPersonalDraft };
const returnHref = '/';
type Section = 'preparation' | 'personal' | 'generation';

function ConditionValue({ value, placeholder }: { value: string; placeholder: string }) {
  return (
    <dd style={value ? undefined : { color: 'var(--color-muted)', fontWeight: 400 }}>
      {value || placeholder}
    </dd>
  );
}

export default function RoomPage() {
  const tripId = new URLSearchParams(window.location.search).get('tripId');
  const [entry, setEntry] = useState<RoomEntry | null>(isPreview ? previewEntry : null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(isPreview ? 'ready' : tripId ? 'loading' : 'error');
  const [privateAccessLost, setPrivateAccessLost] = useState(false);
  const [errorMessage, setErrorMessage] = useState('여행방 주소가 없어요. 시작 화면에서 방을 만들거나 초대 코드로 참여해 주세요.');
  const [section, setSection] = useState<Section>('preparation');
  const [appliedConditions, setAppliedConditions] = useState<RoomDraft>(isPreview ? previewConditions : { ...emptyRoomDraft });
  const [conditionForm, setConditionForm] = useState<RoomDraft>(isPreview ? previewConditions : { ...emptyRoomDraft });
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [conditionErrors, setConditionErrors] = useState<Partial<Record<keyof RoomDraft, string>>>({});
  const [conditionMessage, setConditionMessage] = useState('');
  const [conditionEditVersion, setConditionEditVersion] = useState<number | null>(null);
  const [rebaseRequired, setRebaseRequired] = useState(false);
  const [rebaseAccepted, setRebaseAccepted] = useState(false);
  const [rebaseVersion, setRebaseVersion] = useState<number | null>(null);
  const shared = useSharedPreparation(tripId, entry, Boolean(!isPreview && status === 'ready' && entry));
  const personalFlow = usePersonalPreferences(tripId, Boolean(!isPreview && status === 'ready' && entry && shared.state !== 'fatal' && !privateAccessLost));
  const sharedVersionRef = useRef<number | null>(null);
  const [previewPersonal, setPreviewPersonal] = useState<PersonalDraft>(isPreview ? { ...previewPersonalDraft } : { ...blankPersonal });
  const [personalOpen, setPersonalOpen] = useState(false);
  const [personalForm, setPersonalForm] = useState<PersonalDraft>(isPreview ? { ...previewPersonalDraft } : { ...blankPersonal });
  const [confirmed, setConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const lastLoadedPersonalRef = useRef(JSON.stringify(blankPersonal));
  const [copyMessage, setCopyMessage] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef(0);
  const personalEditEpoch = useRef(0);
  const code = entry?.trip.inviteCode;
  const personal = (isPreview ? previewPersonal : personalFlow.record?.draft ?? blankPersonal) as PersonalDraft;
  const personalComplete = personalDraftComplete(isPreview ? personal : personalForm);
  const personalConfirmed = isPreview ? confirmed : personalFlow.record?.confirmation.status === 'confirmed' && JSON.stringify(canonicalPersonalDraft(personalForm)) === JSON.stringify(canonicalPersonalDraft(personalFlow.record.draft));
  const fieldErrors = { ...shared.saveFieldErrors, ...conditionErrors };
  const fieldErrorSignature = Object.entries(fieldErrors).filter(([, message]) => Boolean(message)).map(([key, message]) => `${key}:${message}`).join('\n');
  const serverOwnMember = shared.preparation?.members.find((member) => member.id === shared.preparation?.currentMember.id);
  const ownSharedConfirmed = isPreview ? confirmed : serverOwnMember?.preparationStatus === 'confirmed';
  const fatalAccess = status === 'ready' && Boolean(entry) && !isPreview && (shared.state === 'fatal' || personalFlow.fatal || privateAccessLost);
  const hideRoomDetails = status !== 'ready' || (!isPreview && shared.state !== 'ready');

  useEffect(() => {
    if (!shared.preparation || isPreview) return;
    const nextVersion = shared.preparation.conditionsVersion;
    if (sharedVersionRef.current === null) {
      sharedVersionRef.current = nextVersion;
      setAppliedConditions(shared.conditions ?? { ...emptyRoomDraft });
      return;
    }
    if (sharedVersionRef.current !== nextVersion) {
      sharedVersionRef.current = nextVersion;
      setAppliedConditions(shared.conditions ?? { ...emptyRoomDraft });
      setReviewed(false); setConfirmed(false);
      setConditionMessage('공통 조건이 변경되어 개인 조건을 다시 확인해야 해요. 개인 입력 원문은 그대로 보관돼요.');
      void personalFlow.refresh();
    }
  }, [personalFlow.refresh, shared.preparation, shared.conditions]);

  useEffect(() => {
    if (!personalFlow.record) return;
    const next = personalFlow.record.draft as PersonalDraft;
    const previous = lastLoadedPersonalRef.current;
    setPersonalForm((current) => JSON.stringify(current) === previous ? next : current);
    lastLoadedPersonalRef.current = JSON.stringify(next);
  }, [personalFlow.record]);

  useEffect(() => {
    lastLoadedPersonalRef.current = JSON.stringify(blankPersonal);
    setPersonalForm({ ...blankPersonal }); setReviewed(false); setConfirmed(false);
  }, [tripId]);

  useEffect(() => {
    // Errors remain visible until an explicit retry; never spin a loading/error loop.
  }, [section]);

  useEffect(() => { setPrivateAccessLost(false); }, [tripId]);
  const onPrivateAccessLost = useCallback(() => setPrivateAccessLost(true), []);

  useEffect(() => {
    if (!conditionsOpen) return;
    const first = (fieldErrorSignature ? fieldErrorSignature.split('\n')[0]?.split(':')[0] : undefined) as keyof RoomDraft | undefined;
    if (!first) return;
    const inputId: Partial<Record<keyof RoomDraft, string>> = { startDate: 'start-date', endDate: 'end-date', expectedPeople: 'people', returnRoute: 'return-route', fixedSchedule: 'fixed-schedule' };
    document.getElementById(inputId[first] ?? first)?.focus();
  }, [fieldErrorSignature, conditionsOpen]);

  useEffect(() => {
    if (fatalAccess || status === 'error') {
      // Clear modal state after access is lost so it cannot reopen if this page recovers.
      // oxlint-disable react(set-state-in-effect)
      // eslint-disable-next-line react/set-state-in-effect -- Close private modal state when the room session becomes inaccessible.
      setConditionsOpen(false); setPersonalOpen(false); setPersonalForm({ ...blankPersonal }); setReviewed(false); setConfirmed(false);
      // oxlint-enable react(set-state-in-effect)
    }
  }, [fatalAccess, status]);

  useEffect(() => {
    if (isPreview) return;
    if (!tripId) return;
    const requestId = ++requestRef.current;
    let active = true;
    loadRoomEntry(tripId).then((result) => {
      if (active && requestRef.current === requestId) { setEntry(result); setStatus('ready'); }
    }).catch((error: unknown) => {
      if (active && requestRef.current === requestId) {
        setErrorMessage(error instanceof Error ? error.message : '여행방 정보를 불러오지 못했어요.');
        setStatus('error');
      }
    });
    return () => { active = false; };
  }, [tripId]);

  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [section]);

  function retry() {
    if (!tripId || isPreview || status === 'loading') return;
    const requestId = ++requestRef.current;
    setStatus('loading'); setErrorMessage('');
    loadRoomEntry(tripId).then((result) => {
      if (requestRef.current === requestId) { setEntry(result); setStatus('ready'); }
    }).catch((error: unknown) => {
      if (requestRef.current === requestId) { setErrorMessage(error instanceof Error ? error.message : '여행방 정보를 불러오지 못했어요.'); setStatus('error'); }
    });
  }

  async function copyCode() {
    if (!code) return;
    setCopyMessage(''); setCopyFailed(false); setCopied(false);
    try { await navigator.clipboard.writeText(code); setCopyMessage('초대 코드를 복사했어요.'); setCopied(true); }
    catch { setCopyMessage('자동 복사가 되지 않았어요. 코드를 선택해 직접 복사해 주세요.'); setCopyFailed(true); codeRef.current?.focus(); }
  }

  async function saveConditions() {
    if (shared.saving) return;
    const errors = validateRoomDraft(conditionForm);
    setConditionErrors(errors);
    if (Object.keys(errors).length) return;
    if (isPreview) {
      setAppliedConditions({ ...conditionForm });
      setConditionsOpen(false);
      setReviewed(false); setConfirmed(false);
      setConditionMessage('미리보기 조건을 이 화면에 반영했어요.');
      return;
    }
    if (!shared.preparation?.canEditConditions || conditionEditVersion === null) return;
    if (rebaseRequired && !rebaseAccepted) {
      setConditionErrors({});
      document.getElementById('room-rebase-accept')?.focus();
      return;
    }
    const result = await shared.save(conditionForm, conditionEditVersion);
    if (result === 'saved') {
      setConditionsOpen(false);
      setRebaseRequired(false); setRebaseAccepted(false);
      setReviewed(false); setConfirmed(false);
      setConditionMessage('공통 조건을 저장했어요. 모두가 새 조건을 확인해야 해요.');
      return;
    }
    if (result === 'conflict' || result === 'failed') {
      setRebaseRequired(true); setRebaseAccepted(false); setRebaseVersion(null);
      const latest = await shared.refresh();
      if (latest) { setRebaseVersion(latest.conditionsVersion); setConditionMessage('최신 공통 조건을 불러왔어요. 내 입력과 비교한 뒤 다시 적용해 주세요.'); }
      return;
    }
    if (result === 'fatal') setConditionsOpen(false);
  }

  async function savePersonal() {
    if (isPreview) setPreviewPersonal({ ...personalForm });
    else {
      const saved = await personalFlow.save(personalForm);
      if (!saved) { setConditionMessage(personalFlow.message || '저장하지 못했어요. 입력은 보관했어요.'); return; }
      const latestShared = await shared.refresh();
      const latestPersonal = await personalFlow.refresh();
      if (!latestShared || !latestPersonal || latestShared.conditionsVersion !== latestPersonal.conditionsVersion) {
        setConditionMessage('최신 공통 조건과 개인 조건 버전을 맞추지 못했어요. 입력은 보존했으니 최신 상태를 확인하고 다시 시도해 주세요.'); return;
      }
    }
    setPersonalOpen(false); setReviewed(false); setConfirmed(false);
    setConditionMessage('내 조건을 저장했어요. 다시 확인한 뒤 직접 확정해 주세요.');
  }

  async function confirmPersonal() {
    if (!personalComplete || !reviewed) return;
    if (isPreview) { setConfirmed(true); setConditionMessage('미리보기에서 조건을 확인했어요. 서버에는 저장되지 않아요.'); return; }
    if (!personalFlow.record || JSON.stringify(canonicalPersonalDraft(personalForm)) !== JSON.stringify(canonicalPersonalDraft(personalFlow.record.draft))) {
      setConditionMessage('확정 전에 변경 내용을 먼저 저장해 주세요.'); return;
    }
    const displayed = personalFlow.record;
    const viewedConditionsVersion = shared.preparation?.conditionsVersion;
    const editEpoch = personalEditEpoch.current;
    const latestShared = await shared.refresh();
    const latestPersonal = await personalFlow.refresh();
    if (!latestShared || !latestPersonal || viewedConditionsVersion !== displayed.conditionsVersion
        || !sameReviewedVersion(displayed, latestPersonal, latestShared.conditionsVersion)
        || editEpoch !== personalEditEpoch.current) {
      setReviewed(false);
      setConditionMessage('최신 공통 조건이나 개인 입력이 달라졌어요. 입력은 보존했으니 다시 저장하고 확인해 주세요.'); return;
    }
    if (await personalFlow.confirm(displayed)) setConditionMessage('내 조건을 서버에 확정했어요. 원문은 다른 참여자에게 공유되지 않아요.');
    else setConditionMessage(personalFlow.message || '확정하지 못했어요. 최신 조건을 다시 확인해 주세요.');
  }

  function updateCondition<K extends keyof RoomDraft>(key: K, value: RoomDraft[K]) {
    setConditionForm((current) => ({ ...current, [key]: value }));
    setConditionErrors((current) => ({ ...current, [key]: undefined, ...(key === 'startDate' || key === 'endDate' ? { startDate: undefined, endDate: undefined } : {}) }));
  }

  function updatePersonal<K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) {
    personalEditEpoch.current += 1;
    if (!isPreview) personalFlow.invalidateProposal();
    setPersonalForm((current) => ({ ...current, [key]: value }));
    if (isPreview) setPreviewPersonal((current) => ({ ...current, [key]: value }));
    setReviewed(false); setConfirmed(false);
    setConditionMessage('내 조건이 바뀌었어요. 다시 확인한 뒤 확정해 주세요.');
  }

  function openConditions() { setConditionForm({ ...appliedConditions }); setConditionErrors({}); shared.clearSaveFieldErrors(); setRebaseRequired(false); setRebaseAccepted(false); setRebaseVersion(null); setConditionEditVersion(shared.preparation?.conditionsVersion ?? null); shared.setSaveMessage(''); setConditionsOpen(true); }
  function openPersonal() { setPersonalOpen(true); }
  const sidebar = <aside className="room-sidebar">
    <p className="room-sidebar-label">여행 워크스페이스</p>
    <nav className="room-nav" aria-label="여행방 메뉴">
      <button type="button" className={section === 'preparation' ? 'is-selected' : ''} aria-current={section === 'preparation' ? 'page' : undefined} onClick={() => setSection('preparation')}><span aria-hidden="true">□</span> 여행 준비</button>
      <button type="button" className={section === 'personal' ? 'is-selected' : ''} aria-current={section === 'personal' ? 'page' : undefined} onClick={() => setSection('personal')}><span aria-hidden="true">□</span> 내 취향·제약</button>
      <button type="button" className={section === 'generation' ? 'is-selected' : ''} aria-current={section === 'generation' ? 'page' : undefined} onClick={() => setSection('generation')}><span aria-hidden="true">□</span> 여행 일정</button>
      <span className="room-nav-disabled" aria-disabled="true"><span aria-hidden="true">□</span> 변경 이력 <small>준비 중</small></span>
    </nav>
    <section className="room-people"><h2>함께하는 사람</h2>
      {(isPreview ? [{ id: entry?.member.id ?? '', nickname: entry?.member.nickname ?? '나', role: entry?.member.role ?? 'MEMBER', preparationStatus: 'writing' as const }, { id: 'preview-b', nickname: '여행자 B', role: 'MEMBER' as const, preparationStatus: 'writing' as const }, { id: 'preview-c', nickname: '여행자 C', role: 'MEMBER' as const, preparationStatus: 'confirmed' as const }] : shared.preparation?.members ?? []).map((member) => <div className="room-person" key={member.id}><span className={`room-person-dot ${member.preparationStatus === 'writing' ? 'is-pending' : ''}`} /><span>{member.nickname} <small>{member.id === entry?.member.id ? `나${member.role === 'OWNER' ? ' · 방장' : ''}` : member.role === 'OWNER' ? '방장' : ''}</small></span><span className="room-person-state">{isPreview && member.id === entry?.member.id ? '나' : member.preparationStatus === 'confirmed' ? '확정 완료' : '작성중'}</span></div>)}
      {!isPreview && shared.state === 'ready' && <p className="room-people-note">현재 참여 중인 {shared.preparation?.activeMemberCount ?? 0}명 · 개인 원문과 취향은 공유하지 않아요.</p>}
    </section>
    <section className="room-privacy"><strong>개인 입력은 나만 확인</strong><p>공통 화면에는 준비 상태와 종합 조건만 표시해요.</p></section>
    <a className="room-back" href={returnHref}>← 여행 시작으로</a>
  </aside>;

  return <main className="room-app">
    <header className="room-topbar"><a href={returnHref} className="room-brand">충북 여행 계획</a>
      <div className="room-top-meta"><span>{hideRoomDetails ? '여행 준비' : `내 여행 / ${entry?.trip.name ?? '여행방'}`}</span>{!hideRoomDetails && <strong>{appliedConditions.startDate && appliedConditions.endDate ? formatDraftDate(appliedConditions.startDate, appliedConditions.endDate) : '여행 날짜 미정'} · {formatDraftPeople(appliedConditions.expectedPeople)} · {appliedConditions.region || '충북 지역 미정'}</strong>}</div>
      <div className="room-top-actions">{entry && !hideRoomDetails && <div className="room-share-actions"><code ref={codeRef} tabIndex={copyFailed ? 0 : -1} aria-label="여행방 초대 코드">{entry.trip.inviteCode}</code><Button variant="secondary" onClick={copyCode}>{copied ? '복사 완료' : '초대 코드 복사'}</Button><span className={copyFailed ? 'room-copy-status is-error' : 'room-copy-status'} role="status" aria-live="polite">{copyMessage}</span></div>}{entry && !hideRoomDetails && <span className="room-top-user"><i aria-hidden="true">{entry.member.nickname.slice(0, 1)}</i>{entry.member.nickname}</span>}</div>
    </header>
    {isPreview && <p className="room-preview-banner" role="status">화면 미리보기 · 예시 데이터예요. 실제 여행방 정보와 다르며 서버에 저장되지 않아요.</p>}
    {status === 'ready' && !fatalAccess && <p className="room-memory-note">저장한 개인 원문과 취향은 본인 전용이며 새로고침 후에도 다시 불러와요.</p>}
    {status === 'loading' && <section className="room-state-card"><AsyncState status="loading" title="여행방을 확인하고 있어요" description="잠시만 기다려 주세요." /></section>}
    {status === 'error' && <section className="room-state-card">{tripId ? <AsyncState status="error" title="여행방에 들어오지 못했어요" description={errorMessage} onRetry={retry} /> : <div className="async-state async-state-error" role="alert"><h3>여행방 주소를 확인할 수 없어요</h3><p>{errorMessage}</p></div>}<a className="room-return-link" href={returnHref}>시작 화면으로 돌아가기</a></section>}
    {status === 'ready' && entry && !isPreview && shared.state === 'loading' && <section className="room-state-card"><AsyncState status="loading" title="공통 여행 조건과 준비 상태를 불러오고 있어요" description="참여자에게 공유된 정보만 확인하고 있어요." /></section>}
    {status === 'ready' && entry && !isPreview && shared.state === 'error' && <section className="room-state-card"><AsyncState status="error" title="여행 준비 정보를 불러오지 못했어요" description={shared.message} onRetry={() => void shared.refresh()} /><a className="room-return-link" href={returnHref}>여행 시작으로 돌아가기</a></section>}
    {status === 'ready' && entry && !isPreview && shared.state === 'fatal' && <section className="room-state-card"><div className="async-state async-state-error" role="alert"><h3>여행방에 계속 접근할 수 없어요</h3><p>{shared.message || '참여 권한이나 여행방 상태가 바뀌었어요. 다시 참여해 주세요.'}</p></div><a className="room-return-link" href={returnHref}>여행 시작으로 돌아가기</a></section>}
    {status === 'ready' && entry && !isPreview && fatalAccess && shared.state !== 'fatal' && <section className="room-state-card"><div className="async-state async-state-error" role="alert"><h3>여행방에 계속 접근할 수 없어요</h3><p>{personalFlow.message || '참여 권한이나 여행방 상태가 바뀌었어요. 다시 참여해 주세요.'}</p></div><a className="room-return-link" href={returnHref}>여행 시작으로 돌아가기</a></section>}
    {status === 'ready' && entry && (isPreview || shared.state === 'ready') && !fatalAccess && <div className="room-layout">
      {sidebar}
      <section className="room-workspace">
        {section === 'preparation' ? <>
          <div className="room-preparation-heading"><div><p className="room-eyebrow">01 PREPARE</p><h1 ref={headingRef} tabIndex={-1}>함께 준비하는 {appliedConditions.region ? `${appliedConditions.region} ` : ''}여행</h1><p className="room-lead">각자의 조건을 확인하면, 모두에게 맞는 일정을 만들 수 있어요.</p></div>{!isPreview && <div className="room-refresh-controls"><Button variant="secondary" onClick={() => void shared.refresh()} disabled={shared.refreshing}>{shared.refreshing ? '새로 고치는 중…' : '준비 상태 새로고침'}</Button><small>{shared.lastUpdated ? `마지막 확인 ${new Date(shared.lastUpdated).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : ''}</small>{shared.message && <small className="is-error" role="status">{shared.message}</small>}</div>}</div>
          <section className="room-next-step"><div><p className="room-eyebrow">다음 할 일</p><h2>{isPreview ? (personalComplete ? confirmed ? '모두 함께 준비해요' : '내 취향을 확인해 주세요' : '내 취향을 먼저 적어 주세요') : ownSharedConfirmed ? '내 준비 상태를 확인했어요' : '내 준비 상태를 확인해 주세요'}</h2><p>{isPreview ? (confirmed ? '내 조건을 확인했어요. 다음 준비를 기다려 주세요.' : '내가 정리한 여행 조건을 확인하면 내 준비 상태에 반영돼요.') : ownSharedConfirmed ? '공유된 준비 상태에 확인 완료로 표시돼요.' : '내 취향 초안은 나만 볼 수 있어요. 준비 상태는 서버에서 확인해요.'}</p></div><Button onClick={() => setSection('personal')}>{ownSharedConfirmed ? '내 조건 보기' : '내 조건 확인하기'}</Button></section>
          <section className="room-invite-card" aria-labelledby="invite-title"><div><p className="room-eyebrow">친구들과 함께해요</p><h2 id="invite-title">초대 코드</h2><p>친구에게 상단의 초대 코드를 알려주면 여행방에 참여할 수 있어요.</p></div><code aria-label="여행방 초대 코드">{entry.trip.inviteCode}</code></section>
          <div className="room-dashboard-grid">
            <section className="room-card room-shared-conditions"><div className="room-card-head"><div><h2>여행의 기본 조건</h2><p>{isPreview ? '미리보기 예시 조건이에요.' : '참여자 모두가 서버에서 함께 보는 조건이에요. 변경하면 모두 다시 확인해야 해요.'}</p></div>{(isPreview || shared.preparation?.canEditConditions) ? <Button variant="secondary" onClick={openConditions}>수정</Button> : <span className="room-readonly-label">방장만 수정할 수 있어요</span>}</div>
              <dl className="room-condition-grid">
                <div><dt>여행 지역</dt><ConditionValue value={appliedConditions.region} placeholder="여행지를 선택해 주세요" /></div>
                <div><dt>여행 기간</dt><ConditionValue value={appliedConditions.startDate && appliedConditions.endDate ? formatDraftDate(appliedConditions.startDate, appliedConditions.endDate) : ''} placeholder="여행 날짜를 선택해 주세요" /></div>
                <div><dt>전체 인원</dt><ConditionValue value={appliedConditions.expectedPeople ? formatDraftPeople(appliedConditions.expectedPeople) : ''} placeholder="인원을 설정해 주세요" /></div>
                <div><dt>이동수단</dt><ConditionValue value={appliedConditions.transport === 'undecided' ? '' : formatDraftTransport(appliedConditions.transport)} placeholder="이동수단을 선택해 주세요" /></div>
                <div><dt>출발지</dt><ConditionValue value={appliedConditions.departure} placeholder="출발지를 입력해 주세요" /></div>
                <div><dt>복귀 장소</dt><ConditionValue value={appliedConditions.returnRoute} placeholder="복귀 장소를 입력해 주세요" /></div>
                <div><dt>숙박</dt><ConditionValue value={appliedConditions.lodging} placeholder="숙박 계획을 입력해 주세요" /></div>
                <div className="room-fixed"><dt>고정 일정</dt><ConditionValue value={appliedConditions.fixedSchedule} placeholder="추가된 일정 없음" /></div>
              </dl>
              <p className="room-local-draft">{isPreview ? '미리보기 예시 데이터예요.' : `공유 조건 버전 ${shared.preparation?.conditionsVersion ?? '—'} · 방장이 관리해요. 개인 입력은 공유되지 않아요.`}</p>
            </section>
            <div className="room-side-cards">
              <section className="room-card room-readiness"><h2>준비 상태</h2><p>{isPreview ? '미리보기 예시예요.' : `현재 참여 중인 ${shared.preparation?.activeMemberCount ?? 0}명 · 공통 조건 확인 상태`}</p>{(isPreview ? [{ id: entry.member.id, nickname: entry.member.nickname, role: entry.member.role, preparationStatus: 'writing' as const }, { id: 'preview-b', nickname: '여행자 B', role: 'MEMBER' as const, preparationStatus: 'writing' as const }, { id: 'preview-c', nickname: '여행자 C', role: 'MEMBER' as const, preparationStatus: 'confirmed' as const }] : shared.preparation?.members ?? []).map((member) => <div className="room-readiness-person" key={member.id}><span className="room-person-avatar">{member.nickname.slice(0, 1)}</span><span>{member.nickname} {member.id === entry.member.id && <small>나</small>}</span><strong className={member.preparationStatus === 'confirmed' ? 'is-confirmed' : 'is-writing'}>{member.preparationStatus === 'confirmed' ? '확정 완료' : '작성중'}</strong></div>)}</section>
              <section className="room-card room-itinerary-ready"><h2>일정 생성 준비</h2><p>모두가 공통 조건을 확인하면 일정을 준비할 수 있어요.</p><ul><li className={shared.preparation?.readiness.conditionsReady ? 'is-done' : ''}>공통 조건 {shared.preparation?.readiness.conditionsReady ? '입력 완료' : '확인 필요'}</li>{(shared.preparation?.readiness.reasons ?? []).map((reason, index) => <li key={`${reason.code}-${reason.memberId ?? index}`}>{reason.code === 'MEMBER_COUNT_MISMATCH' ? `예정 인원 ${appliedConditions.expectedPeople || '미정'}명 · 현재 참여 ${shared.preparation?.activeMemberCount ?? 0}명` : reason.code === 'PREFERENCES_UNCONFIRMED' ? `${shared.preparation?.members.find((member) => member.id === reason.memberId)?.nickname ?? '참여자'}의 개인 조건 확인 필요` : `공통 조건 확인 필요${reason.fields?.length ? ` · ${reason.fields.map((field) => field === 'startDate' ? '여행 시작일' : field === 'endDate' ? '여행 마지막 날' : field === 'expectedPeople' ? '예정 인원' : field === 'budget' ? '예산' : field === 'transport' ? '이동수단' : field === 'region' ? '여행 지역' : field).join(', ')}` : ''}`}</li>)}</ul><Button onClick={() => setSection('generation')}>일정 준비하기</Button><small id="room-disabled-reason">일정 탭에서 조건 검토와 생성 상태를 확인해 주세요.</small></section>
            </div>
            <section className="room-card room-budget"><div><h2>여행 예산</h2><p>{isPreview ? '전체 인원 기준 예시예요.' : '모두가 공유하는 전체 예산이에요.'}</p></div><strong
                style={!appliedConditions.budget ? {
                  color: 'var(--color-muted)',
                  fontSize: 'clamp(16px, 2vw, 20px)',
                  fontWeight: 400,
                  letterSpacing: 'normal',
                } : undefined}
              >
                {appliedConditions.budget ? formatDraftBudget(appliedConditions.budget) : '예산을 설정해 주세요'}
              </strong>{appliedConditions.expectedPeople && appliedConditions.budget && <p>1인 기준 약 {Math.round(Number(appliedConditions.budget) / Number(appliedConditions.expectedPeople)).toLocaleString('ko-KR')}원</p>}<small>{isPreview ? '미리보기 예시 금액이에요.' : '실제 예약·결제 금액과 다를 수 있어요.'}</small></section>
          </div>
          {conditionMessage && <p className="room-live-message" role="status">{conditionMessage}</p>}
        </> : section === 'personal' ? <>
          <div className="room-personal-title"><div><p className="room-eyebrow">02 PERSONAL PREFERENCES</p><h1 ref={headingRef} tabIndex={-1}>내 여행 취향을 확인해 주세요</h1><p className="room-lead">내가 작성한 내용을 바탕으로 조건을 직접 정리해요. 원문과 조건은 나만 볼 수 있어요.</p></div><span className="room-private-badge">나만 보기</span></div>
          <div className="room-personal-flow">1 자유롭게 입력 ─── 2 조건 확인 · 수정 ─── 3 내 조건 확인</div>
          <div className="room-personal-grid">
            <section className="room-card room-original-card"><h2>내가 작성한 내용</h2><p>원문을 고쳐도 아래 조건을 직접 확인하고 수정해 주세요.</p>{personalForm.originalText ? <pre>{personalForm.originalText}</pre> : <div className="room-empty-original">아직 적은 내용이 없어요.<br />좋아하는 것과 피하고 싶은 점을 적어 보세요.</div>}<p className="room-private-caption">원문과 내 취향은 본인만 볼 수 있어요.</p><Button variant="secondary" onClick={openPersonal}>{personalForm.originalText ? '원문 수정' : '내 취향 적기'}</Button><hr /><h3>개인 입력 공개 범위</h3><p>원문과 개인 조건은 공개하지 않고, 함께 보는 화면에는 준비 여부만 표시해요.</p></section>
            <section className="room-card room-personal-fields"><div className="room-card-head"><div><h2>내가 정리한 여행 조건</h2><p>{isPreview ? '미리보기 예시예요.' : '저장 후 AI 해석을 요청하고 결과를 따로 검토할 수 있어요.'}</p></div><span className={personalComplete ? 'room-status-badge is-ready' : 'room-status-badge'}>{personalConfirmed ? '확정 완료' : personalComplete ? '확인 필요' : '입력 필요'}</span></div>
              <div className="room-personal-field"><label htmlFor="likes-field">좋아하는 활동</label><input id="likes-field" className="text-input" maxLength={500} value={personalForm.likes} placeholder="예: 자연 풍경, 조용한 카페" onChange={(event) => updatePersonal('likes', event.target.value)} /></div>
              <div className="room-personal-field"><label htmlFor="avoid-field">피하고 싶은 요소</label><div className="room-inline-fields"><input id="avoid-field" className="text-input" maxLength={500} value={personalForm.avoid} placeholder="예: 긴 도보 이동" onChange={(event) => updatePersonal('avoid', event.target.value)} /><select className="text-input" aria-label="피하고 싶은 요소 중요도" value={personalForm.avoidImportance} onChange={(event) => updatePersonal('avoidImportance', event.target.value as PersonalDraft['avoidImportance'])}><option value="required">꼭 필요한 조건</option><option value="preferred">선호 사항</option></select></div></div>
              <div className="room-personal-field"><label htmlFor="food-field">음식 취향</label><div className="room-inline-fields"><input id="food-field" className="text-input" maxLength={500} value={personalForm.food} placeholder="예: 맵지 않은 음식" onChange={(event) => updatePersonal('food', event.target.value)} /><select className="text-input" aria-label="음식 취향 중요도" value={personalForm.foodImportance} onChange={(event) => updatePersonal('foodImportance', event.target.value as PersonalDraft['foodImportance'])}><option value="required">꼭 필요한 조건</option><option value="preferred">선호 사항</option></select></div></div>
              <fieldset className="room-walking"><legend>한 번에 어느 정도까지 걷기 편한가요?</legend><div>{([['20', '20분 이내'], ['40', '40분 이내'], ['unlimited', '시간 제한 없음']] as const).map(([value, label]) => <button type="button" key={value} className={personalForm.walking === value ? 'is-selected' : ''} aria-pressed={personalForm.walking === value} onClick={() => updatePersonal('walking', value)}>{label}</button>)}</div></fieldset>
              {isPreview && <p className="room-preview-data-note">미리보기 예시 데이터예요. 실제 참여자의 원문이나 취향이 아니에요.</p>}
            </section>
          </div>
          {!isPreview && <div className="personal-ai-actions"><Button variant="secondary" disabled={personalFlow.busy} onClick={() => void savePersonal()}>내 조건 저장</Button><Button variant="secondary" disabled={personalFlow.busy || !personalForm.originalText.trim()} onClick={async () => { const saved = await personalFlow.save(personalForm); if (!saved) return; const latestShared = await shared.refresh(); const fresh = await personalFlow.refresh(); if (!fresh || !latestShared || fresh.conditionsVersion !== latestShared.conditionsVersion) { setConditionMessage('최신 조건이 바뀌었어요. 내용을 보존했으니 조건을 다시 확인해 주세요.'); return; } await personalFlow.interpret(fresh); }}>{personalFlow.busy ? '저장 중…' : '저장 후 AI 해석 요청'}</Button><small>제안은 자동 반영되지 않아요. 검토 후 직접 반영해야 해요.</small></div>}
          {personalFlow.proposal && <section className="room-card proposal-review"><h2>AI 해석 제안 검토</h2><p>제안은 저장되거나 확정되지 않았어요. 아래 내용을 확인한 뒤 내 입력에 반영하고 별도로 저장해 주세요.</p>{personalFlow.proposal.needsWalkingAnswer && <p role="status">걷기 조건은 직접 선택해 주세요.</p>}<dl className="proposal-values">{(['likes','avoid','avoidImportance','food','foodImportance','walking'] as const).map((field) => <div key={field}><dt>{field === 'likes' ? '좋아하는 활동' : field === 'avoid' ? '피하고 싶은 요소' : field === 'avoidImportance' ? '피하고 싶은 요소 중요도' : field === 'food' ? '음식 취향' : field === 'foodImportance' ? '음식 중요도' : '걷기'}</dt><dd>{personalFlow.proposal?.suggestions[field] || '제안 없음'}</dd></div>)}</dl><Button onClick={() => { const suggestion = personalFlow.proposal?.suggestions; if (!suggestion || !personalFlow.record) return; if (personalFlow.proposal?.sourceConditionsVersion !== personalFlow.record.conditionsVersion || personalFlow.proposal?.sourcePreferenceVersion !== personalFlow.record.preferenceVersion || JSON.stringify(canonicalPersonalDraft(personalForm)) !== JSON.stringify(canonicalPersonalDraft(personalFlow.record.draft))) { personalFlow.clearProposal(); setConditionMessage('입력 내용이 바뀌었어요. 현재 내용을 저장한 뒤 다시 해석해 주세요.'); return; } const walking = suggestion.walking && ['20', '40', 'unlimited'].includes(suggestion.walking) ? suggestion.walking as PersonalDraft['walking'] : ''; setPersonalForm((current) => ({ ...current, likes: suggestion.likes ?? '', avoid: suggestion.avoid ?? '', avoidImportance: suggestion.avoidImportance, food: suggestion.food ?? '', foodImportance: suggestion.foodImportance, walking })); personalFlow.clearProposal(); setReviewed(false); }}>제안을 내 입력에 반영</Button></section>}
          {!isPreview && <PersonalReviewPanel key={`${personalFlow.record?.preferenceVersion}-${personalFlow.record?.confirmation.status}`} tripId={tripId!} conditionsVersion={shared.preparation?.conditionsVersion ?? 0} onAccessLost={onPrivateAccessLost} />}
          <section className="room-confirm-bar"><label><input type="checkbox" checked={reviewed} onChange={(event) => { personalEditEpoch.current += 1; setReviewed(event.target.checked); if (!event.target.checked) setConditionMessage('확인 상태를 해제했어요. 내용을 다시 확인해 주세요.'); }} /> 내 조건과 추가 답변을 확인했어요.</label><Button variant="secondary" onClick={() => setSection('preparation')}>나중에 확인</Button><Button onClick={() => void confirmPersonal()} disabled={!personalComplete || !reviewed || (!isPreview && personalFlow.busy)}>{personalConfirmed ? '확정 완료' : '내 조건 확정하기'}</Button></section>
          {!personalComplete && <p className="room-confirm-hint">좋아하는 활동, 걷기 정도, 나만 보는 원문을 적으면 조건을 확인할 수 있어요.</p>}
          {conditionMessage && <p className="room-live-message" role="status">{conditionMessage}</p>}</> : isPreview ? <section className="generation-card"><h2>일정 화면 미리보기</h2><p>예시 화면이며 실제 일정 API나 지도 서비스를 호출하지 않아요.</p></section> : <GenerationWorkspace tripId={tripId!} conditionsVersion={shared.preparation?.conditionsVersion ?? 0} isOwner={Boolean(entry?.member.role === 'OWNER')} startDate={appliedConditions.startDate} endDate={appliedConditions.endDate} onAccessLost={onPrivateAccessLost} />}
      </section>
    </div>}

    <Dialog open={conditionsOpen && !fatalAccess && status === 'ready' && (isPreview || shared.state === 'ready')} title="여행 기본 조건" onClose={() => { if (!shared.saving) { setConditionsOpen(false); setConditionErrors({}); } }} onConfirm={saveConditions} confirmLabel={shared.saving ? '저장 중…' : isPreview ? '초안 반영' : '공통 조건 저장'} cancelLabel="취소" pending={shared.saving}>
      <form className="room-dialog-form" onSubmit={(event) => { event.preventDefault(); saveConditions(); }}>
        <p className="room-dialog-note">{isPreview ? '미리보기 예시 조건이에요. 서버에 저장되지 않아요.' : shared.preparation?.canEditConditions ? '저장하면 여행방 참여자 모두에게 공유되고, 모두의 확인 상태가 초기화돼요.' : '공통 조건은 방장만 수정할 수 있어요. 현재 조건은 읽기 전용이에요.'}</p>
        {rebaseRequired && <section className="room-condition-conflict" aria-live="polite"><h3>최신 공통 조건과 비교해 주세요</h3><p>{shared.saveMessage}</p><p>현재 서버 버전 {shared.preparation?.conditionsVersion ?? '불러오는 중'} · 내 입력은 보존되어 있어요.</p><dl>{([['region', '여행 지역'], ['startDate', '여행 시작일'], ['endDate', '여행 마지막 날'], ['expectedPeople', '예정 인원'], ['budget', '전체 예산'], ['transport', '이동수단'], ['departure', '출발지'], ['returnRoute', '복귀 장소'], ['lodging', '숙박'], ['fixedSchedule', '고정 일정']] as const).map(([field, label]) => <div key={field}><dt>{label}</dt><dd>현재: {field === 'transport' ? formatDraftTransport(shared.conditions?.transport ?? 'undecided') : shared.conditions?.[field] || '아직 정하지 않았어요'}</dd><dd>내 입력: {field === 'transport' ? formatDraftTransport(conditionForm.transport) : conditionForm[field] || '아직 정하지 않았어요'}</dd></div>)}</dl>{rebaseVersion === null && <Button type="button" variant="secondary" disabled={shared.refreshing} onClick={() => { void shared.refresh().then((latest) => { if (latest) setRebaseVersion(latest.conditionsVersion); }); }}>{shared.refreshing ? '최신 조건 확인 중…' : '최신 공통 조건 새로고침'}</Button>}{!rebaseAccepted ? <Button id="room-rebase-accept" type="button" variant="secondary" disabled={rebaseVersion === null} onClick={() => { if (rebaseVersion !== null) { setConditionEditVersion(rebaseVersion); setRebaseAccepted(true); } }}>최신 조건 확인 후 내 변경 다시 적용</Button> : <p className="room-rebase-accepted">최신 버전 {conditionEditVersion}을 기준으로 다시 적용할 준비가 됐어요. 저장 버튼을 눌러 반영해 주세요.</p>}</section>}
        {shared.saveMessage && !rebaseRequired && <p className="field-error" role="alert">{shared.saveMessage}</p>}
        <fieldset className="room-condition-fields" disabled={shared.saving || (!isPreview && !shared.preparation?.canEditConditions)}><Input id="region" label="여행 지역" maxLength={100} value={conditionForm.region} error={fieldErrors.region} placeholder="예: 충북 단양" onChange={(event) => updateCondition('region', event.target.value)} />
        <div className="room-date-fields"><Input id="start-date" label="여행 시작일" type="date" value={conditionForm.startDate} error={fieldErrors.startDate} onChange={(event) => updateCondition('startDate', event.target.value)} /><Input id="end-date" label="여행 마지막 날" type="date" value={conditionForm.endDate} error={fieldErrors.endDate} onChange={(event) => updateCondition('endDate', event.target.value)} /></div>
        <Input id="people" label="예정 인원" type="number" inputMode="numeric" min="1" max="50" value={conditionForm.expectedPeople} placeholder="예: 4" error={fieldErrors.expectedPeople} onChange={(event) => updateCondition('expectedPeople', event.target.value)} />
        <Input id="budget" label="전체 예산" type="number" inputMode="numeric" min="1" max="1000000000" value={conditionForm.budget} placeholder="예: 500000" hint="아직 정하지 않았다면 비워 둘 수 있어요." error={fieldErrors.budget} onChange={(event) => updateCondition('budget', event.target.value)} />
        <label className="room-select-label" htmlFor="transport">이동수단</label><select id="transport" className="text-input" aria-invalid={fieldErrors.transport ? true : undefined} aria-describedby={fieldErrors.transport ? 'transport-error' : undefined} value={conditionForm.transport} onChange={(event) => updateCondition('transport', event.target.value as RoomDraft['transport'])}><option value="undecided">아직 정하지 않았어요</option><option value="car">자가용</option><option value="transit">대중교통</option><option value="charter">전세버스</option><option value="walk">도보</option></select>{fieldErrors.transport && <p className="field-error" id="transport-error" role="alert">{fieldErrors.transport}</p>}
        <Input id="departure" label="출발지" maxLength={100} value={conditionForm.departure} error={fieldErrors.departure} placeholder="예: 청주역" onChange={(event) => updateCondition('departure', event.target.value)} />
        <Input id="return-route" label="복귀 장소" maxLength={100} value={conditionForm.returnRoute} error={fieldErrors.returnRoute} placeholder="예: 청주역" onChange={(event) => updateCondition('returnRoute', event.target.value)} />
        <Input id="lodging" label="숙박" maxLength={200} value={conditionForm.lodging} error={fieldErrors.lodging} placeholder="예: 1박 필요" onChange={(event) => updateCondition('lodging', event.target.value)} />
        <Input id="fixed-schedule" label="고정 일정" maxLength={500} value={conditionForm.fixedSchedule} error={fieldErrors.fixedSchedule} placeholder="예: 둘째 날 오후 6시까지 복귀" onChange={(event) => updateCondition('fixedSchedule', event.target.value)} /></fieldset>
      </form>
    </Dialog>

    <Dialog open={personalOpen && !fatalAccess && status === 'ready' && (isPreview || shared.state === 'ready')} title="내 취향과 여행 원문" onClose={() => setPersonalOpen(false)} onConfirm={savePersonal} confirmLabel={isPreview ? "내 화면에 반영" : "내 조건 저장"} cancelLabel="취소">
      <div className="room-dialog-form"><p className="room-dialog-note">{isPreview ? '미리보기에서는 입력이 서버에 전송되지 않아요.' : '원문은 본인 전용으로 서버에 저장돼요. 다른 참여자에게 공개되지 않아요.'}</p><label className="room-select-label" htmlFor="original-text">좋아하는 것, 피하고 싶은 점, 음식 취향을 자유롭게 적어 주세요.</label><textarea id="original-text" maxLength={5000} className="text-input room-original-input" value={personalForm.originalText} onChange={(event) => { updatePersonal('originalText', event.target.value); }} placeholder="예: 자연을 보고 조용히 쉬고 싶어요. 오래 걷는 건 어려워요." /><p className="field-help">AI 제안은 자동 반영되지 않아요. 제안을 검토해 직접 적용한 뒤 별도로 저장해 주세요.</p></div>
    </Dialog>
  </main>;
}
