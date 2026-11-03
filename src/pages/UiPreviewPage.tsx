import { useEffect, useRef, useState, type FormEvent } from 'react';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import Input from '../components/ui/Input';
import ConditionCard from '../components/trip/ConditionCard';
import ItineraryCard, { type ItineraryItem } from '../components/trip/ItineraryCard';
import ItineraryDetail from '../components/trip/ItineraryDetail';
import ParticipantStatus, { type ParticipantState } from '../components/trip/ParticipantStatus';
import AsyncState from '../components/ui/AsyncState';
import { submitRoomName, waitForPreview } from '../features/ui-preview/mockRequests';

const initialBudget = '1500000';
const itinerary: ItineraryItem[] = [
  { id: 'view', startTime: '09:30', endTime: '11:00', title: '호수 전망 코스에서 여유롭게 걷고 사진 남기기', durationLabel: '1시간 30분', category: '전망 코스', description: '호수와 산이 보이는 산책길을 함께 걸어요.', costLabel: '비용 추정 · 1인 약 12,000원', travelAfter: '다음 장소까지 차로 약 18분 · 예시' },
  { id: 'lunch', startTime: '11:30', endTime: '13:00', title: '지역 식당에서 천천히 점심 먹기', durationLabel: '1시간 30분', category: '지역 식당', description: '메뉴와 자리를 함께 정해 느긋하게 식사해요.', costLabel: '비용 추정 · 1인 약 18,000원', travelAfter: '다음 장소까지 차로 약 25분 · 예시' },
  { id: 'cafe', startTime: '13:40', endTime: '15:10', title: '조용한 카페에서 쉬어가기', durationLabel: '1시간 30분', category: '조용한 카페', description: '일정을 마무리하며 차 한 잔과 휴식을 즐겨요.', costLabel: '비용 추정 · 1인 약 8,000원' },
];

type AsyncStatus = 'loading' | 'empty' | 'error';

