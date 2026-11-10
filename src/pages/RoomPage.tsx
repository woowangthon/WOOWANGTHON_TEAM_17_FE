import { useEffect, useRef, useState } from 'react';
import AsyncState from '../components/ui/AsyncState';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import Input from '../components/ui/Input';
import {
  emptyPersonalDraft, emptyRoomDraft, formatDraftBudget, formatDraftDate, formatDraftPeople,
  formatDraftTransport, loadRoomEntry, personalDraftComplete, previewPersonalDraft,
  roomConditionsStarted, validateRoomDraft, type PersonalDraft, type RoomDraft, type RoomEntry,
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
type Section = 'preparation' | 'personal';

export default function RoomPage() {
  const tripId = new URLSearchParams(window.location.search).get('tripId');
  const [entry, setEntry] = useState<RoomEntry | null>(isPreview ? previewEntry : null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(isPreview ? 'ready' : tripId ? 'loading' : 'error');
  const [errorMessage, setErrorMessage] = useState('여행방 주소가 없어요. 시작 화면에서 방을 만들거나 초대 코드로 참여해 주세요.');
  const [section, setSection] = useState<Section>('preparation');
  const [appliedConditions, setAppliedConditions] = useState<RoomDraft>(isPreview ? previewConditions : { ...emptyRoomDraft });
  const [conditionForm, setConditionForm] = useState<RoomDraft>(isPreview ? previewConditions : { ...emptyRoomDraft });
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [conditionErrors, setConditionErrors] = useState<Partial<Record<keyof RoomDraft, string>>>({});
  const [conditionMessage, setConditionMessage] = useState('');
  const [personal, setPersonal] = useState<PersonalDraft>(isPreview ? { ...previewPersonalDraft } : { ...blankPersonal });
  const [personalOpen, setPersonalOpen] = useState(false);
  const [personalForm, setPersonalForm] = useState<PersonalDraft>(isPreview ? { ...previewPersonalDraft } : { ...blankPersonal });
  const [confirmed, setConfirmed] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestRef = useRef(0);
  const code = entry?.trip.inviteCode;
  const personalComplete = personalDraftComplete(personal);

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

  function saveConditions() {
    const errors = validateRoomDraft(conditionForm);
    setConditionErrors(errors);
    if (Object.keys(errors).length) return;
    setAppliedConditions({ ...conditionForm });
    setConditionsOpen(false);
    setReviewed(false); setConfirmed(false);
    setConditionMessage('공통 조건이 바뀌어 내 조건을 다시 확인해야 해요. 바뀐 내용은 이 화면에만 남아 있어요.');
  }

  function savePersonal() {
    setPersonal({ ...personalForm });
    setPersonalOpen(false);
    setReviewed(false); setConfirmed(false);
    setConditionMessage('내 조건이 바뀌었어요. 다시 확인한 뒤 확정해 주세요.');
  }

  function confirmPersonal() {
    if (!personalComplete || !reviewed) return;
    setConfirmed(true);
    setConditionMessage('내 조건을 이 화면에서 확인했어요. 서버에는 전송되거나 다른 사람에게 공유되지 않았어요.');
  }

  function updateCondition<K extends keyof RoomDraft>(key: K, value: RoomDraft[K]) {
    setConditionForm((current) => ({ ...current, [key]: value }));
    setConditionErrors((current) => ({ ...current, [key]: undefined, ...(key === 'startDate' || key === 'endDate' ? { startDate: undefined, endDate: undefined } : {}) }));
  }

  function updatePersonal<K extends keyof PersonalDraft>(key: K, value: PersonalDraft[K]) {
    setPersonal((current) => ({ ...current, [key]: value }));
    setReviewed(false); setConfirmed(false);
    setConditionMessage('내 조건이 바뀌었어요. 다시 확인한 뒤 확정해 주세요.');
  }

  function openConditions() { setConditionForm({ ...appliedConditions }); setConditionErrors({}); setConditionsOpen(true); }
  function openPersonal() { setPersonalForm({ ...personal }); setPersonalOpen(true); }
  const sidebar = <aside className="room-sidebar">
    <p className="room-sidebar-label">여행 워크스페이스</p>
    <nav className="room-nav" aria-label="여행방 메뉴">
      <button type="button" className={section === 'preparation' ? 'is-selected' : ''} aria-current={section === 'preparation' ? 'page' : undefined} onClick={() => setSection('preparation')}><span aria-hidden="true">□</span> 여행 준비</button>
      <button type="button" className={section === 'personal' ? 'is-selected' : ''} aria-current={section === 'personal' ? 'page' : undefined} onClick={() => setSection('personal')}><span aria-hidden="true">□</span> 내 취향·제약</button>
      <span className="room-nav-disabled" aria-disabled="true"><span aria-hidden="true">□</span> 여행 일정 <small>준비 중</small></span>
      <span className="room-nav-disabled" aria-disabled="true"><span aria-hidden="true">□</span> 변경 이력 <small>준비 중</small></span>
    </nav>
    <section className="room-people"><h2>함께하는 사람</h2>
      <div className="room-person"><span className="room-person-dot" /><span>{entry?.member.nickname} <small>나{entry?.member.role === 'OWNER' ? ' · 방장' : ''}</small></span><span className="room-person-state">나</span></div>
      {isPreview && <><div className="room-person"><span className="room-person-dot is-pending" /><span>여행자 B</span><span className="room-person-state">작성 중</span></div><div className="room-person"><span className="room-person-dot" /><span>여행자 C</span><span className="room-person-state">확정 완료</span></div></>}
      {!isPreview && <p className="room-people-note">현재 연결된 정보에는 나만 보여요. 다른 참여자의 상태는 아직 확인할 수 없어요.</p>}
    </section>
    <section className="room-privacy"><strong>개인 입력은 나만 확인</strong><p>공통 화면에는 준비 상태와 종합 조건만 표시해요.</p></section>
    <a className="room-back" href={returnHref}>← 여행 시작으로</a>
  </aside>;

  return <main className="room-app">
    <header className="room-topbar"><a href={returnHref} className="room-brand">충북 여행 계획</a>
      <div className="room-top-meta"><span>내 여행 / {entry?.trip.name ?? '여행방'}</span><strong>{appliedConditions.startDate && appliedConditions.endDate ? formatDraftDate(appliedConditions.startDate, appliedConditions.endDate) : '여행 날짜 미정'} · {formatDraftPeople(appliedConditions.expectedPeople)} · {appliedConditions.region || '충북 지역 미정'}</strong></div>
      <div className="room-top-actions">{entry && <div className="room-share-actions"><code ref={codeRef} tabIndex={copyFailed ? 0 : -1} aria-label="여행방 초대 코드">{entry.trip.inviteCode}</code><Button variant="secondary" onClick={copyCode}>{copied ? '복사 완료' : '초대 코드 복사'}</Button><span className={copyFailed ? 'room-copy-status is-error' : 'room-copy-status'} role="status" aria-live="polite">{copyMessage}</span></div>}{entry && <span className="room-top-user"><i aria-hidden="true">{entry.member.nickname.slice(0, 1)}</i>{entry.member.nickname}</span>}</div>
    </header>
    {isPreview && <p className="room-preview-banner" role="status">화면 미리보기 · 예시 데이터예요. 실제 여행방 정보와 다르며 서버에 저장되지 않아요.</p>}
    {status === 'ready' && <p className="room-memory-note">입력 내용은 이 페이지가 열려 있는 동안에만 유지돼요. 새로고침하면 사라져요.</p>}
    {status === 'loading' && <section className="room-state-card"><AsyncState status="loading" title="여행방을 확인하고 있어요" description="잠시만 기다려 주세요." /></section>}
    {status === 'error' && <section className="room-state-card">{tripId ? <AsyncState status="error" title="여행방에 들어오지 못했어요" description={errorMessage} onRetry={retry} /> : <div className="async-state async-state-error" role="alert"><h3>여행방 주소를 확인할 수 없어요</h3><p>{errorMessage}</p></div>}<a className="room-return-link" href={returnHref}>시작 화면으로 돌아가기</a></section>}
    {status === 'ready' && entry && <div className="room-layout">
      {sidebar}
      <section className="room-workspace">
        {section === 'preparation' ? <>
          <p className="room-eyebrow">01 PREPARE</p><h1 ref={headingRef} tabIndex={-1}>함께 준비하는 {appliedConditions.region ? `${appliedConditions.region} ` : ''}여행</h1><p className="room-lead">각자의 조건을 확인하면, 모두에게 맞는 일정을 만들 수 있어요.</p>
          <section className="room-next-step"><div><p className="room-eyebrow">다음 할 일</p><h2>{personalComplete ? confirmed ? '모두 함께 준비해요' : '내 취향을 확인해 주세요' : '내 취향을 먼저 적어 주세요'}</h2><p>{confirmed ? '내 조건을 확인했어요. 다음 준비를 기다려 주세요.' : '내가 정리한 여행 조건을 확인하면 내 준비 상태에 반영돼요.'}</p></div><Button onClick={() => setSection('personal')}>{confirmed ? '내 조건 보기' : '내 조건 확인하기'}</Button></section>
          <section className="room-invite-card" aria-labelledby="invite-title"><div><p className="room-eyebrow">친구들과 함께해요</p><h2 id="invite-title">초대 코드</h2><p>친구에게 상단의 초대 코드를 알려주면 여행방에 참여할 수 있어요.</p></div><code aria-label="여행방 초대 코드">{entry.trip.inviteCode}</code></section>
          <div className="room-dashboard-grid">
            <section className="room-card room-shared-conditions"><div className="room-card-head"><div><h2>여행의 기본 조건</h2><p>모두가 공유하는 여행 기준이에요. 바꾸면 다시 확인이 필요해요.</p></div><Button variant="secondary" onClick={openConditions}>수정</Button></div>
              <dl className="room-condition-grid"><div><dt>여행 지역</dt><dd>{appliedConditions.region || '아직 정하지 않았어요'}</dd></div><div><dt>여행 기간</dt><dd>{formatDraftDate(appliedConditions.startDate, appliedConditions.endDate)}</dd></div><div><dt>전체 인원</dt><dd>{formatDraftPeople(appliedConditions.expectedPeople)}</dd></div><div><dt>이동수단</dt><dd>{formatDraftTransport(appliedConditions.transport)}</dd></div><div><dt>출발지</dt><dd>{appliedConditions.departure || '아직 정하지 않았어요'}</dd></div><div><dt>복귀 장소</dt><dd>{appliedConditions.returnRoute || '아직 정하지 않았어요'}</dd></div><div><dt>숙박</dt><dd>{appliedConditions.lodging || '아직 정하지 않았어요'}</dd></div><div className="room-fixed"><dt>고정 일정</dt><dd>{appliedConditions.fixedSchedule || '아직 정하지 않았어요'}</dd></div></dl>
              <p className="room-local-draft">이 조건은 현재 이 기기의 초안이에요. 다른 참여자에게 공유되거나 서버에 저장되지 않아요.</p>
            </section>
            <div className="room-side-cards">
              <section className="room-card room-readiness"><h2>준비 상태</h2><p>내 조건 확인 여부를 보여줘요.</p><div className="room-readiness-person"><span className="room-person-avatar">{entry.member.nickname.slice(0, 1)}</span><span>{entry.member.nickname} <small>나</small></span><strong>{confirmed ? '확인 완료' : personalComplete ? '확인 필요' : '아직 입력 전'}</strong></div>{isPreview && <div className="room-readiness-person"><span className="room-person-avatar">B</span><span>여행자 B</span><strong>작성 중</strong></div>}{!isPreview && <p className="room-private-note">다른 참여자의 준비 상태는 불러오는 기능이 아직 없어요.</p>}</section>
              <section className="room-card room-itinerary-ready"><h2>일정 생성 준비</h2><p>각자 조건을 확인한 뒤 일정을 준비할 수 있어요.</p><ul><li className={roomConditionsStarted(appliedConditions) ? 'is-done' : ''}>공통 조건 {roomConditionsStarted(appliedConditions) ? '초안 입력됨' : '정하기'}</li><li className={confirmed ? 'is-done' : ''}>내 조건 {confirmed ? '내 화면에서 확인' : '확인 필요'}</li><li>함께 일정 준비는 다음 단계예요</li></ul><Button disabled aria-describedby="room-disabled-reason">일정 준비하기</Button><small id="room-disabled-reason">서버 저장과 일정 기능은 아직 연결되지 않았어요.</small></section>
            </div>
            <section className="room-card room-budget"><div><h2>여행 예산</h2><p>전체 인원 기준 초안이에요.</p></div><strong>{formatDraftBudget(appliedConditions.budget)}</strong>{appliedConditions.expectedPeople && appliedConditions.budget && <p>1인 기준 약 {Math.round(Number(appliedConditions.budget) / Number(appliedConditions.expectedPeople)).toLocaleString('ko-KR')}원</p>}<small>아직 입력하지 않았거나, 이 기기에서 정리한 임시 금액이에요. 실제 예약·결제 금액과 다를 수 있어요.</small></section>
          </div>
          {conditionMessage && <p className="room-live-message" role="status">{conditionMessage}</p>}
        </> : <>
          <div className="room-personal-title"><div><p className="room-eyebrow">02 PERSONAL PREFERENCES</p><h1 ref={headingRef} tabIndex={-1}>내 여행 취향을 확인해 주세요</h1><p className="room-lead">내가 작성한 내용을 바탕으로 조건을 직접 정리해요. 원문과 조건은 나만 볼 수 있어요.</p></div><span className="room-private-badge">나만 보기</span></div>
          <div className="room-personal-flow">1 자유롭게 입력 ─── 2 조건 확인 · 수정 ─── 3 내 조건 확인</div>
          <div className="room-personal-grid">
            <section className="room-card room-original-card"><h2>내가 작성한 내용</h2><p>원문을 고쳐도 아래 조건을 직접 확인하고 수정해 주세요.</p>{personal.originalText ? <pre>{personal.originalText}</pre> : <div className="room-empty-original">아직 적은 내용이 없어요.<br />좋아하는 것과 피하고 싶은 점을 적어 보세요.</div>}<p className="room-private-caption">원문과 내 취향은 본인만 볼 수 있어요.</p><Button variant="secondary" onClick={openPersonal}>{personal.originalText ? '원문 수정' : '내 취향 적기'}</Button><hr /><h3>개인 입력 공개 범위</h3><p>원문과 개인 조건은 공개하지 않고, 함께 보는 화면에는 준비 여부만 표시해요.</p></section>
            <section className="room-card room-personal-fields"><div className="room-card-head"><div><h2>내가 정리한 여행 조건</h2><p>{isPreview ? '미리보기 예시예요. 실제 여행방은 이 칸이 비어 있어요.' : 'AI 해석을 불러오지 않고 내가 직접 정리하는 초안이에요.'}</p></div><span className={personalComplete ? 'room-status-badge is-ready' : 'room-status-badge'}>{confirmed ? '확인 완료' : personalComplete ? '확인 필요' : '입력 필요'}</span></div>
              <div className="room-personal-field"><label htmlFor="likes-field">좋아하는 활동</label><input id="likes-field" className="text-input" maxLength={500} value={personal.likes} placeholder="예: 자연 풍경, 조용한 카페" onChange={(event) => updatePersonal('likes', event.target.value)} /></div>
              <div className="room-personal-field"><label htmlFor="avoid-field">피하고 싶은 요소</label><div className="room-inline-fields"><input id="avoid-field" className="text-input" maxLength={500} value={personal.avoid} placeholder="예: 긴 도보 이동" onChange={(event) => updatePersonal('avoid', event.target.value)} /><select className="text-input" aria-label="피하고 싶은 요소 중요도" value={personal.avoidImportance} onChange={(event) => updatePersonal('avoidImportance', event.target.value as PersonalDraft['avoidImportance'])}><option value="required">꼭 필요한 조건</option><option value="preferred">선호 사항</option></select></div></div>
              <div className="room-personal-field"><label htmlFor="food-field">음식 취향</label><div className="room-inline-fields"><input id="food-field" className="text-input" maxLength={500} value={personal.food} placeholder="예: 맵지 않은 음식" onChange={(event) => updatePersonal('food', event.target.value)} /><select className="text-input" aria-label="음식 취향 중요도" value={personal.foodImportance} onChange={(event) => updatePersonal('foodImportance', event.target.value as PersonalDraft['foodImportance'])}><option value="required">꼭 필요한 조건</option><option value="preferred">선호 사항</option></select></div></div>
              <fieldset className="room-walking"><legend>한 번에 어느 정도까지 걷기 편한가요?</legend><div>{([['20', '20분 이내'], ['40', '40분 이내'], ['unlimited', '시간 제한 없음']] as const).map(([value, label]) => <button type="button" key={value} className={personal.walking === value ? 'is-selected' : ''} aria-pressed={personal.walking === value} onClick={() => updatePersonal('walking', value)}>{label}</button>)}</div></fieldset>
              {isPreview && <p className="room-preview-data-note">미리보기 예시 데이터예요. 실제 참여자의 원문이나 취향이 아니에요.</p>}
            </section>
          </div>
          <section className="room-confirm-bar"><label><input type="checkbox" checked={reviewed} onChange={(event) => { setReviewed(event.target.checked); setConfirmed(false); if (!event.target.checked) setConditionMessage('확인 상태를 해제했어요. 내용을 다시 확인해 주세요.'); }} /> 내 조건과 추가 답변을 확인했어요.</label><Button variant="secondary" onClick={() => setSection('preparation')}>나중에 확인</Button><Button onClick={confirmPersonal} disabled={!personalComplete || !reviewed}>{confirmed ? '확정 완료 (이 화면)' : '내 조건 확정하기'}</Button></section>
          {!personalComplete && <p className="room-confirm-hint">좋아하는 활동, 걷기 정도, 나만 보는 원문을 적으면 조건을 확인할 수 있어요.</p>}
          {conditionMessage && <p className="room-live-message" role="status">{conditionMessage}</p>}
        </>}
      </section>
    </div>}

    <Dialog open={conditionsOpen} title="여행 기본 조건" onClose={() => { setConditionsOpen(false); setConditionErrors({}); }} onConfirm={saveConditions} confirmLabel="초안 반영" cancelLabel="취소">
      <form className="room-dialog-form" onSubmit={(event) => { event.preventDefault(); saveConditions(); }}>
        <p className="room-dialog-note">현재 입력한 내용만 이 화면에 반영돼요. 아직 서버에 저장되거나 친구에게 공유되지 않아요.</p>
        <Input id="region" label="여행 지역" maxLength={100} value={conditionForm.region} placeholder="예: 충북 단양" onChange={(event) => updateCondition('region', event.target.value)} />
        <div className="room-date-fields"><Input id="start-date" label="여행 시작일" type="date" value={conditionForm.startDate} error={conditionErrors.startDate} onChange={(event) => updateCondition('startDate', event.target.value)} /><Input id="end-date" label="여행 마지막 날" type="date" value={conditionForm.endDate} error={conditionErrors.endDate} onChange={(event) => updateCondition('endDate', event.target.value)} /></div>
        <Input id="people" label="예정 인원" type="number" inputMode="numeric" min="1" max="50" value={conditionForm.expectedPeople} placeholder="예: 4" error={conditionErrors.expectedPeople} onChange={(event) => updateCondition('expectedPeople', event.target.value)} />
        <Input id="budget" label="전체 예산" type="number" inputMode="numeric" min="1" max="1000000000" value={conditionForm.budget} placeholder="예: 500000" hint="아직 정하지 않았다면 비워 둘 수 있어요." error={conditionErrors.budget} onChange={(event) => updateCondition('budget', event.target.value)} />
        <label className="room-select-label" htmlFor="transport">이동수단</label><select id="transport" className="text-input" value={conditionForm.transport} onChange={(event) => updateCondition('transport', event.target.value as RoomDraft['transport'])}><option value="undecided">아직 정하지 않았어요</option><option value="car">자가용</option><option value="transit">대중교통</option><option value="charter">전세버스</option><option value="walk">도보</option></select>
        <Input id="departure" label="출발지" maxLength={100} value={conditionForm.departure} placeholder="예: 청주역" onChange={(event) => updateCondition('departure', event.target.value)} />
        <Input id="return-route" label="복귀 장소" maxLength={100} value={conditionForm.returnRoute} placeholder="예: 청주역" onChange={(event) => updateCondition('returnRoute', event.target.value)} />
        <Input id="lodging" label="숙박" maxLength={200} value={conditionForm.lodging} placeholder="예: 1박 필요" onChange={(event) => updateCondition('lodging', event.target.value)} />
        <Input id="fixed-schedule" label="고정 일정" maxLength={500} value={conditionForm.fixedSchedule} placeholder="예: 둘째 날 오후 6시까지 복귀" onChange={(event) => updateCondition('fixedSchedule', event.target.value)} />
      </form>
    </Dialog>

    <Dialog open={personalOpen} title="내 취향과 여행 원문" onClose={() => setPersonalOpen(false)} onConfirm={savePersonal} confirmLabel="내 화면에 반영" cancelLabel="취소">
      <div className="room-dialog-form"><p className="room-dialog-note">원문과 개인 조건은 본인 화면에만 보관돼요. 서버에 전송되지 않고, 이 페이지를 벗어나면 사라져요.</p><label className="room-select-label" htmlFor="original-text">좋아하는 것, 피하고 싶은 점, 음식 취향을 자유롭게 적어 주세요.</label><textarea id="original-text" maxLength={5000} className="text-input room-original-input" value={personalForm.originalText} onChange={(event) => { const originalText = event.target.value; setPersonalForm((current) => ({ ...current, originalText })); }} placeholder="예: 자연을 보고 조용히 쉬고 싶어요. 오래 걷는 건 어려워요." /><p className="field-help">실제 AI 해석은 아직 연결되지 않았어요. 아래 조건은 내가 직접 확인하고 수정해요.</p></div>
    </Dialog>
  </main>;
}
