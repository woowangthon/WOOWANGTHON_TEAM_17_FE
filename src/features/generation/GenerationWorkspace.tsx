import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Dialog from '../../components/ui/Dialog';
import { getPersonal, PersonalApiError } from '../room/personalApi';
import { GenerationError, createJob, getGeneration, getJob, getPlan, getSelfReview, normalizeSelf, putSelfReview, savePlan, saveSettings, searchPlaces, type GenerationState, type Job, type Plan, type Place, type SelfDto, type Settings } from './generationApi';
import { isValidWgs84 } from './mapUtils';
import { courseEdgesForPlaces, courseNodesForDay, resolveSelectedCourse, selectCourseDay, totalBudgetSummary } from './itineraryPresentation';
import ResultMap from './ResultMap';
import '../../styles/generation.css';

declare global { interface Window { kakao?: any } }
type Props = { tripId: string; tripName: string; conditionsVersion: number; expectedPeople: string; budget: string; transport: string; isOwner: boolean; startDate: string; endDate: string; onAccessLost?: () => void };
type FieldKey = 'likes' | 'avoid' | 'food';
const fieldName: Record<FieldKey, string> = { likes: '좋아하는 항목', avoid: '피하고 싶은 항목', food: '음식 조건' };
const defaultSettings: Settings = { activityWindow: { start: '09:00', end: '18:00' }, departureAnchor: null, returnAnchor: null, reviewedCommonFields: [] };
function errorText(error: unknown) { return error instanceof Error ? error.message : '요청을 완료하지 못했어요. 다시 시도해 주세요.'; }
function isAccessLost(error: unknown): boolean { return (error instanceof GenerationError || error instanceof PersonalApiError) && ([401, 403, 404].includes(error.status) || error.code === 'TRIP_CLOSED'); }
function reasonLabel(code: string) {
  const labels: Record<string, string> = { REVIEW_REQUIRED: '아직 검토가 필요한 조건이 있어요.', MEMBER_COUNT_MISMATCH: '현재 참여 인원과 예정 인원이 맞지 않아요.', COMMON_REVIEW_REQUIRED: '숙박이나 고정 일정 장소를 확인해 주세요.', PREFERENCES_UNCONFIRMED: '모든 참여자의 조건 확인이 필요해요.', DEPARTURE_UNRESOLVED: '출발 위치를 지도 좌표로 정해 주세요.', RETURN_UNRESOLVED: '복귀 위치를 지도 좌표로 정해 주세요.', LODGING_REVIEW_REQUIRED: '숙박 장소와 일정을 확인해 주세요.', FIXED_SCHEDULE_REVIEW_REQUIRED: '고정 일정 장소와 시간을 확인해 주세요.', CONDITIONS_INCOMPLETE: '공통 여행 조건을 모두 입력해 주세요.' };
  return labels[code] ?? '일정 생성에 필요한 조건을 확인해 주세요.';
}
function validationLabel(code: string) {
  const labels: Record<string, string> = { WALKING_LIMIT_EXCEEDED: '걷기 가능 시간을 초과했어요.', ACTIVITY_WINDOW_EXCEEDED: '활동 시간 범위를 벗어났어요.', PLACE_CLOSED_AT_VISIT: '방문 시간에 영업하지 않는 장소가 있어요.', KNOWN_COST_EXCEEDS_BUDGET: '확인된 금액이 예산을 초과했어요.', FIXED_DEADLINE_MISSED: '고정 일정 도착 마감을 지키기 어려워요.', FIXED_START_MISSED: '고정 일정 시작 시간을 지키기 어려워요.', FIXED_END_MISSED: '고정 일정 종료 시간을 지키기 어려워요.' };
  return labels[code] ?? '일정 조건을 다시 확인해 주세요.';
}
function warningLabel(code: string) {
  const labels: Record<string, string> = {
    OTHER_TRAVEL_EXPENSES_UNKNOWN: '전체 식비·유류비·주차비 등 추가 비용은 확인되지 않았어요.',
    ROUTE_NOT_CONFIGURED: '경로 확인 서비스가 설정되지 않아 이동 경로를 확인하지 못했어요.', ROUTE_UNAVAILABLE: '경로 확인에 실패해 이동 경로를 확인하지 못했어요.', ROUTE_TIMEOUT: '경로 확인 시간이 초과되어 이동 경로를 확인하지 못했어요.', ROUTE_RATE_LIMITED: '경로 서비스 요청이 많아 이동 경로를 확인하지 못했어요.', ROUTE_MODE_UNSUPPORTED: '이 이동수단의 경로를 확인할 수 없어요.', ROUTE_UNVERIFIED: '이동 경로를 확인하지 못했어요.',
    WALKING_ROUTE_UNKNOWN: '도보 이동 시간을 확인하지 못했어요.', WALKING_UNVERIFIED: '도보 이동 시간을 확인하지 못했어요.',
    OPENING_HOURS_UNKNOWN: '장소 영업시간을 확인하지 못했어요.', OPENING_HOURS_UNVERIFIED: '장소 영업시간을 확인하지 못했어요.', STAY_DURATION_UNKNOWN: '장소별 체류 시간을 확인하지 못했어요.', PLACE_COST_UNKNOWN: '장소 이용 비용을 확인하지 못했어요.',
    DEPARTURE_UNRESOLVED: '출발 위치를 지도 좌표로 확인하지 못했어요.', RETURN_UNRESOLVED: '복귀 위치를 지도 좌표로 확인하지 못했어요.', FIXED_TIME_UNVERIFIED: '고정 일정 시간을 확인하지 못했어요.', ARRIVAL_TIME_UNKNOWN: '도착 시간을 확인하지 못했어요.', OVERNIGHT_ARRIVAL_UNKNOWN: '밤샘 이동 도착 시간을 확인하지 못했어요.',
  };
  return labels[code] ?? '일정 일부의 정보가 확인되지 않았어요.';
}
function polarityLabel(value: string) { return value === 'prefer' ? '선호' : value === 'avoid' ? '피하기' : '미분류'; }
function importanceLabel(value: string) { return value === 'required' ? '필수' : value === 'preferred' ? '선호' : '미분류'; }

