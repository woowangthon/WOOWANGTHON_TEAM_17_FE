import { useEffect, useRef, useState, type FormEvent } from 'react';
import Button from '../../components/ui/Button';
import Dialog from '../../components/ui/Dialog';
import Input from '../../components/ui/Input';
import { submitEntry, type EntryMode, type EntryResult } from './mockRequests';

type FormValues = { tripName: string; nickname: string; inviteCode: string };
type FormState = { values: FormValues; error: string; errorField: keyof FormValues | null; status: 'idle' | 'loading' | 'error' };
const blank: FormValues = { tripName: '', nickname: '', inviteCode: '' };
const initial: Record<EntryMode, FormState> = {
  create: { values: { ...blank }, error: '', errorField: null, status: 'idle' },
  join: { values: { ...blank }, error: '', errorField: null, status: 'idle' },
};

export default function EntryPage() {
  const [forms, setForms] = useState(initial);
  const [result, setResult] = useState<EntryResult | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recent, setRecent] = useState<EntryResult[]>([]);
  const requestLocks = useRef<Record<EntryMode, boolean>>({ create: false, join: false });
  const controllers = useRef<Partial<Record<EntryMode, AbortController>>>({});
  const mounted = useRef(true);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    const activeControllers = controllers.current;
    return () => {
      mounted.current = false;
      activeControllers.create?.abort();
      activeControllers.join?.abort();
    };
  }, []);

  function update(mode: EntryMode, key: keyof FormValues, value: string) {
    setForms((current) => ({ ...current, [mode]: { ...current[mode], values: { ...current[mode].values, [key]: value }, error: '', status: 'idle' } }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>, mode: EntryMode) {
    event.preventDefault();
    if (requestLocks.current[mode]) return;
    const state = forms[mode];
    const nickname = state.values.nickname.trim();
    if (mode === 'create' && !state.values.tripName.trim()) {
      setForms((current) => ({ ...current, create: { ...current.create, error: '여행 이름을 입력해 주세요.', errorField: 'tripName' } }));
      document.getElementById('entry-trip-name')?.focus();
      return;
    }
    if (!nickname) {
      setForms((current) => ({ ...current, [mode]: { ...current[mode], error: '닉네임을 입력해 주세요.', errorField: 'nickname' } }));
      document.getElementById(mode === 'create' ? 'entry-create-nickname' : 'entry-join-nickname')?.focus();
      return;
    }
    if (mode === 'join' && !state.values.inviteCode.trim()) {
      setForms((current) => ({ ...current, join: { ...current.join, error: '초대 코드를 입력해 주세요.', errorField: 'inviteCode' } }));
      document.getElementById('entry-invite-code')?.focus();
      return;
    }
    const tooLong = mode === 'create' ? state.values.tripName.trim().length > 40 || nickname.length > 20 : state.values.inviteCode.trim().length > 24 || nickname.length > 20;
    if (tooLong) {
      setForms((current) => ({ ...current, [mode]: { ...current[mode], error: '입력 길이를 확인해 주세요. 여행 이름은 40자, 닉네임은 20자, 초대 코드는 24자 이내예요.', errorField: mode === 'create' ? (state.values.tripName.trim().length > 40 ? 'tripName' : 'nickname') : (state.values.inviteCode.trim().length > 24 ? 'inviteCode' : 'nickname') } }));
      document.getElementById(mode === 'create' ? (state.values.tripName.trim().length > 40 ? 'entry-trip-name' : 'entry-create-nickname') : (state.values.inviteCode.trim().length > 24 ? 'entry-invite-code' : 'entry-join-nickname'))?.focus();
      return;
    }

    requestLocks.current[mode] = true;
    const controller = new AbortController();
    controllers.current[mode] = controller;
    setForms((current) => ({ ...current, [mode]: { ...current[mode], status: 'loading', error: '' } }));
    try {
      const next = await submitEntry(mode, { tripName: state.values.tripName, inviteCode: state.values.inviteCode, nickname }, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      setResult(next);
      setRecent((items) => [next, ...items.filter((item) => !(item.mode === next.mode && item.tripName === next.tripName && item.nickname === next.nickname && item.code === next.code))].slice(0, 3));
      triggerRef.current = document.getElementById(mode === 'create' ? 'entry-create-submit' : 'entry-join-submit');
      setForms((current) => ({ ...current, [mode]: { ...current[mode], status: 'idle' } }));
      setDialogOpen(true);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setForms((current) => ({ ...current, [mode]: { ...current[mode], status: 'error', error: error instanceof Error ? error.message : '요청에 실패했어요. 다시 시도해 주세요.', errorField: mode === 'join' ? 'inviteCode' : null } }));
      requestAnimationFrame(() => document.getElementById(mode === 'create' ? 'entry-create-submit' : 'entry-join-submit')?.focus());
    } finally {
      if (controllers.current[mode] === controller) {
        delete controllers.current[mode];
        requestLocks.current[mode] = false;
      }
    }
  }

  const create = forms.create;
  const join = forms.join;
  return <div className="entry-shell">
    <header className="entry-topbar"><a href="#entry-top" className="entry-brand" aria-label="오삼이 시작 화면"><span>오삼이</span><span className="entry-brand-caption">충북 단체여행</span></a><p>함께 만드는 충북 여행</p></header>
    <main id="entry-top" className="entry-main">
      <section className="entry-hero" aria-labelledby="entry-title"><span className="entry-eyebrow">충북 단체여행 플래너</span><h1 id="entry-title">서로 다른 취향, 함께 맞추는 여행</h1><p>여행방을 만들거나 초대 코드로 참여해, 각자의 취향을 모아보세요.</p></section>
      <section className="entry-options" aria-label="여행 시작 방법">
        <article className="entry-card"><span className="entry-card-label">처음 계획하는 사람</span><h2>새 여행 만들기</h2><p className="entry-card-description">친구를 초대할 여행방을 먼저 만들어 주세요.</p>
          <form onSubmit={(event) => void handleSubmit(event, 'create')} noValidate>
            <Input id="entry-trip-name" label="여행방 이름" value={create.values.tripName} onChange={(event) => update('create', 'tripName', event.target.value)} placeholder="예: 단양 주말 여행" hint="최대 40자까지 입력할 수 있어요." error={create.errorField === 'tripName' ? create.error : ''} maxLength={80} autoComplete="off" readOnly={create.status === 'loading'} required />
            <Input id="entry-create-nickname" label="내 닉네임" value={create.values.nickname} onChange={(event) => update('create', 'nickname', event.target.value)} placeholder="예: 여행자 A" hint="여행에서 사용할 이름이에요. (최대 20자)" error={create.errorField === 'nickname' ? create.error : ''} maxLength={40} autoComplete="nickname" readOnly={create.status === 'loading'} required />
            <p className="entry-form-note">화면 미리보기예요. 입력은 서버에 저장되지 않아요.</p>
            <Button id="entry-create-submit" type="submit" className="entry-submit" loading={create.status === 'loading'} loadingLabel="여행방 준비 중…">여행방 만들기</Button>
          </form>
        </article>
        <article className="entry-card"><span className="entry-card-label">초대받은 사람</span><h2>초대 코드로 참여</h2><p className="entry-card-description">공유받은 코드와 여행에서 사용할 닉네임을 입력해요.</p>
          <form onSubmit={(event) => void handleSubmit(event, 'join')} noValidate>
            <Input id="entry-invite-code" label="초대 코드" value={join.values.inviteCode} onChange={(event) => update('join', 'inviteCode', event.target.value)} placeholder="예: CB-DEMO" hint="화면 미리보기 코드는 CB-DEMO예요." error={join.errorField === 'inviteCode' ? join.error : ''} maxLength={32} autoComplete="off" readOnly={join.status === 'loading'} required />
            <Input id="entry-join-nickname" label="내 닉네임" value={join.values.nickname} onChange={(event) => update('join', 'nickname', event.target.value)} placeholder="예: 여행자 B" hint="여행에서 사용할 이름이에요. (최대 20자)" error={join.errorField === 'nickname' ? join.error : ''} maxLength={40} autoComplete="nickname" readOnly={join.status === 'loading'} required />
            <p className="entry-form-note">실제 여행방 초대 코드와 연결되지 않은 화면 미리보기예요.</p>
            <Button id="entry-join-submit" type="submit" variant="secondary" className="entry-submit" loading={join.status === 'loading'} loadingLabel="참여 확인 중…">여행방 참여하기</Button>
          </form>
        </article>
      </section>
      <section className="entry-recent" aria-labelledby="entry-recent-title"><h2 id="entry-recent-title">이 기기의 최근 여행</h2><p>이 화면에서 만든 예시 기록은 현재 탭에서만 확인할 수 있어요.</p>
        {recent.length === 0 ? <div className="entry-empty"><span className="entry-empty-icon" aria-hidden="true">✳</span><p>아직 표시할 최근 여행이 없어요.</p><span>새 여행을 만들거나 초대 코드로 참여해 보세요.</span></div> : <ul className="entry-recent-list">{recent.map((item, index) => <li key={item.mode + item.nickname + index}><div><strong>{item.tripName}</strong><span>{item.nickname} · {item.mode === 'create' ? '만들기 미리보기' : '참여 미리보기'}</span></div><span className="entry-recent-badge">현재 탭의 예시 기록</span><Button type="button" variant="secondary" onClick={(event) => { triggerRef.current = event.currentTarget; setResult(item); setDialogOpen(true); }}>이어서 보기</Button></li>)}</ul>}
      </section>
      <p className="entry-privacy">내 취향·제약 원문은 본인만 확인하고, 공동 화면에는 준비 상태와 종합 조건을 표시해요.</p>
    </main>
    <Dialog open={dialogOpen} title={result?.mode === 'join' ? '여행 참여를 확인했어요' : '여행방을 준비했어요'} onClose={() => setDialogOpen(false)} onConfirm={() => setDialogOpen(false)} confirmLabel="확인" returnFocusRef={triggerRef}>
      {result && <><p className="entry-result-summary"><strong>{result.tripName}</strong> · {result.nickname}</p><div className="entry-dialog-code"><span>{result.mode === 'join' ? '입력한 데모 코드' : '예시 초대 코드'}</span><strong>{result.code}</strong></div><p className="entry-dialog-note">화면 미리보기 결과예요. 실제 여행방 생성·참여와 다음 여행 화면은 아직 연결되지 않았어요.</p></>}
    </Dialog>
  </div>;
}
