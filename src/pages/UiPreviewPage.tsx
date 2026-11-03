import { useState, type FormEvent } from 'react';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import Input from '../components/ui/Input';

export default function UiPreviewPage() {
  const [roomName, setRoomName] = useState('');
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = roomName.trim();
    if (!trimmed) {
      setError('방 이름을 입력해 주세요.');
      document.getElementById('room-name')?.focus();
      return;
    }
    if (trimmed.length > 24) {
      setError('방 이름은 24자 이내로 입력해 주세요.');
      document.getElementById('room-name')?.focus();
      return;
    }
    setError('');
    setDialogOpen(true);
  }

  return (
    <div className="page-shell">
      <header className="topbar">
          <a className="brand" href="#main" aria-label="우왕톤 홈"><span className="brand-mark" aria-hidden="true">우</span><span>우왕톤</span></a>
        <span className="topbar-note">충북 단체여행 플래너</span>
      </header>
      <main className="main" id="main">
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">UI COMPONENT PREVIEW</p>
          <h1 id="page-title">함께 떠날 준비,<br />가볍게 시작해요.</h1>
          <p>친구들과 충북 여행을 계획할 때 필요한 공통 UI를 미리 살펴보는 화면이에요. 편안한 첫 모임처럼, 여행 준비도 천천히 시작해 보세요.</p>
        </section>
        <section className="preview-card" aria-label="공통 UI 미리보기">
          <div className="form-panel">
            <p className="panel-kicker">01 · 새 여행</p>
            <h2>여행 모임 만들기</h2>
            <p className="form-description">함께 여행할 방의 이름을 정해 주세요.</p>
            <form onSubmit={handleSubmit} noValidate>
              <Input id="room-name" label="방 이름" placeholder="예: 가을 제천 나들이" value={roomName} onChange={(event) => { setRoomName(event.target.value); if (error) setError(''); }} hint="여행의 분위기가 느껴지는 이름이면 좋아요." error={error} required maxLength={24} autoComplete="off" />
              <div className="actions">
                <Button type="submit">여행 준비 시작 <span aria-hidden="true">→</span></Button>
                <span className="action-note">최대 24자까지 입력할 수 있어요.</span>
              </div>
            </form>
          </div>
          <aside className="side-panel" aria-label="여행 준비 안내">
            <div className="side-copy">
              <p className="panel-kicker">A LITTLE PLAN, A BIG TRIP</p>
              <h2>여행은 함께 정할수록 더 즐거우니까</h2>
              <p>한 사람의 계획이 아니라, 모두의 취향을 모아 우리다운 여행을 만들어요.</p>
            </div>
            <div className="steps" aria-label="여행 준비 순서">
              <div className="step"><span className="step-number">1</span><span>모임 이름과 여행 날짜 정하기</span></div>
              <div className="step"><span className="step-number">2</span><span>각자 원하는 여행 공유하기</span></div>
              <div className="step"><span className="step-number">3</span><span>다 함께 일정을 골라보기</span></div>
            </div>
          </aside>
        </section>
        <section className="button-preview" aria-labelledby="button-preview-title">
          <div>
            <p className="panel-kicker">02 · 공통 버튼</p>
            <h2 id="button-preview-title">상태에 따른 버튼 스타일</h2>
          </div>
          <div className="button-preview-items">
            <Button type="button" variant="secondary">보조 버튼</Button>
            <Button type="button" disabled>비활성 버튼</Button>
          </div>
        </section>
        <p className="footer-note">지금은 공통 UI를 확인하는 미리보기 화면입니다.</p>
      </main>
      <Dialog open={dialogOpen} title="미리보기 확인" onClose={() => setDialogOpen(false)}>
        방 이름 입력과 확인 UI 예시예요. 입력 내용은 서버에 저장되지 않습니다.
      </Dialog>
    </div>
  );
}
