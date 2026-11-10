import { useEffect, useRef, useState } from 'react';
import AsyncState from '../components/ui/AsyncState';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import CanvasPreview from '../features/workspace/CanvasPreview';
import { usePersonalPreparation } from '../features/personal/usePersonalPreparation';
import { useSharedPreparation } from '../features/room/useSharedPreparation';
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

export default function RoomPage() {
  const query = new URLSearchParams(window.location.search);
  const tripId = query.get('tripId');
  const [entry, setEntry] = useState<RoomEntry | null>(isPreview ? previewEntry : null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(isPreview ? 'ready' : tripId ? 'loading' : 'error');
  const [errorMessage, setErrorMessage] = useState('여행방 주소가 없어요. 시작 화면에서 방을 만들거나 초대 코드로 참여해 주세요.');
  const [view, setView] = useState<View>(query.get('view') === 'canvas' ? 'canvas' : 'preparation');
  const [conditions, setConditions] = useState<RoomDraft>(isPreview ? previewConditions : { ...emptyRoomDraft });
  const [conditionForm, setConditionForm] = useState<RoomDraft>(isPreview ? previewConditions : { ...emptyRoomDraft });
  const [conditionDirty, setConditionDirty] = useState(false);
  const [conditionErrors, setConditionErrors] = useState<Partial<Record<keyof RoomDraft, string>>>({});
  const [conditionMessage, setConditionMessage] = useState('');
  const [editVersion, setEditVersion] = useState<number | null>(null);
  const [rebaseRequired, setRebaseRequired] = useState(false);
  const [rebaseAccepted, setRebaseAccepted] = useState(false);
  const [rebaseVersion, setRebaseVersion] = useState<number | null>(null);
  const [previewPersonal, setPreviewPersonal] = useState<PersonalDraft>({ ...previewPersonalDraft });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const navCloseRef = useRef<HTMLButtonElement>(null);
  const navPanelRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [localPersonalMessage, setLocalPersonalMessage] = useState('');
  const requestRef = useRef(0);
  const shared = useSharedPreparation(tripId, entry, Boolean(!isPreview && status === 'ready' && entry));
  const fatalAccess = status === 'ready' && Boolean(entry) && !isPreview && shared.state === 'fatal';
  const personalHook = usePersonalPreparation({ tripId, enabled: Boolean(!isPreview && status === 'ready' && entry && shared.state === 'ready' && !fatalAccess), conditionsVersion: shared.preparation?.conditionsVersion ?? 0, onSaved: () => { void shared.refreshAfterPersonalMutation(); } });

  useEffect(() => {
    if (!mobileNavOpen) return;
    navCloseRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
        navToggleRef.current?.focus();
      }
    }
    function closeOnOutside(event: PointerEvent) {
      if (event.target instanceof Node && !navPanelRef.current?.contains(event.target) && !navToggleRef.current?.contains(event.target)) setMobileNavOpen(false);
    }
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutside);
    return () => { document.removeEventListener('keydown', closeOnEscape); document.removeEventListener('pointerdown', closeOnOutside); };
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
    personalHook.setReviewed(false);
    setConditionForm((current) => ({ ...current, [key]: value }));
    setConditionErrors((current) => ({ ...current, [key]: undefined, ...(key === 'startDate' || key === 'endDate' ? { startDate: undefined, endDate: undefined } : {}) }));
  }
  async function saveConditions() {
    if (shared.saving) return;
    const errors = validateRoomDraft(conditionForm);
    setConditionErrors(errors);
    if (Object.keys(errors).length) return;
    if (isPreview) { setConditions({ ...conditionForm }); setConditionDirty(false); setConditionMessage('예시 조건을 이 화면에 반영했어요.'); return; }
    if (!shared.preparation?.canEditConditions || editVersion === null) return;
    if (rebaseRequired && !rebaseAccepted) { document.getElementById('room-rebase-accept')?.focus(); return; }
    const result = await shared.save(withPreservedHiddenConditions(conditionForm, shared.conditions), editVersion);
    if (result === 'saved') { setConditions({ ...conditionForm }); setConditionDirty(false); setRebaseRequired(false); setRebaseAccepted(false); setConditionMessage('공통 조건을 저장했어요. 참여자들은 새 조건을 확인해야 해요.'); return; }
    if (result === 'conflict' || result === 'failed') {
      setRebaseRequired(true); setRebaseAccepted(false); setRebaseVersion(null);
      const latest = await shared.refresh();
      if (latest) { setRebaseVersion(latest.conditionsVersion); setConditionMessage('최신 조건과 내 입력을 비교한 뒤 다시 적용해 주세요.'); }
    }
  }
  async function copyInvite() {
    if (!entry) return;
    try { await navigator.clipboard.writeText(entry.trip.inviteCode); setCopied(true); setCopyMessage('초대 코드를 복사했어요.'); }
    catch { setCopyMessage(`초대 코드 ${entry.trip.inviteCode}를 선택해 복사해 주세요.`); }
  }
  function changeView(next: View) {
    setView(next);
    const nextQuery = new URLSearchParams(window.location.search);
    if (next === 'canvas') nextQuery.set('view', 'canvas'); else nextQuery.delete('view');
    window.history.replaceState(null, '', `${window.location.pathname}?${nextQuery.toString()}`);
  }
  if (view === 'canvas' && entry && status === 'ready' && (isPreview || shared.state === 'ready')) return <CanvasPreview tripId={entry.trip.id} onBack={() => changeView('preparation')} />;

  const personal = isPreview ? previewPersonal : personalHook.draft;
  const updatePersonal = <K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) => {
    if (isPreview) { setPreviewPersonal((draft) => ({ ...draft, [key]: value })); setLocalPersonalMessage('미리보기 취향을 수정했어요.'); }
    else { personalHook.updateDraft(key, value); }
  };
  const people = isPreview ? [
    { id: previewEntry.member.id, nickname: '여행자 A', role: 'OWNER' as const, preparationStatus: 'writing' as const },
    { id: 'preview-b', nickname: '여행자 B', role: 'MEMBER' as const, preparationStatus: 'writing' as const },
    { id: 'preview-c', nickname: '여행자 C', role: 'MEMBER' as const, preparationStatus: 'confirmed' as const },
  ] : shared.preparation?.members ?? [];
  const canEdit = isPreview || Boolean(shared.preparation?.canEditConditions);
  const fieldErrors = { ...shared.saveFieldErrors, ...conditionErrors };
  const sampleTrip = isPreview;
  const personalReadyToReview = personalHook.state === 'ready' && personalHook.phase === 'idle' && !personalHook.dirty
    && !conditionDirty && !shared.saving && !rebaseRequired
    && Boolean(personalHook.savedDraft.originalText.trim()) && Boolean(personalHook.savedDraft.likes.trim())
    && ['20', '40', 'unlimited'].includes(personalHook.savedDraft.walking);
  const reviewHelp = conditionDirty || shared.saving || rebaseRequired ? '여행 기본조건을 먼저 저장해 주세요.'
    : personalHook.dirty ? '수정한 취향을 먼저 저장해 주세요.'
      : !personalHook.savedDraft.originalText.trim() ? '여행하고 싶은 내용을 적고 저장해 주세요.'
        : !personalHook.savedDraft.likes.trim() ? '좋아하는 것을 입력하고 저장해 주세요.'
        : !['20', '40', 'unlimited'].includes(personalHook.savedDraft.walking) ? '걷기 시간을 선택하고 저장해 주세요.'
          : '저장한 취향을 확인하면 준비를 완료할 수 있어요.';
  const privateSaveLabel = { loading: '불러오는 중', saving: '저장 중', unsaved: '미저장', saved: '저장됨', confirmed: '저장됨', unknown: '확인 필요', empty: '입력 전' }[personalHook.saveStatus];

  return <main className="travel-workspace prep-room-shell">
    <header className="tw-topbar prep-topbar">
      <a className="tw-brand" href="/">충북 여행 계획</a>
      <div className="tw-topbar-actions">{entry && <><span className="prep-invite-code">초대 코드 <code>{entry.trip.inviteCode}</code></span><Button variant="secondary" onClick={() => void copyInvite()}>{copied ? '복사 완료' : '초대 코드 복사'}</Button><span className="tw-user">{entry.member.nickname}</span></>}</div>
    </header>
    {sampleTrip && <p className="tw-preview-note">화면과 입력은 예시이며 실제 여행방에 저장되지 않아요.</p>}
    {copyMessage && <p className="tw-copy-message" role="status">{copyMessage}</p>}
    {status === 'loading' && <section className="tw-state"><AsyncState status="loading" title="여행방을 확인하고 있어요" description="잠시만 기다려 주세요." /></section>}
    {status === 'error' && <section className="tw-state">{tripId ? <AsyncState status="error" title="여행방에 들어오지 못했어요" description={errorMessage} onRetry={() => { setStatus('loading'); loadRoomEntry(tripId).then((result) => { setEntry(result); setStatus('ready'); }).catch((error: unknown) => { setErrorMessage(error instanceof Error ? error.message : '여행방 정보를 불러오지 못했어요.'); setStatus('error'); }); }} /> : <div role="alert"><h2>여행방 주소를 확인할 수 없어요</h2><p>{errorMessage}</p></div>}<a href="/">여행 시작으로 돌아가기</a></section>}
    {status === 'ready' && entry && !isPreview && shared.state === 'loading' && <section className="tw-state"><AsyncState status="loading" title="공통 조건을 불러오고 있어요" description="참여자와 공유된 정보만 확인하고 있어요." /></section>}
    {status === 'ready' && entry && !isPreview && shared.state === 'error' && <section className="tw-state"><AsyncState status="error" title="여행 준비 정보를 불러오지 못했어요" description={shared.message} onRetry={() => void shared.refresh()} /></section>}
    {fatalAccess && <section className="tw-state" role="alert"><h2>여행방에 계속 접근할 수 없어요</h2><p>{shared.message || '참여 권한이나 여행방 상태가 바뀌었어요. 다시 참여해 주세요.'}</p><a href="/">여행 시작으로 돌아가기</a></section>}
    {status === 'ready' && entry && (isPreview || shared.state === 'ready') && !fatalAccess && <div className="prep-workspace">
      <aside className="prep-icon-rail" aria-label="여행 탐색">
        <button ref={navToggleRef} type="button" className="prep-rail-button" aria-expanded={mobileNavOpen} aria-label={mobileNavOpen ? '탐색 메뉴 닫기' : '탐색 메뉴 열기'} title={mobileNavOpen ? '탐색 메뉴 닫기' : '탐색 메뉴 열기'} onClick={() => setMobileNavOpen((open) => !open)}><PanelIcon /></button>
        <span className="prep-rail-rule" />
        <button type="button" className="prep-rail-button is-active" aria-current="page" aria-label="여행 준비" title="여행 준비" onClick={() => changeView('preparation')}><CheckIcon /></button>
        <button type="button" className="prep-rail-button" aria-label="일정 캔버스 미리보기" title="일정 캔버스 미리보기" onClick={() => changeView('canvas')}><MapIcon /></button>
      </aside>
      {mobileNavOpen && <aside ref={navPanelRef} className="prep-nav-overlay" aria-label="여행 메뉴">
        <div className="prep-nav-heading"><strong>메뉴</strong><button ref={navCloseRef} type="button" className="prep-nav-close" aria-label="탐색 메뉴 닫기" onClick={() => { setMobileNavOpen(false); navToggleRef.current?.focus(); }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></div>
        <nav className="prep-nav-links" aria-label="여행방 메뉴"><button className="is-selected" type="button" aria-current="page" onClick={() => { changeView('preparation'); setMobileNavOpen(false); }}>여행 준비</button><button type="button" onClick={() => changeView('canvas')}>일정 캔버스 <small>미리보기</small></button></nav>
        <a className="prep-nav-return" href="/">여행 시작으로 돌아가기</a>
      </aside>}
      <section className="prep-main" aria-label="여행 준비 작업 공간">
        <header className="prep-page-heading"><div className="prep-heading-title"><h1>{entry.trip.name || '여행 준비'}</h1><section className="prep-participant-strip" aria-label="참여자 준비 상태"><h2><span>참여자</span> <small>{people.length}명</small></h2><div className="prep-participant-list">{people.map((person) => {
          const isOwn = person.id === entry.member.id;
          const confirmed = person.preparationStatus === 'confirmed';
          const memberStatus = confirmed ? '준비 완료' : '준비 중';
          return <div className="prep-participant" data-member-id={isOwn ? 'me' : person.id} key={person.id}><span className="prep-person-name">{person.nickname}<small>{person.role === 'OWNER' ? '방장' : isOwn ? '나' : '참여자'}</small></span><span className={`prep-person-status ${confirmed ? 'is-confirmed' : ''}`}>{memberStatus}</span></div>;
        })}</div></section></div><div className="prep-heading-meta"><span>{conditions.startDate && conditions.endDate ? formatDraftDate(conditions.startDate, conditions.endDate) : '날짜 미정'}</span><span>{conditions.region || '지역 미정'}</span></div></header>
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
              <div className="prep-two-fields"><Input id="departure" label="출발지" maxLength={100} value={conditionForm.departure} placeholder="예: 청주역" error={fieldErrors.departure} onChange={(event) => updateCondition('departure', event.target.value)} /><div className="field"><label htmlFor="return-route">복귀 장소 <span className="prep-optional">선택</span></label><input id="return-route" className="text-input" maxLength={100} value={conditionForm.returnRoute} placeholder="예: 청주역" onChange={(event) => updateCondition('returnRoute', event.target.value)} />{fieldErrors.returnRoute && <p className="field-error" role="alert">{fieldErrors.returnRoute}</p>}</div></div>
            </fieldset>
            {canEdit && <div className="prep-condition-save">{(conditionMessage || (!rebaseRequired && shared.saveMessage)) && <span className="prep-condition-status" role="status">{conditionMessage || shared.saveMessage}</span>}<PreparationActionButton label="조건 저장" loading={shared.saving} loadingLabel="조건 저장 중" onClick={() => void saveConditions()} /></div>}
            {!canEdit && <dl className="prep-readonly-values"><div><dt>지역</dt><dd>{conditions.region || '미정'}</dd></div><div><dt>여행 기간</dt><dd>{conditions.startDate && conditions.endDate ? formatDraftDate(conditions.startDate, conditions.endDate) : '미정'}</dd></div><div><dt>예정 인원</dt><dd>{formatDraftPeople(conditions.expectedPeople)}</dd></div><div><dt>전체 예산</dt><dd>{formatDraftBudget(conditions.budget)}</dd></div><div><dt>이동수단</dt><dd>{formatDraftTransport(conditions.transport)}</dd></div><div><dt>출발지와 복귀</dt><dd>{conditions.departure || '미정'} / {conditions.returnRoute || '미정'}</dd></div></dl>}
            {rebaseRequired && <section className="tw-conflict" aria-live="polite"><h3>공통 조건이 먼저 바뀌었어요</h3><p>{shared.saveMessage || '최신 조건을 확인한 뒤 내 입력을 다시 적용해 주세요.'}</p><dl>{(['region', 'startDate', 'endDate', 'expectedPeople', 'budget', 'transport', 'departure', 'returnRoute'] as const).map((key) => <div key={key}><dt>{key === 'region' ? '지역' : key === 'startDate' ? '시작일' : key === 'endDate' ? '마지막 날' : key === 'expectedPeople' ? '인원' : key === 'budget' ? '예산' : key === 'transport' ? '이동수단' : key === 'departure' ? '출발지' : '복귀 장소'}</dt><dd><span>최신: {key === 'transport' ? formatDraftTransport(shared.conditions?.transport ?? 'undecided') : shared.conditions?.[key] || '미정'}</span><span>내 입력: {key === 'transport' ? formatDraftTransport(conditionForm.transport) : conditionForm[key] || '미정'}</span></dd></div>)}</dl>{rebaseVersion === null ? <Button variant="secondary" onClick={() => { void shared.refresh().then((latest) => { if (latest) setRebaseVersion(latest.conditionsVersion); }); }} disabled={shared.refreshing}>최신 조건 불러오기</Button> : <Button id="room-rebase-accept" variant="secondary" onClick={() => { setEditVersion(rebaseVersion); setRebaseAccepted(true); }}>최신 조건 확인 후 내 변경 다시 적용</Button>}{rebaseAccepted && <p>최신 버전 {editVersion}에 내 변경을 적용할 준비가 됐어요. 저장을 눌러 주세요.</p>}</section>}
          </section>

          <section className="prep-personal-section" aria-labelledby="tw-personal-title">
            <header className="prep-section-heading"><div className="prep-title-line"><h2 id="tw-personal-title">내 취향</h2><InfoTip label="개인 정보 안내" text="원문과 취향 입력은 본인에게만 표시돼요." /></div></header>
            {isPreview ? <p className="prep-personal-message">예시 입력이에요. 분석 기능은 연결되지 않았어요.</p> : personalHook.state === 'fatal' ? <p className="prep-personal-message" role="alert">접근 권한을 확인할 수 없어 개인 입력을 숨겼어요.</p> : null}
            {(!isPreview && personalHook.state === 'fatal') ? null : <>
              {!isPreview && personalHook.state === 'error' && <div className="prep-recovery" role="alert"><p>{personalHook.message.includes('공통 여행 조건이 바뀌었어요') ? '공통 여행 조건이 바뀌어 개인 입력과 저장 상태를 확인해야 해요.' : personalHook.message} 현재 입력은 남아 있어요. 저장본을 불러오면 미저장 입력이 대체돼요.</p><Button variant="secondary" onClick={() => void personalHook.reload()}>미저장 입력을 지우고 저장본 불러오기</Button></div>}
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
                  <div className="prep-personal-fields"><div className="field"><label htmlFor="tw-likes">좋아하는 것</label><input id="tw-likes" className="text-input" maxLength={500} value={personal.likes} placeholder="예: 자연 풍경, 조용한 카페" onChange={(event) => updatePersonal('likes', event.target.value)} /></div>
                    <div className="field"><label htmlFor="tw-avoid">피하고 싶은 것</label><input id="tw-avoid" className="text-input" maxLength={500} value={personal.avoid} placeholder="예: 긴 도보 이동" onChange={(event) => updatePersonal('avoid', event.target.value)} />{personal.avoid && <label className="prep-checkbox"><input type="checkbox" checked={personal.avoidImportance === 'required'} onChange={(event) => updatePersonal('avoidImportance', event.target.checked ? 'required' : 'preferred')} /><span>반드시 피해야 해요</span></label>}</div>
                    <div className="field"><label htmlFor="tw-food">음식 취향</label><input id="tw-food" className="text-input" maxLength={500} value={personal.food} placeholder="예: 맵지 않은 음식, 유제품 제외" onChange={(event) => updatePersonal('food', event.target.value)} />{personal.food && <label className="prep-checkbox"><input type="checkbox" checked={personal.foodImportance === 'required'} onChange={(event) => updatePersonal('foodImportance', event.target.checked ? 'required' : 'preferred')} /><span>꼭 지켜야 하는 식사 조건이에요</span></label>}</div>
                    <fieldset className="prep-walking"><legend>걷기</legend><div>{([['20', '20분 이내'], ['40', '40분 이내'], ['unlimited', '제한 없음']] as const).map(([value, label]) => <button type="button" key={value} className={personal.walking === value ? 'is-selected' : ''} aria-pressed={personal.walking === value} onClick={() => updatePersonal('walking', value)}>{label}</button>)}</div></fieldset>
                  </div>
                </> : <div className="prep-parsed-empty"><h3>내 취향</h3><p>원하는 내용을 적고 분석하면 여기에 정리돼요.</p></div>}
                {isPreview ? <div className="prep-confirm-row"><span role="status">{localPersonalMessage || '예시 입력은 실제 여행방 상태에 반영되지 않아요.'}</span></div> : <div className="prep-confirm-row prep-personal-actions">
                  <div className="prep-personal-save-row"><span className="prep-private-save-status" role="status">{privateSaveLabel}</span><PreparationActionButton label="내 취향 저장" loading={personalHook.phase === 'saving'} loadingLabel="취향 저장 중" disabled={personalHook.state !== 'ready' || personalHook.phase !== 'idle' || !personalHook.dirty} onClick={() => void personalHook.save()} /></div>
                  {personalHook.resultsVisible && <div className="prep-review-row"><label className="prep-review-checkbox"><input type="checkbox" checked={personalHook.reviewed} disabled={!personalReadyToReview || personalHook.confirmation?.status === 'confirmed'} onChange={(event) => personalHook.setReviewed(event.target.checked)} /><span>여행 조건과 내 취향을 확인했어요</span></label><PreparationActionButton label="준비 완료" loading={personalHook.phase === 'confirming'} loadingLabel="준비 완료 처리 중" disabled={!personalHook.canConfirm || !personalReadyToReview} onClick={() => { if (personalReadyToReview && personalHook.canConfirm) void personalHook.confirm(); }} /></div>}
                  {!personalReadyToReview && personalHook.resultsVisible && personalHook.state === 'ready' && personalHook.phase === 'idle' && personalHook.confirmation?.status !== 'confirmed' && <small className="prep-review-help">{reviewHelp}</small>}
                </div>}
              </fieldset>
            </>}
          </section>
        </div>
        <section className="prep-generation"><div><h2>일정 만들기</h2><p id="tw-generation-note">{isPreview ? '일정 생성 기능은 아직 연결되지 않았어요.' : shared.preparation?.readiness.conditionsReady ? '일정 생성 기능은 아직 연결되지 않았어요.' : '공통 조건과 참여자 확인 상태를 먼저 준비해 주세요.'}</p></div><PreparationActionButton label="일정 만들기" disabled ariaDescribedBy="tw-generation-note" /></section>
      </section>
    </div>}
  </main>;
}