export function PersonalReviewPanel({ tripId, conditionsVersion, onReviewed, onAccessLost }: { tripId: string; conditionsVersion: number; onReviewed?: () => void; onAccessLost?: () => void }) {
  const [dto, setDto] = useState<SelfDto | null>(null);
  const [sourceConfirmed, setSourceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [accepted, setAccepted] = useState<string[]>([]);
  const [fieldReview, setFieldReview] = useState<Record<FieldKey, { scope: 'all' | 'meal' | 'stay'; fully: boolean }>>({
    likes: { scope: 'all', fully: false }, avoid: { scope: 'all', fully: false }, food: { scope: 'meal', fully: false },
  });
  const [loading, setLoading] = useState(true);
  const epoch = useRef(0); const ctrl = useRef<AbortController | null>(null); const lock = useRef(false);
  const onAccessLostRef = useRef<(() => void) | undefined>(undefined);
  onAccessLostRef.current = onAccessLost;
  const clearPrivateState = useCallback(() => {
    epoch.current += 1; ctrl.current?.abort(); ctrl.current = null; lock.current = false;
    setBusy(false); setDto(null); setAccepted([]); setSourceConfirmed(false); setMessage('');
    onAccessLostRef.current?.();
  }, []);
  const refresh = useCallback(async () => {
    ctrl.current?.abort(); lock.current = false; setBusy(false); const own = ++epoch.current; const ac = new AbortController(); ctrl.current = ac; setLoading(true);
    try { const personal = await getPersonal(tripId, ac.signal); const next = await getSelfReview(tripId, ac.signal).catch((error: unknown) => { if (error instanceof GenerationError && error.code === 'PREFERENCES_UNCONFIRMED') return { conditionsVersion: personal.conditionsVersion, preferenceVersion: personal.preferenceVersion, catalogDigest: '', normalization: null, reviewVersion: 0, review: null, stale: false } satisfies SelfDto; throw error; }); if (own !== epoch.current) return; setDto(next); setFieldReview({ likes: { scope: 'all', fully: false }, avoid: { scope: 'all', fully: false }, food: { scope: 'meal', fully: false } }); setAccepted(next.review?.acceptedTermIds ?? []); setSourceConfirmed(personal.confirmation.status === 'confirmed' && personal.confirmation.confirmedConditionsVersion === conditionsVersion && personal.confirmation.confirmedPreferenceVersion === personal.preferenceVersion); }
    catch (error) { if (own === epoch.current && !ac.signal.aborted) { if (isAccessLost(error)) { clearPrivateState(); return; } setMessage(errorText(error)); } }
    finally { if (own === epoch.current) setLoading(false); }
  }, [clearPrivateState, conditionsVersion, tripId]);
  useEffect(() => { void refresh(); return () => { epoch.current += 1; ctrl.current?.abort(); ctrl.current = null; lock.current = false; setBusy(false); }; }, [refresh]);
  const normalize = async () => {
    if (lock.current || !dto) return; lock.current = true; setBusy(true); ctrl.current?.abort(); const own = ++epoch.current; const ac = new AbortController(); ctrl.current = ac;
    try { const next = await normalizeSelf(tripId, conditionsVersion, dto.preferenceVersion, ac.signal); if (own === epoch.current) { setDto(next); setFieldReview({ likes: { scope: 'all', fully: false }, avoid: { scope: 'all', fully: false }, food: { scope: 'meal', fully: false } }); setAccepted([]); setMessage('해석을 검토해 주세요. 제안은 저장되거나 확정되지 않았어요.'); } }
    catch (error) { if (own === epoch.current) { if (isAccessLost(error)) clearPrivateState(); else setMessage(errorText(error)); } }
    finally { if (own === epoch.current) { lock.current = false; setBusy(false); } }
  };
  const submitReview = async () => {
    if (!dto?.normalization || lock.current) return;
    const reviewedFields = (['likes', 'avoid', 'food'] as FieldKey[]).filter((field) => dto.normalization?.terms.some((t) => t.field === field)).map((field) => ({ field, termIds: dto.normalization!.terms.filter((t) => t.field === field && accepted.includes(t.id)).map((t) => t.id), scope: fieldReview[field].scope, fullyReviewed: fieldReview[field].fully }));
    if (reviewedFields.some((field) => field.termIds.length > 0 && !field.fullyReviewed)) { setMessage('선택한 각 항목의 의미 전체를 확인해 주세요.'); return; }
    lock.current = true; setBusy(true); ctrl.current?.abort(); const own = ++epoch.current; const ac = new AbortController(); ctrl.current = ac;
    try { const next = await putSelfReview(tripId, { normalizationId: dto.normalization.id, expectedReviewVersion: dto.reviewVersion, acceptedTermIds: accepted, reviewedFields }, ac.signal); if (own === epoch.current) { setDto(next); onReviewed?.(); setMessage('내 조건 검토를 저장했어요. 일정 생성에는 본인만의 검토 상태로 반영돼요.'); } }
    catch (error) { if (own === epoch.current) { if (isAccessLost(error)) clearPrivateState(); else setMessage(errorText(error)); } }
    finally { if (own === epoch.current) { lock.current = false; setBusy(false); } }
  };
  const normalization = dto?.normalization;
  return <section className="generation-card personal-review" aria-labelledby="private-review-title">
    <div className="generation-card-heading"><div><h2 id="private-review-title">내 일정 조건 확인</h2><p>개인 조건과 해석 근거는 본인에게만 보여요.</p></div><span className="private-label">나만 보기</span></div>
    {loading ? <p role="status">개인 조건 검토 상태를 불러오고 있어요.</p> : !dto ? <div className="generation-error" role="alert"><p>{message || '개인 조건을 불러오지 못했어요.'}</p><Button variant="secondary" onClick={() => void refresh()}>다시 시도</Button></div> : <>
      <p className="generation-private-status">{dto.stale || dto.conditionsVersion !== conditionsVersion ? '공통 조건이 바뀌어 다시 확인해야 해요.' : dto.review ? '본인 검토가 저장되어 있어요.' : '원문을 일정에 반영하기 전에 AI 해석을 검토해 주세요.'}</p>
      <Button onClick={() => void normalize()} disabled={busy || dto.conditionsVersion !== conditionsVersion || !sourceConfirmed}>{busy ? '처리 중…' : '내 확정 조건 다시 해석'}</Button>
      {!sourceConfirmed && <p className="review-prerequisite">개인 조건 탭에서 현재 조건을 먼저 저장하고 직접 확정해 주세요. 해석 결과는 별도 검토 후에만 저장됩니다.</p>}
      {normalization && <div className="generation-review-content">
        <p>해석 결과를 검토하고 필요한 항목을 선택해 주세요. 미분류 조건은 원문을 직접 수정해야 해요.</p>
        {(['likes', 'avoid', 'food'] as FieldKey[]).map((field) => {
          const terms = normalization.terms.filter((term) => term.field === field);
          if (!terms.length) return null;
          return <fieldset className="review-field" key={field}><legend>{fieldName[field]}</legend>
            {terms.map((term) => <label className="review-term" key={term.id}><input type="checkbox" checked={accepted.includes(term.id)} onChange={(event) => setAccepted((value) => event.target.checked ? [...new Set([...value, term.id])] : value.filter((id) => id !== term.id))} /><span><strong>{term.tag}</strong><small>{polarityLabel(term.polarity)} · {importanceLabel(term.importance)} · 근거: {term.evidence}</small></span></label>)}
            <label className="review-scope">적용 범위 <select value={fieldReview[field].scope} onChange={(event) => setFieldReview((value) => ({ ...value, [field]: { ...value[field], scope: event.target.value as 'all' | 'meal' | 'stay' } }))}><option value="all">여행 전체</option><option value="meal">식사</option><option value="stay">숙박</option></select></label>
            <label className="review-meaning"><input type="checkbox" checked={fieldReview[field].fully} onChange={(event) => setFieldReview((value) => ({ ...value, [field]: { ...value[field], fully: event.target.checked } }))} /> 이 항목의 전체 의미와 적용 범위를 확인했어요.</label>
          </fieldset>;
        })}
        {normalization.unmapped.some((item) => item.reason === 'uncovered') && <div className="unmapped-list"><h3>직접 다시 정리해야 하는 내용</h3><p>아래 내용은 자동으로 적용되지 않아요. 왼쪽 ‘내 취향·제약’ 화면에서 원문을 수정한 뒤 다시 확정해 주세요.</p><ul>{normalization.unmapped.filter((item) => item.reason === 'uncovered').map((item, index) => <li key={`${item.field}-${index}`}><strong>{item.field}</strong> · {item.text}</li>)}</ul></div>}
        {normalization.walking && <p>걷기: {normalization.walking.unlimited ? '제한 없음' : normalization.walking.maxMinutes ? `한 번에 최대 ${normalization.walking.maxMinutes}분` : '확인 필요'}</p>}
        <Button onClick={() => void submitReview()} disabled={busy || dto.stale || dto.conditionsVersion !== conditionsVersion}>검토 내용 저장</Button>
      </div>}
      {message && <p className="generation-message" role="status">{message}</p>}
    </>}
  </section>;
}

export default function GenerationWorkspace({ tripId, tripName, conditionsVersion, expectedPeople, budget, transport, isOwner, startDate, endDate, onAccessLost }: Props) {
  const [data, setData] = useState<GenerationState | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [settings, setSettings] = useState<Settings>(defaultSettings); const [settingsChanged, setSettingsChanged] = useState(false);
  const settingsChangedRef = useRef(false);
  const markSettingsChanged = () => { settingsChangedRef.current = true; setSettingsChanged(true); };
  const [plan, setPlan] = useState<Plan | null>(null); const [job, setJob] = useState<Job | null>(null); const [query, setQuery] = useState(''); const [places, setPlaces] = useState<Place[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null); const [ackUnverified, setAckUnverified] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [validationOpen, setValidationOpen] = useState(false); const [activeDate, setActiveDate] = useState<string | null>(null);
  const changeSelection = useCallback((id: string) => setSelectedId(id), []);
  const epoch = useRef(0); const actionEpoch = useRef(0); const ctrl = useRef<AbortController | null>(null); const jobKey = useRef<string | null>(null); const lock = useRef(false);
  const pollEpoch = useRef(0); const pollController = useRef<AbortController | null>(null); const pollLock = useRef(false);
  const searchEpoch = useRef(0); const searchController = useRef<AbortController | null>(null);
  const onAccessLostRef = useRef<(() => void) | undefined>(undefined); onAccessLostRef.current = onAccessLost;
  const clearPrivateState = useCallback(() => {
    epoch.current += 1; actionEpoch.current += 1; pollEpoch.current += 1;
    ctrl.current?.abort(); ctrl.current = null; pollController.current?.abort(); pollController.current = null; searchController.current?.abort(); searchController.current = null; searchEpoch.current += 1;
    lock.current = false; pollLock.current = false; jobKey.current = null;
    settingsChangedRef.current = false; setBusy(false); setLoading(false); setData(null); setPlan(null); setJob(null);
    setSettings(defaultSettings); setSettingsChanged(false); setPlaces([]); setQuery(''); setMessage('');
    onAccessLostRef.current?.();
  }, []);
  const reload = useCallback(async () => {
    ctrl.current?.abort(); const own = ++epoch.current; actionEpoch.current += 1; lock.current = false; setBusy(false); const ac = new AbortController(); ctrl.current = ac; setLoading(true);
    try { const next = await getGeneration(tripId, ac.signal); if (own !== epoch.current) return; setData(next); if (!settingsChangedRef.current) { setSettingsChanged(false); setSettings(next.settings); } setJob(next.latestJob); if (next.latestPlan) { const loaded = await getPlan(tripId, next.latestPlan.planId, ac.signal); if (own === epoch.current) { setPlan(loaded); setSelectedId((current) => current ?? loaded.document.days[0]?.nodes[0]?.id ?? null); } } else if (own === epoch.current) setPlan(null); }
    catch (error) { if (own === epoch.current && !ac.signal.aborted) { if (isAccessLost(error)) clearPrivateState(); else setMessage(errorText(error)); } }
    finally { if (own === epoch.current) setLoading(false); }
  }, [clearPrivateState, tripId]);
  useEffect(() => { void reload(); return () => { epoch.current += 1; actionEpoch.current += 1; ctrl.current?.abort(); pollEpoch.current += 1; pollController.current?.abort(); searchEpoch.current += 1; searchController.current?.abort(); lock.current = false; pollLock.current = false; }; }, [conditionsVersion, reload]);
  useEffect(() => {
    if (!job || (job.status !== 'QUEUED' && job.status !== 'RUNNING')) return;
    let stopped = false; let inFlight = false; let attempts = 0; let timer = 0;
    const own = ++pollEpoch.current; const abort = new AbortController(); pollController.current?.abort(); pollController.current = abort;
    const stop = () => { stopped = true; window.clearInterval(timer); abort.abort(); if (pollController.current === abort) pollController.current = null; };
    const poll = async () => {
      if (stopped || inFlight) return;
      if (attempts >= 90) { setMessage('일정 생성이 계속 진행 중이에요. 잠시 후 새로고침해 주세요.'); stop(); return; }
      attempts += 1; inFlight = true; pollLock.current = true;
      try {
        const latest = await getJob(tripId, job.id, abort.signal);
        if (stopped || abort.signal.aborted || own !== pollEpoch.current) return;
        if (latest.status === 'SUCCEEDED' || latest.status === 'FAILED' || latest.status === 'STALE') {
          window.clearInterval(timer);
          if (latest.planId && latest.status === 'SUCCEEDED') {
            const loaded = await getPlan(tripId, latest.planId, abort.signal);
            if (stopped || abort.signal.aborted || own !== pollEpoch.current) return;
            setPlan(loaded);
          }
          if (!stopped && own === pollEpoch.current) { setJob(latest); void reload(); }
        } else setJob(latest);
      } catch (error) {
        if (!stopped && !abort.signal.aborted && own === pollEpoch.current) {
          if (isAccessLost(error)) clearPrivateState(); else setMessage(errorText(error));
        }
      } finally { inFlight = false; pollLock.current = false; }
    };
    timer = window.setInterval(() => void poll(), 2200); void poll();
    return () => { stop(); pollEpoch.current += 1; pollLock.current = false; };
  }, [clearPrivateState, job?.id, job?.status, reload, tripId]);
  const updateLocation = (key: 'departureAnchor' | 'returnAnchor', field: 'label' | 'latitude' | 'longitude', value: string) => setSettings((current) => { const old = current[key] ?? { label: '', coordinate: { latitude: Number.NaN, longitude: Number.NaN, crs: 'WGS84' as const } }; const next = field === 'label' ? { ...old, label: value } : { ...old, coordinate: { ...old.coordinate, [field]: value === '' ? Number.NaN : Number(value) } }; return { ...current, [key]: next }; });
  const runSearch = async () => { if (!query.trim()) { setPlaces([]); return; } searchController.current?.abort(); const own = ++searchEpoch.current; const ac = new AbortController(); searchController.current = ac; try { const result = await searchPlaces(tripId, query.trim(), ac.signal); if (own === searchEpoch.current) { setPlaces(result.places); setMessage(''); } } catch (error) { if (own === searchEpoch.current && !ac.signal.aborted) { if (isAccessLost(error)) clearPrivateState(); else setMessage(errorText(error)); } } };
  const setCommonAnchor = (field: 'lodging' | 'fixedSchedule', place: Place) => {
    const date = field === 'fixedSchedule' ? startDate : endDate || startDate;
    if (!date) { setMessage('여행 날짜를 먼저 입력해 주세요.'); return; }
    const all = settings.reviewedCommonFields.flatMap((x) => x.anchors); const existing = settings.reviewedCommonFields.find((x) => x.field === field);
    if (all.length >= 64 || (existing?.anchors.filter((x) => x.date === date).length ?? 0) >= 8) { setMessage('기준점은 전체 64개, 하루 8개까지 추가할 수 있어요.'); return; }
    if (existing?.anchors.some((x) => x.date === date && x.contentid === place.contentid)) { setMessage('같은 장소가 같은 날짜에 이미 있어요.'); return; }
    const anchor = { date, contentid: place.contentid, position: existing?.anchors.length ?? 0, startTime: null, endTime: null, arrivalDeadline: null, stayMinutes: field === 'lodging' ? 480 : null }; const rest = settings.reviewedCommonFields.filter((x) => x.field !== field);
    setSettings({ ...settings, reviewedCommonFields: [...rest, { field, reviewed: true, anchors: [...(existing?.anchors ?? []), anchor] }] });
  };
  const saveConfig = async () => { if (!data || lock.current) return; if (settings.activityWindow.end <= settings.activityWindow.start) { setMessage('활동 종료 시간은 시작 시간보다 늦게 설정해 주세요.'); return; } if ([settings.departureAnchor, settings.returnAnchor].some((location) => location && (!location.label.trim() || !isValidWgs84(location.coordinate)))) { setMessage('출발·복귀 위치 이름과 유효한 WGS84 좌표를 모두 확인해 주세요.'); return; } lock.current = true; setBusy(true); const own = ++actionEpoch.current; const ac = new AbortController(); ctrl.current?.abort(); ctrl.current = ac;
    try { const saved = await saveSettings(tripId, data.conditionsVersion, data.settingsVersion, settings, ac.signal); if (own !== actionEpoch.current || ac.signal.aborted) return; setData((old) => old ? { ...old, settings: saved.settings, settingsVersion: saved.settingsVersion, conditionsVersion: saved.conditionsVersion } : old); setSettings(saved.settings); settingsChangedRef.current = false; setSettingsChanged(false); setMessage('생성 설정을 저장했어요.'); void reload(); }
    catch (error) { if (own === actionEpoch.current && !ac.signal.aborted) { if (isAccessLost(error)) clearPrivateState(); else { setMessage(errorText(error)); if (error instanceof GenerationError && error.status === 409) void reload(); } } }
    finally { if (own === actionEpoch.current) { lock.current = false; setBusy(false); } }
  };
  const startGeneration = async () => { if (!data || lock.current || !data.readyForGeneration || !isOwner) return; lock.current = true; setBusy(true); const own = ++actionEpoch.current; const ac = new AbortController(); ctrl.current?.abort(); ctrl.current = ac; jobKey.current ??= crypto.randomUUID();
    try { const created = await createJob(tripId, data.inputToken, data.settingsVersion, jobKey.current, ac.signal); if (own !== actionEpoch.current || ac.signal.aborted) return; jobKey.current = null; setJob(created); setMessage('일정 생성을 시작했어요. 진행 상태를 확인하고 있어요.'); }
    catch (error) { if (own === actionEpoch.current && !ac.signal.aborted) { if (isAccessLost(error)) clearPrivateState(); else { setMessage(errorText(error)); if (error instanceof GenerationError && error.status >= 400 && error.status < 500) jobKey.current = null; } } }
    finally { if (own === actionEpoch.current) { lock.current = false; setBusy(false); } }
  };
  const saveCurrentPlan = async () => { if (!plan || !plan.canSave || lock.current) return; lock.current = true; setBusy(true); const own = ++actionEpoch.current; const ac = new AbortController(); ctrl.current?.abort(); ctrl.current = ac; try { const saved = await savePlan(tripId, plan, ackUnverified, ac.signal); if (own !== actionEpoch.current || ac.signal.aborted) return; setPlan(saved); setMessage('일정을 저장했어요.'); void reload(); } catch (error) { if (own === actionEpoch.current && !ac.signal.aborted) { if (isAccessLost(error)) clearPrivateState(); else { setMessage(errorText(error)); if (error instanceof GenerationError && error.status === 409) void reload(); } } } finally { if (own === actionEpoch.current) { lock.current = false; setBusy(false); } } };
  const activeDay = useMemo(() => selectCourseDay(plan?.document.days ?? [], activeDate), [activeDate, plan]);
  const courseNodes = useMemo(() => courseNodesForDay(activeDay), [activeDay]);
  const courseEdges = useMemo(() => courseEdgesForPlaces(activeDay, courseNodes), [activeDay, courseNodes]);
  const selected = useMemo(() => resolveSelectedCourse(courseNodes, selectedId), [courseNodes, selectedId]);
  const reasons = data?.reasons.map((reason) => reason.code) ?? [];
  const displayTransport = ({ car: '자가용', transit: '대중교통', charter: '전세버스', walk: '도보', undecided: '이동수단 미정' } as Record<string, string>)[transport] ?? (transport || '이동수단 미정');
  const expectedPeopleLabel = expectedPeople ? `${expectedPeople}명` : '인원 미정';
  const budgetValue = /^\d+$/u.test(budget) ? Number(budget) : null;
  const costSummary = plan ? totalBudgetSummary(plan.document.validation.totalCostKrw, budgetValue) : null;
  const costAmount = costSummary?.amount === null || costSummary?.amount === undefined ? costSummary?.label : `${costSummary.label} ${costSummary.amount.toLocaleString('ko-KR')}원`;
  const costRemainder = costSummary?.remainder === null || costSummary?.remainder === undefined ? budgetValue === null ? '예산 미정' : `예산 ${budgetValue.toLocaleString('ko-KR')}원 / 잔액 확인 필요` : costSummary.remainder >= 0 ? `예산 ${budgetValue!.toLocaleString('ko-KR')}원 / ${costSummary.remainder.toLocaleString('ko-KR')}원 여유` : `예산 ${budgetValue!.toLocaleString('ko-KR')}원 / ${Math.abs(costSummary.remainder).toLocaleString('ko-KR')}원 초과`;
  const resultDateSummary = plan?.document.days.length ? `${plan.document.days[0].date.replaceAll('-', '.')} – ${plan.document.days.at(-1)!.date.replaceAll('-', '.')}` : startDate && endDate ? `${startDate.replaceAll('-', '.')} – ${endDate.replaceAll('-', '.')}` : '여행 날짜 미정';
  const titleRef = useRef<HTMLHeadingElement>(null);
  const validationButtonRef = useRef<HTMLButtonElement>(null);
  const preparationRef = useRef<HTMLDetailsElement>(null);
  const preparationSummaryRef = useRef<HTMLElement>(null);
  useEffect(() => { titleRef.current?.focus(); window.scrollTo({ top: 0, behavior: 'auto' }); }, []);
  function changeDay(date: string) {
    const day = selectCourseDay(plan?.document.days ?? [], date);
    setActiveDate(day?.date ?? null);
    const firstCourse = resolveSelectedCourse(courseNodesForDay(day), null);
    setSelectedId(firstCourse?.id ?? null);
  }

  function openSettings() {
    setSettingsOpen(true);
    requestAnimationFrame(() => {
      preparationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      preparationSummaryRef.current?.focus();
    });
  }

  return <div className="generation-workspace">
    <header className="itinerary-header">
      <div className="itinerary-heading-copy"><p className="room-eyebrow">03 ITINERARY</p><h1 ref={titleRef} tabIndex={-1}>{tripName || '함께 만드는 여행 일정'}</h1><p>{resultDateSummary} · {expectedPeopleLabel} · {displayTransport}</p></div>
      <div className="itinerary-header-actions">
        {plan && <span className={`generation-status ${plan.stale ? 'is-stale' : plan.status === 'SAVED' ? 'is-ready' : ''}`}>{plan.status === 'SAVED' && plan.versionNo !== null ? `v${plan.versionNo}` : '초안'} · {plan.stale ? '재확인 필요' : plan.status === 'SAVED' ? '저장됨' : '저장 전'}</span>}
        <Button variant="secondary" disabled title="변경 이력 화면은 준비 중이에요.">변경 이력</Button>
        <Button variant="primary" onClick={openSettings}>일정 설정</Button>
      </div>
    </header>
    {loading && <p role="status">생성 설정과 최신 일정을 불러오고 있어요.</p>}
    {message && <p className="generation-message" role="status">{message}</p>}
    {!data && !loading && message && <Button variant="secondary" onClick={() => void reload()}>일정 정보를 다시 불러오기</Button>}

    {plan && <section className="itinerary-cost-strip" aria-label="여행 예상 비용">
      <strong>{costAmount}</strong><span className={costSummary?.remainder != null && costSummary.remainder < 0 ? 'is-cost-over-budget' : costSummary?.remainder == null ? 'is-cost-unknown' : undefined}>{costRemainder}</span>
      <span className={plan.document.validation.status === 'verified' ? undefined : 'is-cost-unknown'}>{plan.document.validation.status === 'verified' ? '일정 검사 완료' : plan.document.validation.status === 'violated' ? '해결할 일정 문제가 있어요' : '일부 정보 확인 필요'}</span>
      <button ref={validationButtonRef} type="button" className="btn btn-secondary" onClick={() => setValidationOpen(true)}>검사 내역</button>
    </section>}

    {job && !plan && <section className="generation-card" aria-live="polite"><h2>{job.status === 'QUEUED' ? '일정 생성 대기 중' : job.status === 'RUNNING' ? '여행 코스를 만들고 있어요' : job.status === 'STALE' ? '조건이 바뀌어 다시 확인이 필요해요' : '일정 초안을 만들지 못했어요'}</h2><p>{job.status === 'FAILED' ? '일정 준비·설정에서 다시 시도해 주세요.' : '완료되면 이 화면에 여행 코스가 표시돼요.'}</p><Button variant="secondary" onClick={() => void reload()} disabled={loading}>상태 새로고침</Button></section>}

    {plan && <section className="generation-card itinerary-result-card" aria-labelledby="course-heading">
      <div className="itinerary-result-header"><div><h2 id="course-heading">여행 코스</h2><p>방문할 장소를 날짜별로 확인해 보세요.</p></div><div className="generation-actions"><Button variant="secondary" disabled title="코스 직접 수정은 준비 중이에요.">일정 수정</Button>{plan.status === 'SAVED' && <span className="saved-plan-note">저장된 일정 · 버전 {plan.versionNo ?? 1}{plan.stale ? ' · 현재 조건과 달라 다시 확인해 주세요.' : ''}</span>}</div></div>
      <div className="itinerary-course-layout">
        <div className="itinerary-days">
        {plan.document.days.length > 0 && <div className="itinerary-day-tabs" role="group" aria-label="여행 날짜">
          {plan.document.days.map((day, index) => <button key={day.date} type="button" aria-pressed={day.date === activeDay?.date} onClick={() => changeDay(day.date)}>{index + 1}일차 · {day.date.slice(5).replace('-', '/')}</button>)}
        </div>}
          {activeDay && <section className="itinerary-day"><h3>{(plan.document.days.findIndex((day) => day.date === activeDay.date) + 1)}일차 · {activeDay.date.slice(5).replace('-', '/')}</h3><p>{courseNodes.length ? `여행 코스 ${courseNodes.length}곳` : '아직 등록된 여행 코스가 없어요.'}</p>
              {courseNodes.length > 0 ? <ol className="itinerary-stops">{courseNodes.map((node, index) => <li key={node.id}>
                <button type="button" className={`itinerary-stop ${node.id === selected?.id ? 'is-selected' : ''}`} aria-pressed={node.id === selected?.id} aria-controls="selected-course-detail" onClick={() => changeSelection(node.id)}>
                  <time>{node.estimatedStartAt ? new Date(node.estimatedStartAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }) : '시간 미정'}</time><span className="itinerary-stop-copy"><strong>{node.title}</strong><small>{node.stayMinutes ? `${node.stayMinutes}분` : '체류 시간 미정'}{node.estimatedCostKrw === null ? ' · 비용 미정' : ` · ${node.estimatedCostKrw.toLocaleString('ko-KR')}원`}</small></span>
                </button>{index < courseNodes.length - 1 && <div className="itinerary-stop-connector" aria-hidden="true">↓ 이동 정보 확인 필요</div>}
              </li>)}</ol> : <p className="itinerary-empty">이 날짜에는 표시할 여행 장소가 없어요.</p>}
          </section>}
            {!activeDay && <p className="itinerary-empty">표시할 여행 일정이 없어요.</p>}
        </div>
        <div className="itinerary-course-side">{activeDay && <ResultMap nodes={courseNodes} edges={courseEdges} selectedId={selected?.id ?? null} onSelect={changeSelection} />}
            {selected && <section className="itinerary-stop-detail" id="selected-course-detail" aria-labelledby="selected-course-heading"><div className="itinerary-stop-photo" aria-hidden="true">장소 정보</div><div><p className="room-eyebrow">{courseNodes.findIndex((node) => node.id === selected.id) + 1}번째 코스</p><h3 id="selected-course-heading">{selected.title}</h3><p>{selected.estimatedStartAt ? new Date(selected.estimatedStartAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' }) : '시간 미정'} · 체류 {selected.stayMinutes ? `${selected.stayMinutes}분` : '시간 미정'}</p><p>{selected.feeLabel || '장소 비용 정보가 없어요.'}</p>{selected.openingHoursText && <p>영업시간 {selected.openingHoursText}</p>}</div></section>}
      </div>
      </div>
      {isOwner && plan.status === 'DRAFT' && <div className="generation-actions plan-save"><label className="ack-checkbox"><input type="checkbox" checked={ackUnverified} onChange={(event) => setAckUnverified(event.target.checked)} /> 검증되지 않은 항목을 확인했고 이 초안을 저장할게요.</label><Button onClick={() => void saveCurrentPlan()} disabled={busy || !plan.canSave || (plan.document.validation.warnings.length > 0 && !ackUnverified) || plan.document.validation.violations.length > 0}>일정 저장</Button><small>{plan.stale ? '조건이 변경되어 이 일정은 오래된 상태예요.' : plan.document.validation.violations.length ? '일정 위반이 해결되어야 저장할 수 있어요.' : '방장이 확인 후 직접 저장해요.'}</small></div>}
    </section>}

    <details ref={preparationRef} className="itinerary-preparation" open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}>
      <summary ref={preparationSummaryRef}>일정 준비·설정 {data && `· 공통 조건 v${data.conditionsVersion} / 설정 v${data.settingsVersion}`}</summary>
      {data && <>
        <section className="generation-card"><div className="generation-card-heading"><div><h2>참여자 조건 검토</h2><p>개인 원문은 본인에게만 표시돼요.</p></div><Button variant="secondary" onClick={() => void reload()} disabled={loading}>새로고침</Button></div><div className="review-members">{data.reviewMembers.map((member) => <span key={member.id} className={`review-member status-${member.status}`}>{member.nickname} · {member.status === 'reviewed' ? '조건 검토 완료' : member.status === 'stale' ? '다시 확인 필요' : '검토 필요'}</span>)}</div>{reasons.length > 0 && <ul className="generation-reasons">{reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reasonLabel(reason)}</li>)}</ul>}</section>
        <PersonalReviewPanel tripId={tripId} conditionsVersion={conditionsVersion} onReviewed={() => void reload()} onAccessLost={onAccessLost} />
        <section className="generation-card"><div className="generation-card-heading"><div><h2>여행 코스 생성 조건</h2><p>활동 시간과 복귀 기준, 숙박·고정 일정을 확인해 주세요.</p></div><span className="generation-setting-version">공통 조건 v{data.conditionsVersion} · 설정 v{data.settingsVersion}</span></div>
          <div className="generation-settings-grid"><Input id="activity-start" label="활동 시작 시간" type="time" value={settings.activityWindow.start} onChange={(event) => { setSettings((current) => ({ ...current, activityWindow: { ...current.activityWindow, start: event.target.value } })); markSettingsChanged(); }} /><Input id="activity-end" label="활동 종료 시간" type="time" value={settings.activityWindow.end} onChange={(event) => { setSettings((current) => ({ ...current, activityWindow: { ...current.activityWindow, end: event.target.value } })); markSettingsChanged(); }} />
            <fieldset className="location-editor"><legend>복귀 위치 (생성 기준)</legend><Input id="returnAnchor-label" label="표시 이름" value={settings.returnAnchor?.label ?? ''} onChange={(event) => { updateLocation('returnAnchor', 'label', event.target.value); markSettingsChanged(); }} maxLength={100} /><div className="coordinate-inputs"><Input id="returnAnchor-lat" label="위도" type="number" min={-90} max={90} step="any" value={settings.returnAnchor?.coordinate.latitude ?? ''} onChange={(event) => { updateLocation('returnAnchor', 'latitude', event.target.value); markSettingsChanged(); }} /><Input id="returnAnchor-lng" label="경도" type="number" min={-180} max={180} step="any" value={settings.returnAnchor?.coordinate.longitude ?? ''} onChange={(event) => { updateLocation('returnAnchor', 'longitude', event.target.value); markSettingsChanged(); }} /></div></fieldset>
          </div>
          <div className="catalog-search"><h3>숙박·고정 일정 장소 확인</h3><p>검색한 장소를 일정 기준점으로 검토할 수 있어요.</p><div className="catalog-search-row"><Input id="catalog-query" label="장소 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="장소명 또는 주소" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void runSearch(); } }} /><Button variant="secondary" onClick={() => void runSearch()} disabled={busy}>장소 검색</Button></div>
            {places.length > 0 && <ul className="catalog-place-list">{places.map((place) => <li key={place.contentid}><span><strong>{place.title}</strong><small>{place.address} · {place.planningRole}</small></span><Button variant="secondary" onClick={() => { setCommonAnchor('lodging', place); markSettingsChanged(); }}>숙박 기준점</Button><Button variant="secondary" onClick={() => { setCommonAnchor('fixedSchedule', place); markSettingsChanged(); }}>고정 일정 기준점</Button></li>)}</ul>}
          </div>
            {settings.reviewedCommonFields.map((review) => <section className="common-anchor-summary" key={review.field}><h3>{review.field === 'lodging' ? '숙박 기준점' : '고정 일정 기준점'}</h3><ol>{review.anchors.map((anchor, index) => <li key={`${anchor.contentid}-${anchor.date}-${index}`}><span>장소 ID {anchor.contentid}</span><div className="anchor-fields"><label>날짜<input className="text-input" type="date" value={anchor.date} onChange={(event) => { setSettings((current) => ({ ...current, reviewedCommonFields: current.reviewedCommonFields.map((field) => field.field === review.field ? { ...field, anchors: field.anchors.map((item, position) => position === index ? { ...item, date: event.target.value } : item) } : field) })); markSettingsChanged(); }} /></label><label>순서<input className="text-input" type="number" min={1} max={8} value={anchor.position + 1} onChange={(event) => { const position = Math.max(0, Math.min(7, Number(event.target.value) - 1)); setSettings((current) => ({ ...current, reviewedCommonFields: current.reviewedCommonFields.map((field) => field.field === review.field ? { ...field, anchors: field.anchors.map((item, slot) => slot === index ? { ...item, position } : item) } : field) })); markSettingsChanged(); }} /></label><label>시작 시간<input className="text-input" type="time" value={anchor.startTime ?? ''} onChange={(event) => { setSettings((current) => ({ ...current, reviewedCommonFields: current.reviewedCommonFields.map((field) => field.field === review.field ? { ...field, anchors: field.anchors.map((item, slot) => slot === index ? { ...item, startTime: event.target.value || null } : item) } : field) })); markSettingsChanged(); }} /></label><label>종료 시간<input className="text-input" type="time" value={anchor.endTime ?? ''} onChange={(event) => { setSettings((current) => ({ ...current, reviewedCommonFields: current.reviewedCommonFields.map((field) => field.field === review.field ? { ...field, anchors: field.anchors.map((item, slot) => slot === index ? { ...item, endTime: event.target.value || null } : item) } : field) })); markSettingsChanged(); }} /></label><label>도착 마감<input className="text-input" type="time" value={anchor.arrivalDeadline ?? ''} onChange={(event) => { setSettings((current) => ({ ...current, reviewedCommonFields: current.reviewedCommonFields.map((field) => field.field === review.field ? { ...field, anchors: field.anchors.map((item, slot) => slot === index ? { ...item, arrivalDeadline: event.target.value || null } : item) } : field) })); markSettingsChanged(); }} /></label><label>체류 분<input className="text-input" type="number" min={1} max={1440} value={anchor.stayMinutes ?? ''} onChange={(event) => { setSettings((current) => ({ ...current, reviewedCommonFields: current.reviewedCommonFields.map((field) => field.field === review.field ? { ...field, anchors: field.anchors.map((item, slot) => slot === index ? { ...item, stayMinutes: event.target.value ? Number(event.target.value) : null } : item) } : field) })); markSettingsChanged(); }} /></label></div><Button variant="secondary" onClick={() => { setSettings((current) => ({ ...current, reviewedCommonFields: current.reviewedCommonFields.map((field) => field.field === review.field ? { ...field, anchors: field.anchors.filter((_, slot) => slot !== index).map((item, position) => ({ ...item, position })) } : field).filter((field) => field.anchors.length > 0) })); markSettingsChanged(); }}>삭제</Button></li>)}</ol></section>)}
          {isOwner && <div className="generation-actions"><Button variant="secondary" onClick={() => void saveConfig()} disabled={!settingsChanged || busy}>설정 저장</Button><Button onClick={() => void startGeneration()} disabled={!data.readyForGeneration || busy || settingsChanged}>{busy ? '처리 중…' : '여행 코스 만들기'}</Button>{settingsChanged && <small>변경한 설정을 먼저 저장해 주세요.</small>}</div>}
        </section>
      </>}
    </details>

    {plan && <Dialog open={validationOpen} title="여행 코스 검사 내역" onClose={() => setValidationOpen(false)} onConfirm={() => setValidationOpen(false)} confirmLabel="확인" cancelLabel="닫기" returnFocusRef={validationButtonRef}>
      <div><p>{plan.document.validation.status === 'verified' ? '경로와 일정을 확인했어요.' : plan.document.validation.status === 'violated' ? '저장 전에 해결해야 할 항목이 있어요.' : '아직 확인하지 못한 정보가 있어요.'}</p>{plan.document.validation.violations.length > 0 && <section><h3>일정 문제</h3><ul>{plan.document.validation.violations.map((item, index) => <li key={`${item.code}-${index}`}>{item.date ? `${item.date} · ` : ''}{validationLabel(item.code)}</li>)}</ul></section>}<p>전체 추정 비용: {plan.document.validation.totalCostKrw === null ? '확인 필요' : `${plan.document.validation.totalCostKrw.toLocaleString('ko-KR')}원`} · 확인된 금액 {plan.document.validation.knownCostKrw.toLocaleString('ko-KR')}원</p>{plan.document.validation.warnings.length > 0 && <ul>{plan.document.validation.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warningLabel(warning)}</li>)}</ul>}</div>
    </Dialog>}
  </div>;
}
