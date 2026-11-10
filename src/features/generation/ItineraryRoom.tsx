import Button from '../../components/ui/Button';
import { useState } from 'react';
import GenerationWorkspace from './GenerationWorkspace';
import '../../styles/itinerary-room.css';

type Entry = { trip: { id: string; name: string; inviteCode: string }; member: { id: string; nickname: string; role: 'OWNER' | 'MEMBER' } };
type Conditions = { region: string; startDate: string; endDate: string; expectedPeople: string; budget: string; transport: string };
type Person = { id: string; nickname: string; role: 'OWNER' | 'MEMBER'; preparationStatus: 'writing' | 'confirmed' };

type Props = {
  entry: Entry | null;
  conditions: Conditions;
  conditionsVersion: number;
  people: Person[];
  tripId: string | null;
  isPreview: boolean;
  status: 'loading' | 'ready' | 'error';
  fatalAccess: boolean;
  errorMessage: string;
  sharedReady: boolean;
  sharedError?: string;
  initiallyOpenSettings?: boolean;
  onRetry: () => void;
  onAccessLost: () => void;
  onChangeView: (view: 'preparation' | 'canvas') => void;
};

function displayDate(conditions: Conditions) {
  return conditions.startDate && conditions.endDate
    ? `${conditions.startDate.replaceAll('-', '.')} – ${conditions.endDate.replaceAll('-', '.')}`
    : '여행 날짜 미정';
}

export default function ItineraryRoom(props: Props) {
  const { entry, conditions, conditionsVersion, people, tripId, isPreview, status, fatalAccess, errorMessage, sharedReady, sharedError, initiallyOpenSettings = false, onRetry, onAccessLost, onChangeView } = props;
  const [copyMessage, setCopyMessage] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const usableEntry = entry && status === 'ready' && (isPreview || sharedReady) && !fatalAccess ? entry : null;
  async function copyInvite() {
    if (!usableEntry) return;
    setCopyFailed(false);
    try { await navigator.clipboard.writeText(usableEntry.trip.inviteCode); setCopyMessage('초대 코드를 복사했어요.'); }
    catch { setCopyFailed(true); setCopyMessage('초대 코드를 선택해 복사해 주세요.'); document.getElementById('itinerary-room-code')?.focus(); }
  }
  const navigation = <nav className="itinerary-room-nav" aria-label="여행방 메뉴">
    <button type="button" onClick={() => onChangeView('preparation')}>□ <span>여행 준비</span></button>
    <button type="button" onClick={() => { onChangeView('preparation'); requestAnimationFrame(() => document.getElementById('tw-personal-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }}>□ <span>내 취향·제약</span></button>
    <button type="button" className="is-selected" aria-current="page">□ <span>여행 일정</span></button>
    <button type="button" onClick={() => onChangeView('canvas')}>□ <span>일정 캔버스 미리보기</span></button>
    <span className="is-disabled">□ <span>변경 이력</span><small>준비 중</small></span>
  </nav>;

  return <main className="itinerary-room">
    <header className="itinerary-room-topbar">
      <a href="/" className="itinerary-room-brand">충북 여행 계획</a>
      <div className="itinerary-room-meta"><span>{usableEntry ? `내 여행 / ${usableEntry.trip.name}` : '여행 일정'}</span>
        {usableEntry && <strong>{displayDate(conditions)} · {conditions.expectedPeople ? `${conditions.expectedPeople}명` : '인원 미정'} · {conditions.region || '충북 지역 미정'}</strong>}
      </div>
      <div className="itinerary-room-actions">{usableEntry && <div className={`itinerary-room-share${copyFailed ? ' is-copy-failed' : ''}`}><code id="itinerary-room-code" tabIndex={copyFailed ? 0 : -1} aria-label="여행방 초대 코드">{usableEntry.trip.inviteCode}</code><Button variant="secondary" onClick={() => void copyInvite()}>초대 코드 복사</Button><span className="itinerary-room-copy-message" role="status">{copyMessage}</span></div>}
        {usableEntry && <span className="itinerary-room-user"><i aria-hidden="true">{usableEntry.member.nickname.slice(0, 1)}</i>{usableEntry.member.nickname}</span>}
      </div>
    </header>
    {isPreview && <p className="itinerary-room-preview" role="status">화면 미리보기 · 예시 데이터예요. 실제 여행방 정보와 다르며 서버에 저장되지 않아요.</p>}
    {fatalAccess && <p className="itinerary-room-message" role="alert">여행방에 계속 접근할 수 없어요. 참여 권한이나 여행방 상태를 확인해 주세요.</p>}
    <div className="itinerary-room-layout">
      <aside className="itinerary-room-sidebar">
        <p className="itinerary-room-side-label">여행 워크스페이스</p>
        {navigation}
        {usableEntry && <section className="itinerary-room-people"><h2>함께하는 사람</h2>
          {people.map((person) => <div className="itinerary-room-person" key={person.id}><span className={`itinerary-room-dot ${person.preparationStatus === 'writing' ? 'is-pending' : ''}`} /><span>{person.nickname} <small>{person.id === usableEntry.member.id ? `나${person.role === 'OWNER' ? ' · 방장' : ''}` : person.role === 'OWNER' ? '방장' : ''}</small></span><span>{person.preparationStatus === 'confirmed' ? '확정 완료' : '작성중'}</span></div>)}
          {!isPreview && <p className="itinerary-room-people-note">현재 참여 중인 {people.length}명 · 개인 원문과 취향은 공유하지 않아요.</p>}
        </section>}
        <section className="itinerary-room-privacy"><strong>개인 입력은 나만 확인</strong><p>공통 화면에는 준비 상태와 종합 조건만 표시해요.</p></section>
        <a className="itinerary-room-back" href="/">← 여행 시작으로</a>
      </aside>
      <section className="itinerary-room-main" aria-label="실제 여행 일정">
        {status === 'loading' && <section className="itinerary-room-state" role="status"><h2>여행방을 확인하고 있어요</h2><p>잠시만 기다려 주세요.</p></section>}
        {status === 'error' && <section className="itinerary-room-state" role="alert"><h2>여행방에 들어오지 못했어요</h2><p>{errorMessage}</p><Button variant="secondary" onClick={onRetry}>다시 시도</Button></section>}
        {isPreview && <section className="itinerary-room-state"><h2>실제 일정 생성</h2><p>미리보기에서는 실제 일정 API를 호출하지 않아요.</p><Button variant="secondary" onClick={() => onChangeView('preparation')}>여행 준비로</Button></section>}
        {status === 'ready' && sharedReady && usableEntry && tripId && !isPreview && <GenerationWorkspace tripId={tripId} tripName={usableEntry.trip.name} conditionsVersion={conditionsVersion} expectedPeople={conditions.expectedPeople} budget={conditions.budget} transport={conditions.transport} isOwner={usableEntry.member.role === 'OWNER'} startDate={conditions.startDate} endDate={conditions.endDate} initiallyOpenSettings={initiallyOpenSettings} onAccessLost={onAccessLost} />}
        {status === 'ready' && !sharedReady && !fatalAccess && <section className="itinerary-room-state" role={sharedError ? 'alert' : 'status'}><h2>{sharedError ? '공통 여행 조건을 불러오지 못했어요' : '공통 여행 조건을 불러오고 있어요'}</h2><p>{sharedError || '잠시 기다린 뒤 다시 시도해 주세요.'}</p><Button variant="secondary" onClick={onRetry}>다시 시도</Button></section>}
      </section>
    </div>
  </main>;
}