export default function UiPreviewPage() {
  const [roomName, setRoomName] = useState('가을 제천, 천천히 걷는 하루');
  const [roomError, setRoomError] = useState('');
  const [roomStatus, setRoomStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [attemptCount, setAttemptCount] = useState(0);
  const [failFirst, setFailFirst] = useState(true);
  const [roomResult, setRoomResult] = useState<{ roomName: string; roomCode: string } | null>(null);
  const [successOpen, setSuccessOpen] = useState(false);
  const [selfStatus, setSelfStatus] = useState<ParticipantState>('writing');
  const [participantOpen, setParticipantOpen] = useState(false);
  const [participantPending, setParticipantPending] = useState(false);
  const [budget, setBudget] = useState(initialBudget);
  const [budgetDraft, setBudgetDraft] = useState(initialBudget);
  const [budgetError, setBudgetError] = useState('');
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [conditionNotice, setConditionNotice] = useState('공통 조건이 변경되면 확정한 참여자도 다시 확인해야 해요.');
  const [actionAnnouncement, setActionAnnouncement] = useState('');
  const [selectedId, setSelectedId] = useState(itinerary[0].id);
  const [asyncStatus, setAsyncStatus] = useState<AsyncStatus>('error');
  const [asyncBusy, setAsyncBusy] = useState(false);
  const roomRequestLock = useRef(false);
  const roomController = useRef<AbortController | null>(null);
  const asyncController = useRef<AbortController | null>(null);
  const participantController = useRef<AbortController | null>(null);
  const requestAttempt = useRef(0);
  const mounted = useRef(true);
  const submitButtonRef = useRef<HTMLElement | null>(null);
  const participantLock = useRef(false);
  const asyncLock = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      roomController.current?.abort();
      asyncController.current?.abort();
      participantController.current?.abort();
      roomController.current = null;
      asyncController.current = null;
      participantController.current = null;
    };
  }, []);

  useEffect(() => {
    // Disabling the submitting button can move focus to the body. Restore the
    // retry action after a failure, without interrupting another focused control.
    if (roomStatus === 'error' && document.activeElement === document.body) {
      document.getElementById('room-submit')?.focus();
    }
  }, [roomStatus]);

  function changeRoomName(value: string) {
    setRoomName(value);
    setRoomError('');
    requestAttempt.current = 0;
    setAttemptCount(0);
    roomController.current?.abort();
    roomController.current = null;
    roomRequestLock.current = false;
    setRoomStatus('idle');
  }

  async function handleRoomSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (roomRequestLock.current) return;
    const snapshot = roomName.trim();
    if (!snapshot) { setRoomError('방 이름을 입력해 주세요.'); document.getElementById('room-name')?.focus(); return; }
    if (snapshot.length > 24) { setRoomError('방 이름은 24자 이내로 입력해 주세요.'); document.getElementById('room-name')?.focus(); return; }

    roomRequestLock.current = true;
    setRoomError('');
    setRoomStatus('loading');
    const controller = new AbortController();
    roomController.current = controller;
    const thisAttempt = requestAttempt.current;
    requestAttempt.current += 1;
    setAttemptCount(requestAttempt.current);
    try {
      const result = await submitRoomName(snapshot, { fail: failFirst && thisAttempt === 0, signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || roomController.current !== controller) return;
      setRoomResult(result);
      setRoomStatus('idle');
      submitButtonRef.current = document.getElementById('room-submit');
      setSuccessOpen(true);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || roomController.current !== controller) return;
      if (error instanceof Error && error.name === 'AbortError') return;
      setRoomStatus('error');
      setRoomError(error instanceof Error ? error.message : '요청을 마치지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (roomController.current === controller) {
        roomController.current = null;
        roomRequestLock.current = false;
      }
    }
  }

  async function confirmParticipant() {
    if (participantLock.current) return;
    participantLock.current = true;
    setParticipantPending(true);
    const controller = new AbortController();
    participantController.current = controller;
    try {
      await waitForPreview(550, controller.signal);
      if (mounted.current && !controller.signal.aborted) {
        setSelfStatus('confirmed');
        setActionAnnouncement('내 준비 상태를 확정했어요.');
        setParticipantOpen(false);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') throw error;
    } finally {
      if (participantController.current === controller) {
        participantController.current = null;
        participantLock.current = false;
        if (mounted.current) setParticipantPending(false);
      }
    }
  }

  function saveBudget() {
    const value = Number(budgetDraft);
    if (!Number.isFinite(value) || value < 10000 || value > 10000000) {
      setBudgetError('1만 원부터 1,000만 원 사이로 입력해 주세요.');
      document.getElementById('budget-input')?.focus();
      return;
    }
    setBudgetError('');
    const nextBudget = String(Math.round(value));
    if (nextBudget !== budget) {
      setBudget(nextBudget);
      setConditionNotice('전체 예산이 바뀌었어요. 확인 후 다시 확정해 주세요.');
      if (selfStatus === 'confirmed') {
        setSelfStatus('writing');
        setActionAnnouncement('전체 예산이 변경되어 내 준비 상태를 다시 작성하도록 바뀌었어요.');
      } else {
        setActionAnnouncement('전체 예산 조건을 변경했어요.');
      }
    }
    setBudgetOpen(false);
  }

  async function retryAsync() {
    if (asyncLock.current) return;
    asyncLock.current = true;
    asyncController.current?.abort();
    const controller = new AbortController();
    asyncController.current = controller;
    setAsyncBusy(true);
    setAsyncStatus('loading');
    try {
      await waitForPreview(700, controller.signal);
      if (!mounted.current || controller.signal.aborted || asyncController.current !== controller) return;
      setAsyncStatus('empty');
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') setAsyncStatus('error');
    } finally {
      if (asyncController.current === controller) {
        asyncController.current = null;
        asyncLock.current = false;
        if (mounted.current) setAsyncBusy(false);
      }
    }
  }

  function resetExamples() {
    roomController.current?.abort();
    asyncController.current?.abort();
    participantController.current?.abort();
    roomController.current = null;
    asyncController.current = null;
    participantController.current = null;
    roomRequestLock.current = false;
    asyncLock.current = false;
    participantLock.current = false;
    requestAttempt.current = 0;
    setAttemptCount(0);
    setRoomName('가을 제천, 천천히 걷는 하루');
    setFailFirst(true);
    setSelectedId(itinerary[0].id);
    setRoomError('');
    setRoomStatus('idle');
    setRoomResult(null);
    setSuccessOpen(false);
    setSelfStatus('writing');
    setActionAnnouncement('예제를 초기화했어요.');
    setParticipantOpen(false);
    setParticipantPending(false);
    setBudget(initialBudget);
    setBudgetDraft(initialBudget);
    setBudgetError('');
    setConditionNotice('공통 조건이 변경되면 확정한 참여자도 다시 확인해야 해요.');
    setBudgetOpen(false);
    setAsyncStatus('error');
    setAsyncBusy(false);
  }

  const selectedItem = itinerary.find((item) => item.id === selectedId) ?? itinerary[0];
  const roomSubmitting = roomStatus === 'loading';

  return (
    <div className="preview-shell">
      <header className="preview-topbar">
        <a className="preview-brand" href="#top" aria-label="우왕톤 공통 UI 미리보기 상단으로"><span className="preview-brand-mark" aria-hidden="true">우</span><span>우왕톤</span></a>
        <span className="preview-product-note">충북 단체여행 플래너</span>
      </header>
      <main className="preview-main" id="top">
        <section className="preview-hero" aria-labelledby="page-title">
          <div>
            <p className="preview-eyebrow">공통 UI 컴포넌트</p>
            <h1 id="page-title">함께 정하는 여행의 모습</h1>
            <p className="preview-lead">여행 조건과 참여 상태부터 하루 일정까지, 우왕톤에서 쓰이는 공통 화면을 둘러보세요.</p>
          </div>
          <div className="preview-meta"><span className="preview-live-dot" /> 공통 UI 미리보기 <span aria-hidden="true">·</span> 예시 데이터 <span aria-hidden="true">·</span> 서버 저장 없음</div>
        </section>

        <section className="preview-section" aria-labelledby="conditions-heading">
          <div className="section-heading"><div><p className="section-index">01 · 함께 준비하기</p><h2 id="conditions-heading">공통 조건과 참여 상태</h2></div><p>모두가 보는 여행 기준과 각자의 준비 상태</p></div>
          <div className="conditions-layout">
            <ConditionCard title="이번 여행의 기준" description="함께 맞춘 여행 조건" items={[
              { label: '여행 날짜', value: '10월 18일 · 토요일' },
              { label: '출발 지역', value: '청주시 흥덕구 · 오송역 근처' },
              { label: '전체 예산', value: `${Number(budget).toLocaleString('ko-KR')}원 · 예시 추정액` },
              { label: '이동 방식', value: '자가용 2대 · 4명 함께 이동' },
            ]} notice={conditionNotice} editDisabled={roomSubmitting} onEdit={() => { setBudgetDraft(budget); setBudgetError(''); setBudgetOpen(true); }} />
            <article className="preview-panel participant-panel">
              <div className="panel-heading"><div><h3>여행 준비 상태</h3><p>참여자별 상태 예시</p></div><span className="participant-count">4명</span></div>
              <div className="participant-list">
                <ParticipantStatus name="김하늘 (나)" status={selfStatus} isSelf />
                <ParticipantStatus name="이서연" status="confirmed" />
                <ParticipantStatus name="박도윤" status="writing" />
                <ParticipantStatus name="정민주 · 일정과 맛집을 꼼꼼하게 살펴보는 중" status="confirmed" />
              </div>
              <div className="participant-actions"><Button type="button" onClick={() => { if (selfStatus !== 'confirmed' && !roomSubmitting) setParticipantOpen(true); }} disabled={roomSubmitting} aria-disabled={selfStatus === 'confirmed' || undefined}>{selfStatus === 'confirmed' ? '내 준비 완료' : '내 상태 확정'}</Button><Button type="button" variant="secondary" onClick={resetExamples}>예제 초기화</Button></div>
            </article>
          </div>
        </section>

        <section className="preview-section" aria-labelledby="itinerary-heading">
          <div className="section-heading"><div><p className="section-index">02 · 하루 일정</p><h2 id="itinerary-heading">시간 순서와 선택한 장소</h2></div><p>일정 항목을 선택하면 상세 내용이 바뀝니다.</p></div>
          <div className="itinerary-layout">
            <div>
              <ol className="itinerary-list" aria-label="시간순 여행 일정">
                {itinerary.map((item) => <li key={item.id}><ItineraryCard item={item} selected={selectedId === item.id} onSelect={setSelectedId} detailId="itinerary-detail" /></li>)}
              </ol>
              <p className="itinerary-selection" role="status" aria-live="polite">선택한 일정: {selectedItem.title}</p>
            </div>
            <ItineraryDetail item={selectedItem} id="itinerary-detail" />
          </div>
        </section>

        <section className="preview-section" aria-labelledby="states-heading">
          <div className="section-heading"><div><p className="section-index">03 · 입력과 비동기 상태</p><h2 id="states-heading">기다림, 실패, 빈 결과</h2></div><p>입력값은 유지하고 다시 시도할 수 있어요.</p></div>
          <div className="states-layout">
            <article className="preview-panel room-form-panel">
              <div className="panel-heading"><div><h3>여행 모임 만들기</h3><p>예시 요청으로 입력·오류·성공 흐름을 확인해요.</p></div><span className="mini-label">LOCAL MOCK</span></div>
              <form onSubmit={handleRoomSubmit} noValidate>
                <Input id="room-name" label="방 이름" value={roomName} onChange={(event) => changeRoomName(event.target.value)} placeholder="예: 가을 제천 나들이" hint="최대 24자까지 입력할 수 있어요." error={roomError} required maxLength={24} autoComplete="off" readOnly={roomSubmitting} />
                <label className="scenario-toggle"><input type="checkbox" checked={failFirst} onChange={(event) => { setFailFirst(event.target.checked); requestAttempt.current = 0; setAttemptCount(0); setRoomStatus('idle'); setRoomError(''); }} disabled={roomSubmitting} /><span>첫 요청은 실패하는 시나리오</span></label>
                <div className="form-actions"><Button id="room-submit" type="submit" loading={roomSubmitting} loadingLabel="확인 중…">{roomStatus === 'error' ? '같은 이름으로 다시 시도' : '여행 준비 시작'} <span aria-hidden="true">→</span></Button><span className="form-state-copy" aria-live="polite">{roomSubmitting ? '예시 요청을 처리하고 있어요.' : roomStatus === 'error' ? '입력한 이름으로 다시 시도할 수 있어요.' : '입력값은 서버에 저장되지 않아요.'} <span className="attempt-count">요청 시도 {attemptCount}회</span></span></div>
              </form>
            </article>
            <article className="preview-panel async-panel">
              <div className="panel-heading"><div><h3>일정 불러오기 상태</h3><p>다시 시도하면 빈 결과로 전환돼요.</p></div><span className="mini-label">STATE EXAMPLE</span></div>
              <div className="async-controls" role="group" aria-label="비동기 상태 예시 선택">
                <Button type="button" variant="secondary" disabled={asyncBusy} onClick={() => { asyncController.current?.abort(); setAsyncBusy(false); asyncLock.current = false; setAsyncStatus('error'); }}>오류</Button>
                <Button type="button" variant="secondary" disabled={asyncBusy} onClick={() => { asyncController.current?.abort(); setAsyncBusy(false); asyncLock.current = false; setAsyncStatus('empty'); }}>빈 결과</Button>
              </div>
              <div className="async-display" aria-live="polite">
                {asyncStatus === 'loading' ? <AsyncState status="loading" title="일정을 불러오고 있어요" description="잠시만 기다려 주세요." /> : asyncStatus === 'empty' ? <AsyncState status="empty" title="아직 정해진 일정이 없어요" description="함께 가고 싶은 장소를 추가해 보세요." /> : <AsyncState status="error" title="일정을 불러오지 못했어요" description="연결 상태를 확인하고 다시 시도해 주세요." onRetry={retryAsync} retryLabel={asyncBusy ? '다시 불러오는 중…' : '다시 시도'} />}
              </div>
            </article>
          </div>
        </section>
        <p className="preview-feedback" role="status" aria-live="polite">{actionAnnouncement}</p>
        <footer className="preview-footer"><span>우왕톤 공통 UI</span><span>여행방·일정 API에 연결되지 않은 미리보기예요.</span><Button type="button" variant="secondary" onClick={resetExamples}>전체 예제 초기화</Button></footer>
      </main>

      <Dialog open={successOpen} title="여행 모임을 준비했어요" onClose={() => setSuccessOpen(false)} onConfirm={() => setSuccessOpen(false)} confirmLabel="확인" returnFocusRef={submitButtonRef}>
        <p><strong>{roomResult?.roomName}</strong> 입력 예시가 완료됐어요.</p><div className="room-code-preview"><span>예시 참여 코드</span><strong>{roomResult?.roomCode}</strong></div><p className="dialog-footnote">실제 여행방은 만들어지지 않았고, 이 내용은 저장되지 않아요.</p>
      </Dialog>
      <Dialog open={participantOpen} title="내 준비 상태를 확정할까요?" onClose={() => { if (!participantPending) setParticipantOpen(false); }} onConfirm={confirmParticipant} confirmLabel="확정하기" pending={participantPending} cancelLabel="돌아가기">
        <p>확정하면 다른 참여자에게 준비 완료로 표시돼요. 이 미리보기에서는 화면 상태만 바뀝니다.</p>
      </Dialog>
      <Dialog open={budgetOpen} title="전체 예산 조정" onClose={() => setBudgetOpen(false)} onConfirm={saveBudget} confirmLabel="조건 적용" cancelLabel="취소">
        <form className="budget-dialog-copy" noValidate onSubmit={(event) => { event.preventDefault(); saveBudget(); }}><p>함께 여행에 사용할 전체 예산이에요. 실제 사용 금액이 아닌 예시 추정액으로 보여요.</p><Input id="budget-input" label="전체 예산 (원)" type="number" min={10000} max={10000000} step={10000} value={budgetDraft} onChange={(event) => { setBudgetDraft(event.target.value); setBudgetError(''); }} error={budgetError} required /><button hidden type="submit">조건 적용</button></form>
      </Dialog>
    </div>
  );
}
