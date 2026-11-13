import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PreparationActionButton from '../preparation/PreparationActionButton';
import ResultMap from '../generation/ResultMap';
import { isValidWgs84, verifiedEdgeGeometry } from '../generation/mapUtils';
import type { CanvasPlaceDetail, CanvasPlaceNode } from './canvasModel.ts';
import type { CanvasTravelMode } from './canvasRoutes.ts';
import { getPlaceDetail } from './canvasApi.ts';
import { canvasItineraryChecks, canvasItineraryDays, canvasItineraryReviewDays, canvasItineraryReviewSummary, canvasPlaceSearchUrl, toCanvasMapData, type CanvasItineraryStop } from './canvasItineraryModel.ts';
import { canvasItineraryCosts } from './canvasItineraryCosts.ts';
import { useCanvasEdgePreferences } from './useCanvasEdgePreferences.ts';
import { useCanvasRoutes } from './useCanvasRoutes.ts';
import { useCanvasSync } from './useCanvasSync.ts';
import { modeLabel, resolveCanvasEdgeTime } from './canvasEdgePreferences.ts';
import '../../styles/generation.css';
import '../../styles/canvas-itinerary.css';

type Props = { tripId: string; preview: boolean; tripName: string; conditionsVersion: number | null; transport: CanvasTravelMode; expectedPeople: number | null; onEditCanvas: () => void };
type OverviewKind = 'checks' | 'costs';
const emptyDocument = { schemaVersion: 3 as const, days: [], nodes: [], edges: [] };
const dateLabel = (date: string | null) => {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00+09:00`);
  return Number.isNaN(parsed.valueOf()) ? null : new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' }).format(parsed);
};
const timeLabel = (value: string | null | undefined) => {
  if (!value) return '시간 미정';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '시간 미정' : parsed.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Seoul' });
};
const visitTimeLabel = (start: string | null | undefined, end: string | null | undefined) => {
  if (!start || timeLabel(start) === '시간 미정') return '예상 시간 미정';
  const endLabel = end ? timeLabel(end) : '시간 미정';
  return `예상 ${timeLabel(start)}${endLabel === '시간 미정' ? '' : `–${endLabel}`}`;
};
const feeValues = (place: CanvasPlaceDetail | null | undefined) => {
  const values = [place?.priceLabel, place?.feeText].filter((value): value is string => Boolean(value?.trim()));
  return values.filter((value, index) => values.findIndex(candidate => candidate.trim() === value.trim()) === index);
};
const shortFee = (value: string | undefined) => Boolean(value && [...value].length <= 28 && !/[\r\n\u2028\u2029]/.test(value));
const itineraryFeeLabel = (place: CanvasPlaceDetail | null | undefined, preview = false) => {
  const values = feeValues(place);
  if (!values.length) return place ? (place.title?.trim() ? '요금 정보 없음' : '장소명 정보 없음') : preview ? '예시 요금 정보 없음' : '요금 정보 확인 중';
  return shortFee(values[0]) ? values[0] : '상세 요금 있음';
};
const minuteLabel = (minutes: number) => `${minutes}분`;
const wonLabel = (amount: number) => `${new Intl.NumberFormat('ko-KR').format(amount)}원`;
const costRangeLabel = (min: number, max: number, approximate: boolean) => `${approximate ? '약 ' : ''}${min === max ? wonLabel(min) : `${wonLabel(min)}~${wonLabel(max)}`}`;
const durationLabel = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ''}` : minuteLabel(minutes);
const coverageParts = (knownMinutes: number, knownCount: number, totalCount: number, unit: string) => {
  if (totalCount === 0) return { primary: '없음', coverage: null };
  const totalLabel = unit === '방문' ? `${totalCount}회 방문` : `${totalCount}${unit}`;
  const knownLabel = unit === '방문' ? `${knownCount}회` : `${knownCount}${unit}`;
  if (knownCount === 0) return { primary: '미확인', coverage: `${totalLabel} 확인 필요` };
  const coverage = knownCount === totalCount ? `${totalLabel} 모두 확인` : `${totalLabel} 중 ${knownLabel} 확인`;
  return { primary: durationLabel(knownMinutes), coverage };
};
function CoverageDisplay({ knownMinutes, knownCount, totalCount, unit }: { knownMinutes: number; knownCount: number; totalCount: number; unit: string }) {
  const { primary, coverage } = coverageParts(knownMinutes, knownCount, totalCount, unit);
  return <><span className="canvas-itinerary-overview-value">{primary}</span>{coverage && <small>{coverage}</small>}</>;
}
const findingLabel = (kind: 'route-time' | 'location' | 'disconnected' | 'place-detail') => ({
  'route-time': '이동 시간 확인', location: '장소 위치 찾기', disconnected: '별도 코스 안내', 'place-detail': '장소 정보 다시 불러오기',
}[kind]);
const pendingVisitLabel = (kind: 'place-detail' | 'route-time') => kind === 'route-time' ? '이동 시간 확인 중' : '장소 정보 확인 중';
const visitStateLabel = (state: 'complete' | 'needs-review' | 'loading' | 'preview') => ({ complete: '확인 완료', 'needs-review': '확인 필요', loading: '확인 중', preview: '예시 일정' }[state]);
const safeHomepageUrl = (place: CanvasPlaceDetail | null | undefined) => place?.homepageUrl && /^https?:\/\//i.test(place.homepageUrl) ? place.homepageUrl : null;

function SelectedPlaceDetail({ selected, detailFailed, preview, feeNeedsSearch, failedImageUrls, onImageError, onEditCanvas }: { selected: CanvasItineraryStop; detailFailed: boolean; preview: boolean; feeNeedsSearch: boolean; failedImageUrls: Set<string>; onImageError: (url: string) => void; onEditCanvas: () => void }) {
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const [feesExpanded, setFeesExpanded] = useState(false);
  const overviewId = useId(); const feesId = useId();
  const safeHomepage = safeHomepageUrl(selected.place);
  const priceLabel = selected.place?.priceLabel; const feeText = selected.place?.feeText; const fees = feeValues(selected.place);
  const showFeeDisclosure = fees.length > 0 && (fees.length > 1 || !shortFee(fees[0]));
  const feeSearchUrl = fees.length === 0 || feeNeedsSearch ? canvasPlaceSearchUrl(selected.place, 'fee') : null;
  const feeLabel = fees.length > 0 ? (shortFee(fees[0]) ? fees[0] : '상세 요금 있음')
    : !selected.place ? (preview ? '예시 요금 정보 없음' : detailFailed ? '장소 정보 다시 확인' : '장소 정보 확인 중') : feeSearchUrl
      ? <a href={feeSearchUrl} target="_blank" rel="noopener noreferrer" aria-label={`${selected.place?.title} 요금 정보를 네이버에서 검색 (새 탭)`}>네이버 요금 검색</a>
      : <><span>장소명이 없어 검색할 수 없어요.</span> <button type="button" className="canvas-itinerary-inline-action" onClick={onEditCanvas}>캔버스에서 장소 확인</button></>;
  const publicDetails = [['분류', selected.place?.category], ['주소', selected.place?.address]] as const;
  const visitDetails = [['메뉴', selected.place?.menuText], ['운영시간', selected.place?.openingHoursText], ['휴무', selected.place?.closedDaysText]] as const;
  const contactDetails = [['연락처', selected.place?.tel], ['예약', selected.place?.bookingText], ['주차', selected.place?.parkingText]] as const;
  const hasContactDetails = contactDetails.some(([, value]) => Boolean(value?.trim())) || Boolean(safeHomepage);
  const hasAnyDetail = [...publicDetails, ...visitDetails, ...contactDetails].some(([, value]) => Boolean(value?.trim())) || Boolean(safeHomepage) || fees.length > 0;
  const hasOverview = Boolean(selected.place?.overviewText?.trim());
  const hasPhoto = Boolean(selected.place?.imageUrl && !failedImageUrls.has(selected.place.imageUrl));
  const stay = selected.place?.estimatedStayMinutes;
  const titleText = selected.place?.title?.trim() || (selected.place ? '장소명 없음' : preview ? '예시 장소 정보 없음' : detailFailed ? '장소 정보 다시 확인' : '장소 정보를 불러오는 중');
  const renderFacts = (items: readonly (readonly [string, string | null | undefined])[]) => items.filter(([, value]) => value?.trim()).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>);
  return <article className="canvas-itinerary-detail" aria-label={`${titleText} 장소 정보`}>
    <div className={`canvas-itinerary-place-hero${hasPhoto ? ' has-photo' : ''}`}>{hasPhoto && <img src={selected.place!.imageUrl!} alt="" onError={() => onImageError(selected.place!.imageUrl!)} />}<div><h2>{titleText}</h2>{renderFacts(publicDetails).length > 0 && <dl className="canvas-itinerary-fact-group canvas-itinerary-public-facts" aria-label="분류와 주소">{renderFacts(publicDetails)}</dl>}</div></div>
    <dl className="canvas-itinerary-inspector-visit" aria-label="방문과 요금"><div><dt>방문 시간</dt><dd>{visitTimeLabel(selected.node.schedule?.startAt, selected.node.schedule?.endAt)}</dd></div><div><dt>머무는 시간</dt><dd>{typeof stay === 'number' && Number.isFinite(stay) && stay >= 0 ? `${stay}분` : '미정'}</dd></div><div><dt>요금</dt><dd>{feeLabel}{fees.length > 0 && feeNeedsSearch && feeSearchUrl && <a href={feeSearchUrl} target="_blank" rel="noopener noreferrer" aria-label={`${selected.place?.title} 요금 정보를 네이버에서 검색 (새 탭)`}>네이버 요금 검색</a>}</dd></div></dl>
    {showFeeDisclosure && <section className="canvas-itinerary-fact-group canvas-itinerary-fee-facts" aria-label="상세 요금">
      <button className="canvas-itinerary-detail-toggle" type="button" aria-expanded={feesExpanded} aria-controls={feesId} onClick={() => setFeesExpanded(value => !value)}>{feesExpanded ? '요금 안내 접기' : '요금 안내 펼치기'}</button><div className="canvas-itinerary-expanded-details" id={feesId} hidden={!feesExpanded}><dl aria-label="상세 요금">
        {priceLabel?.trim() && <div><dt>요금 안내</dt><dd>{priceLabel}</dd></div>}
        {feeText?.trim() && (!priceLabel?.trim() || feeText.trim() !== priceLabel.trim()) && <div><dt>상세 요금</dt><dd>{feeText}</dd></div>}
      </dl></div>
    </section>}
    {visitDetails.some(([, value]) => Boolean(value?.trim())) && <section className={`canvas-itinerary-fact-group canvas-itinerary-visit-facts${hasContactDetails ? '' : ' has-no-contact'}`} aria-label="이용 정보"><dl>{renderFacts(visitDetails)}</dl></section>}
    {hasContactDetails && <dl className="canvas-itinerary-fact-group canvas-itinerary-contact-facts" aria-label="연락 및 편의 정보">{renderFacts(contactDetails)}{safeHomepage && <div><dt>홈페이지</dt><dd><a href={safeHomepage} target="_blank" rel="noopener noreferrer" aria-label="공식 홈페이지 (새 탭)">공식 홈페이지</a></dd></div>}</dl>}
    {selected.place && !hasAnyDetail && !hasOverview && <p className="canvas-itinerary-detail-empty">장소 상세 정보가 없어요.</p>}
    {hasOverview && <section className="canvas-itinerary-intro-facts"><button className="canvas-itinerary-detail-toggle" type="button" aria-expanded={overviewExpanded} aria-controls={overviewId} onClick={() => setOverviewExpanded(value => !value)}>{overviewExpanded ? '소개 접기' : '소개 펼치기'}</button><div className="canvas-itinerary-expanded-details" id={overviewId} hidden={!overviewExpanded}><dl aria-label="장소 소개"><div><dt>소개</dt><dd>{selected.place?.overviewText}</dd></div></dl></div></section>}
  </article>;
}

export default function CanvasItinerary({ tripId, preview, conditionsVersion, transport, expectedPeople, onEditCanvas }: Props) {
  const sync = useCanvasSync(tripId, preview); const document = sync.document;
  const [activeDayId, setActiveDayId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectionFocusRequest, setSelectionFocusRequest] = useState(0);
  const [extraPlaces, setExtraPlaces] = useState<Map<number, CanvasPlaceDetail>>(new Map());
  const [failedDetails, setFailedDetails] = useState<Set<number>>(new Set());
  const [detailsRetry, setDetailsRetry] = useState(0);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const [overviewSelection, setOverviewSelection] = useState<{ kind: OverviewKind; scope: string } | null>(null);
  const mapSectionRef = useRef<HTMLElement>(null); const selectedStopRef = useRef<HTMLButtonElement>(null);
  const selectedDetailRef = useRef<HTMLElement>(null);
  const overviewPanelId = useId(); const checksTriggerRef = useRef<HTMLButtonElement>(null); const costsTriggerRef = useRef<HTMLButtonElement>(null);
  const overviewShellRef = useRef<HTMLDivElement>(null); const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupFrame = useRef<number | null>(null); const popupFocusFrame = useRef<number | null>(null);
  const activeOverviewTrigger = useRef<HTMLButtonElement | null>(null); const suppressFocusOpen = useRef(false);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden' });
  const jumpAfterSelectionRef = useRef<string | null>(null);
  const [jumpRequest, setJumpRequest] = useState(0);
  const attemptedDetails = useRef(new Set<string>());
  const edgePreferences = useCanvasEdgePreferences(tripId, preview);
  const effectiveModeForEdge = (edgeId: string): CanvasTravelMode => {
    const edge = document?.edges.find(item => item.id === edgeId);
    return edge && document ? edgePreferences.get(edge, document)?.modeOverride ?? transport : transport;
  };
  const places = useMemo(() => new Map<number, CanvasPlaceDetail>([...extraPlaces, ...(sync.state?.places ?? []).map(place => [place.contentid, place] as const)]), [extraPlaces, sync.state?.places]);
  const placesRef = useRef(places);
  useEffect(() => { placesRef.current = places; }, [places]);
  const itineraryDays = useMemo(() => canvasItineraryDays(document ?? emptyDocument, [...places.values()]), [document, places]);
  const effectiveDayId = activeDayId !== null && document?.days.some(day => day.id === activeDayId) && itineraryDays.some(day => day.id === activeDayId) ? activeDayId : null;
  const visibleDays = useMemo(() => canvasItineraryReviewDays(itineraryDays, effectiveDayId), [effectiveDayId, itineraryDays]);
  const overviewScope = JSON.stringify([tripId, preview, effectiveDayId, visibleDays.map(day => [day.id, day.date])]);
  const overviewPanel = overviewSelection?.scope === overviewScope ? overviewSelection.kind : null;
  const setOverviewPanel = useCallback((kind: OverviewKind | null) => setOverviewSelection(kind === null ? null : { kind, scope: overviewScope }), [overviewScope]);
  const routes = useCanvasRoutes(tripId, conditionsVersion, transport, document, effectiveDayId, preview, effectiveModeForEdge, true);
  const selected = visibleDays.flatMap(day => day.stops).find(stop => stop.node.id === selectedId) ?? visibleDays.flatMap(day => day.stops)[0] ?? null;
  const selectedDay = visibleDays.find(day => day.stops.some(stop => stop.node.id === selected?.node.id)) ?? null;
  const mapData = useMemo(() => toCanvasMapData(visibleDays.flatMap(day => day.chains), document ?? emptyDocument, routes.routesByEdge), [document, routes.routesByEdge, visibleDays]);
  const edgeOverrides = useMemo(() => new Map((document?.edges ?? []).flatMap(edge => { const preference = document ? edgePreferences.get(edge, document) : null; return preference ? [[edge.id, { modeOverride: preference.modeOverride, manualMinutes: preference.manualMinutes }] as const] : []; })), [document, edgePreferences]);
  const summary = useMemo(() => canvasItineraryReviewSummary({ days: visibleDays, document: document ?? emptyDocument, routesByEdge: routes.routesByEdge, edgeOverrides, commonMode: transport, conditionsVersion }), [conditionsVersion, document, edgeOverrides, routes.routesByEdge, transport, visibleDays]);
  const costSummary = useMemo(() => canvasItineraryCosts(visibleDays, expectedPeople), [expectedPeople, visibleDays]);
  const placePhases = useMemo(() => {
    const phases = new Map<number, 'loading' | 'ready' | 'error'>();
    for (const day of visibleDays) for (const stop of day.stops) {
      if (stop.place) phases.set(stop.node.contentid, 'ready');
      else if (!preview) phases.set(stop.node.contentid, failedDetails.has(stop.node.contentid) ? 'error' : 'loading');
    }
    return phases;
  }, [failedDetails, preview, visibleDays]);
  const reviewChecks = useMemo(() => canvasItineraryChecks({ days: visibleDays, document: document ?? emptyDocument, routesByEdge: routes.routesByEdge, phasesByEdge: routes.phasesByEdge, placePhases, edgeOverrides, commonMode: transport, conditionsVersion, preview }), [conditionsVersion, document, edgeOverrides, placePhases, preview, routes.phasesByEdge, routes.routesByEdge, transport, visibleDays]);

  const visibleContentIdKey = useMemo(() => JSON.stringify([...new Set(visibleDays.flatMap(day => day.stops.map(stop => stop.node.contentid)))]), [visibleDays]);
  useEffect(() => {
    if (!document || preview) return;
    const attempted = attemptedDetails.current;
    const ids = (JSON.parse(visibleContentIdKey) as number[]).filter(id => !placesRef.current.has(id) && !attempted.has(`${sync.sourceEpoch}:${id}`));
    if (!ids.length) return;
    ids.forEach(id => attempted.add(`${sync.sourceEpoch}:${id}`));
    let active = true; const pending = new Set(ids); const controller = new AbortController();
    void (async () => {
      for (let start = 0; start < ids.length; start += 4) {
        const batch = ids.slice(start, start + 4);
        const results = await Promise.all(batch.map(id => getPlaceDetail(tripId, id, controller.signal).then(place => [id, place] as const).catch(() => null)));
        if (!active || controller.signal.aborted) return;
        const successful = results.filter((result): result is readonly [number, CanvasPlaceDetail] => result !== null);
        const failed = results.flatMap((result, index) => result ? [] : [batch[index]]);
        successful.forEach(([id]) => pending.delete(id)); failed.forEach(id => pending.delete(id));
        if (failed.length) setFailedDetails(current => new Set([...current, ...failed]));
        if (successful.length) {
          setExtraPlaces(current => new Map([...current, ...successful]));
          setFailedDetails(current => {
            if (!successful.some(([id]) => current.has(id))) return current;
            const next = new Set(current);
            successful.forEach(([id]) => next.delete(id));
            return next;
          });
        }
      }
    })();
    return () => { active = false; controller.abort(); pending.forEach(id => attempted.delete(`${sync.sourceEpoch}:${id}`)); };
  }, [detailsRetry, document, preview, sync.sourceEpoch, tripId, visibleContentIdKey]);

  const retryPlaceDetail = (id: number) => { attemptedDetails.current.delete(`${sync.sourceEpoch}:${id}`); setFailedDetails(current => { const next = new Set(current); next.delete(id); return next; }); setDetailsRetry(value => value + 1); };
  const busy = sync.status === 'loading'; const loadError = ['offline', 'error'].includes(sync.status) && !document;
  const legSummary = (sourceId: string, targetId: string) => {
    const edge = document?.edges.find(item => item.source === sourceId && item.target === targetId); if (!edge || !document) return null;
    const pref = edgePreferences.get(edge, document); const resolved = resolveCanvasEdgeTime(pref, transport); const route = routes.routesByEdge.get(edge.id); const rawLabel = routes.labels.get(edge.id);
    const hasGeometry = Boolean(route && verifiedEdgeGeometry(route));
    const label = pref?.manualMinutes ? `${modeLabel(resolved.mode)} · 직접 입력 ${pref.manualMinutes}분` : preview ? '예시 · 경로 미조회' : conditionsVersion === null ? '경로 기준 정보 미설정' : route?.status === 'verified' ? `${rawLabel ?? '이동 시간 미확인'}${hasGeometry ? '' : ' · 지도 경로 미제공'}` : rawLabel === '조회 중' ? '이동 시간 확인 중' : '이동 시간 미확인';
    return { edge, label };
  };
  const dateRange = itineraryDays.length ? (() => { const first = itineraryDays.find(day => day.date)?.date ?? null; const last = [...itineraryDays].reverse().find(day => day.date)?.date ?? null; return first && last ? first === last ? dateLabel(first) : `${dateLabel(first)} – ${dateLabel(last)}` : first ? dateLabel(first) : null; })() : null;
  const selectedDayIndex = effectiveDayId === null ? -1 : itineraryDays.findIndex(day => day.id === effectiveDayId);
  const scopeLabel = effectiveDayId === null ? '전체 일정' : `${selectedDayIndex + 1}일차`;
  const canSelectDay = effectiveDayId === null ? null : visibleDays[0] ?? null;
  const needsReviewCount = reviewChecks.visits.filter(visit => visit.state === 'needs-review').length;
  const loadingVisitCount = reviewChecks.visits.filter(visit => visit.state === 'loading').length;
  const disconnectedCount = reviewChecks.findings.filter(finding => finding.kind === 'disconnected').length;
  const actionableReviewVisits = preview ? [] : reviewChecks.visits.filter(visit => visit.state === 'needs-review' || visit.state === 'loading');
  const checkHeadline = preview ? '예시 일정' : !summary.visitCount ? '일정 없음' : needsReviewCount ? `확인 필요 ${needsReviewCount}건` : loadingVisitCount ? `확인 중 ${loadingVisitCount}건` : '확인 완료';
  const checkCaption = preview ? '예시 · 실제 이동 정보 확인 전' : !summary.visitCount ? '' : [loadingVisitCount > 0 && `${loadingVisitCount}회 확인 중`, disconnectedCount > 0 && `별도 코스 ${disconnectedCount}건`, !needsReviewCount && !loadingVisitCount && !disconnectedCount && `${summary.visitCount}회 확인 완료`].filter(Boolean).join(' · ');
  const costHeadline = costSummary.totalCount === 0 || costSummary.minKrw === null || costSummary.maxKrw === null
    ? '—' : costRangeLabel(costSummary.minKrw, costSummary.maxKrw, false);
  const costExceptionCount = costSummary.rows.filter(row => row.basis === 'unknown' || row.minKrw === null || row.maxKrw === null).length;
  const costCoverageLabel = costSummary.totalCount === 0 ? '방문 없음' : costSummary.knownCount < costSummary.totalCount ? `${costSummary.knownCount}/${costSummary.totalCount}회 확인된 안내만 합산` : `${costSummary.totalCount}회 안내 기준`;
  const costTriggerLabel = [preview ? '예시 비용 예외 보기' : '예상 비용 예외 보기', preview ? (expectedPeople === null ? '예시 인원 미정' : `예시 ${expectedPeople}명 기준`) : expectedPeople === null ? '예정 인원 미정' : `예정 ${expectedPeople}명 기준`, costCoverageLabel, costSummary.approximate && '범위 또는 근사 요금이 포함된 예상 금액', costExceptionCount > 0 ? `예외 ${costExceptionCount}회` : '예외 없음', '교통비와 추가 지출 제외'].filter(Boolean).join('. ');
  const cancelPopupClose = useCallback(() => { if (hoverCloseTimer.current !== null) { clearTimeout(hoverCloseTimer.current); hoverCloseTimer.current = null; } }, []);
  const cancelPopupFrames = useCallback(() => {
    if (popupFrame.current !== null) { cancelAnimationFrame(popupFrame.current); popupFrame.current = null; }
    if (popupFocusFrame.current !== null) { cancelAnimationFrame(popupFocusFrame.current); popupFocusFrame.current = null; }
  }, []);
  const closePopup = useCallback((restoreFocus = false) => {
    cancelPopupClose(); cancelPopupFrames(); setOverviewPanel(null);
    if (restoreFocus && activeOverviewTrigger.current) {
      if (window.document.activeElement !== activeOverviewTrigger.current) { suppressFocusOpen.current = true; activeOverviewTrigger.current.focus({ preventScroll: true }); }
    }
  }, [cancelPopupClose, cancelPopupFrames, setOverviewPanel]);
  const positionPopup = useCallback((kind: OverviewKind) => {
    const trigger = kind === 'checks' ? checksTriggerRef.current : costsTriggerRef.current;
    const panel = overviewShellRef.current?.querySelector<HTMLElement>('.canvas-itinerary-overview-panel');
    if (!trigger || !panel || panel.hidden) return false;
    const rect = trigger.getBoundingClientRect(); const widthLimit = window.innerWidth; const heightLimit = window.innerHeight;
    if (rect.bottom <= 0 || rect.top >= heightLimit || rect.right <= 0 || rect.left >= widthLimit) { closePopup(); return false; }
    const margin = Math.min(12, widthLimit / 4, heightLimit / 4); const gap = 8;
    const width = Math.max(0, Math.min(kind === 'checks' ? 480 : 560, widthLimit - margin * 2));
    const left = Math.max(margin, Math.min(rect.left, widthLimit - width - margin));
    const top = Math.max(margin, Math.min(rect.bottom + gap, heightLimit - margin));
    const bottom = Math.max(margin, Math.min(heightLimit - rect.top + gap, heightLimit - margin));
    const below = Math.max(0, heightLimit - margin - top); const above = Math.max(0, heightLimit - margin - bottom);
    const useAbove = below < 260 && above > below;
    const maxHeight = Math.min(420, useAbove ? above : below);
    if (width < 88 || maxHeight < 88) { closePopup(); return false; }
    const next: React.CSSProperties = { position: 'fixed', visibility: 'visible', left, width, maxHeight, ...(useAbove ? { bottom } : { top }) };
    setPopupStyle(current => current.position === next.position && (['visibility', 'left', 'width', 'maxHeight', 'top', 'bottom'] as const).every(key => current[key] === next[key]) ? current : next);
    return true;
  }, [closePopup]);
  const openPopup = (kind: OverviewKind, trigger?: HTMLButtonElement | null, focusPanel = false) => {
    cancelPopupClose(); cancelPopupFrames(); suppressFocusOpen.current = false;
    if (trigger) activeOverviewTrigger.current = trigger;
    if (overviewPanel !== kind) setPopupStyle({ position: 'fixed', visibility: 'hidden' });
    setOverviewPanel(kind);
    popupFrame.current = requestAnimationFrame(() => {
      popupFrame.current = null;
      if (!positionPopup(kind) || !focusPanel) return;
      popupFocusFrame.current = requestAnimationFrame(() => {
        popupFocusFrame.current = null;
        const panel = overviewShellRef.current?.querySelector<HTMLElement>('.canvas-itinerary-overview-panel');
        if (panel && !panel.hidden) (panel.querySelector<HTMLElement>('.canvas-itinerary-review-visit, .canvas-itinerary-cost-place') ?? panel.querySelector<HTMLElement>('.canvas-itinerary-popup-close'))?.focus();
      });
    });
  };
  const schedulePopupClose = () => { cancelPopupClose(); hoverCloseTimer.current = setTimeout(() => { hoverCloseTimer.current = null; if (!overviewShellRef.current?.contains(window.document.activeElement)) closePopup(); }, 220); };
  const enterPopupFromKey = (event: React.KeyboardEvent<HTMLButtonElement>, kind: OverviewKind) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault(); openPopup(kind, event.currentTarget, true);
  };
  const selectAndJumpToVisit = (nodeId: string) => { closePopup(); jumpAfterSelectionRef.current = nodeId; setSelectedId(nodeId); setSelectionFocusRequest(value => value + 1); setJumpRequest(value => value + 1); };

  useLayoutEffect(() => {
    if (jumpRequest === 0 || !selected || jumpAfterSelectionRef.current !== selected.node.id) return;
    jumpAfterSelectionRef.current = null;
    selectedStopRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' });
    selectedStopRef.current?.focus({ preventScroll: true });
  }, [jumpRequest, selected]);

  useEffect(() => {
    if (!overviewPanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePopup(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [overviewPanel, closePopup]);

  useEffect(() => () => { cancelPopupClose(); cancelPopupFrames(); }, [overviewScope, cancelPopupClose, cancelPopupFrames]);
  useEffect(() => {
    if (!overviewPanel) return;
    const onPointerDown = (event: PointerEvent) => { if (event.target instanceof Node && !overviewShellRef.current?.contains(event.target)) closePopup(); };
    window.document.addEventListener('pointerdown', onPointerDown);
    return () => window.document.removeEventListener('pointerdown', onPointerDown);
  }, [overviewPanel, closePopup]);
  useEffect(() => {
    if (!overviewPanel) return;
    const update = () => positionPopup(overviewPanel);
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [overviewPanel, positionPopup]);

  return <section className="generation-workspace canvas-itinerary-page"><div className="canvas-itinerary prep-main" aria-label="여행 종합">
    <header className="canvas-itinerary-heading prep-page-heading"><div className="prep-heading-info"><h1>여행 종합</h1>{dateRange && <div className="prep-heading-meta">{dateRange}</div>}</div><div className="canvas-itinerary-actions"><span className={`canvas-itinerary-save is-${sync.status}`} role={sync.status === 'conflict' || sync.status === 'error' ? 'alert' : 'status'}>{sync.message || ({ loading: '불러오는 중', saving: '저장 중', saved: '저장됨', offline: '저장 대기', conflict: '저장 충돌', error: '오류' }[sync.status])}</span><PreparationActionButton label="일정 수정" onClick={onEditCanvas} /></div></header>
    {busy && <section className="canvas-itinerary-state" role="status">최신 캔버스 일정을 불러오고 있어요.</section>}
    {loadError && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '일정을 불러오지 못했어요.'}</p><PreparationActionButton label="다시 시도" onClick={sync.retry} /></section>}
    {sync.status === 'conflict' && sync.state && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '다른 참여자가 일정을 수정했어요.'}</p><div className="canvas-itinerary-action-group"><PreparationActionButton label="내 변경 유지" onClick={() => sync.resolve('local')} /><PreparationActionButton label="최신 내용 사용" onClick={() => sync.resolve('remote')} /></div></section>}
    {['offline', 'error'].includes(sync.status) && sync.state && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '변경 사항을 저장하지 못했어요.'}</p><PreparationActionButton label="저장 다시 시도" onClick={sync.retry} /></section>}
    {!busy && !loadError && document && itineraryDays.length === 0 && <section className="canvas-itinerary-empty-document"><p>아직 일정 날짜가 없어요.</p><PreparationActionButton label="캔버스에서 일정 만들기" onClick={onEditCanvas} /></section>}
    {!busy && !loadError && document && itineraryDays.length > 0 && <>
      <div className="canvas-itinerary-overview-shell" ref={overviewShellRef} onPointerEnter={cancelPopupClose} onPointerLeave={schedulePopupClose} onBlur={event => { if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) cancelPopupClose(); else schedulePopupClose(); }}><dl className="canvas-itinerary-overview" aria-label={`${scopeLabel} 요약`}>
        <div><dt>일정 점검</dt><dd><button ref={checksTriggerRef} type="button" className="canvas-itinerary-overview-action canvas-itinerary-check-action" aria-expanded={overviewPanel === 'checks'} aria-controls={overviewPanelId} aria-keyshortcuts="ArrowDown" onKeyDown={event => enterPopupFromKey(event, 'checks')} onFocus={() => { if (suppressFocusOpen.current) { suppressFocusOpen.current = false; return; } openPopup('checks', checksTriggerRef.current); }} onMouseEnter={() => openPopup('checks', checksTriggerRef.current)} onClick={() => openPopup('checks', checksTriggerRef.current)}><span>{checkHeadline}</span></button>{checkCaption && <small>{checkCaption}</small>}</dd></div>
        <div><dt>체류 시간</dt><dd><CoverageDisplay knownMinutes={summary.stay.knownMinutes} knownCount={summary.stay.knownCount} totalCount={summary.stay.totalCount} unit="방문" /></dd></div>
        <div><dt>이동 시간</dt><dd><CoverageDisplay knownMinutes={summary.travel.knownMinutes} knownCount={summary.travel.knownCount} totalCount={summary.travel.totalCount} unit="구간" />{summary.travel.manualCount > 0 && <small>직접 입력 {summary.travel.manualCount}구간</small>}</dd></div>
        <div><dt>예상 비용</dt><dd className="canvas-itinerary-cost-stat"><span className="canvas-itinerary-cost-value">{costHeadline}</span><button ref={costsTriggerRef} type="button" className="canvas-itinerary-cost-trigger" aria-label={costTriggerLabel} aria-expanded={overviewPanel === 'costs'} aria-controls={overviewPanelId} aria-keyshortcuts="ArrowDown" onKeyDown={event => enterPopupFromKey(event, 'costs')} onFocus={() => { if (suppressFocusOpen.current) { suppressFocusOpen.current = false; return; } openPopup('costs', costsTriggerRef.current); }} onMouseEnter={() => openPopup('costs', costsTriggerRef.current)} onClick={() => openPopup('costs', costsTriggerRef.current)}><span aria-hidden="true">!</span></button></dd></div>
      </dl>
      <section className={`canvas-itinerary-overview-panel${overviewPanel === 'checks' ? ' is-checks' : ' is-costs'}`} style={popupStyle} id={overviewPanelId} aria-label={overviewPanel === 'checks' ? '일정 점검 항목' : '예외 항목'} role="region" hidden={!overviewPanel} onPointerEnter={cancelPopupClose} onPointerLeave={schedulePopupClose}>
        {overviewPanel === 'costs' ? <header className="canvas-itinerary-cost-popup-header"><h2>예외 항목</h2><button type="button" className="canvas-itinerary-popup-close" aria-label="예외 항목 창 닫기" onClick={() => closePopup(true)}>닫기</button></header> : <button type="button" className="canvas-itinerary-popup-close" aria-label="요약 창 닫기" onClick={() => closePopup(true)}>닫기</button>}
        {overviewPanel === 'checks' && <>{preview ? <p>예시 일정 · 실제 조회 전</p> : summary.visitCount === 0 ? <p>현재 범위에 방문 장소가 없어요.</p> : actionableReviewVisits.length === 0 ? <p>현재 범위에 추가 확인이 필요한 방문이 없어요.</p> : <ul>{actionableReviewVisits.map(visit => {
          const day = visibleDays.find(item => item.id === visit.dayId); const stop = day?.stops.find(item => item.node.id === visit.nodeId); if (!day || !stop) return null;
          const originalDayIndex = itineraryDays.findIndex(item => item.id === day.id);
          const finding = visit.findings.find(item => item.kind !== 'disconnected') ?? visit.findings[0];
          const locationUrl = visit.findings.some(item => item.kind === 'location') ? canvasPlaceSearchUrl(stop.place, 'location') : null;
          const stateIcon = visit.state === 'complete' ? '✓' : visit.state === 'needs-review' ? '!' : visit.state === 'loading' ? '…' : '예';
          return <li className="canvas-itinerary-review-row" key={stop.node.id}>
            <span className={`canvas-itinerary-review-status is-${visit.state}`} aria-label={visitStateLabel(visit.state)}>{stateIcon}</span>
            <button type="button" className="canvas-itinerary-review-visit" onClick={() => selectAndJumpToVisit(stop.node.id)}><strong>{stop.place?.title || `${stop.order}번째 방문 장소`}</strong><small>{originalDayIndex + 1}일차{dateLabel(day.date) ? ` · ${dateLabel(day.date)}` : ''} · {stop.place?.category || `${stop.order}번째 방문`}</small><span>{finding ? findingLabel(finding.kind) : visit.pendingKinds.length ? pendingVisitLabel(visit.pendingKinds[0]) : visit.state === 'preview' ? '예시 일정 · 실제 조회 전' : '확인 완료'}</span></button>
            <div className="canvas-itinerary-review-actions">{visit.findings.some(item => item.kind === 'route-time') && (conditionsVersion === null ? <span>여행 준비에서 공통 조건을 저장해 주세요.</span> : <button type="button" onClick={routes.retry}>이동 시간 다시 확인</button>)}{visit.findings.some(item => item.kind === 'place-detail') && <button type="button" onClick={() => retryPlaceDetail(stop.node.contentid)}>정보 다시 불러오기</button>}{locationUrl && <a href={locationUrl} target="_blank" rel="noopener noreferrer">위치 검색</a>}{visit.findings.some(item => item.kind === 'location') && !locationUrl && stop.place && <button type="button" onClick={onEditCanvas}>캔버스에서 확인</button>}</div>
          </li>;
        })}</ul>}</>}
        {overviewPanel === 'costs' && <>
          {costSummary.totalCount === 0 ? <p>방문이 없어 합산할 항목이 없어요.</p> : costExceptionCount === 0 ? <p>합산에서 제외된 장소 요금은 없어요.</p> : <ul>{costSummary.rows.filter(row => row.basis === 'unknown' || row.minKrw === null || row.maxKrw === null).map(row => {
            const day = visibleDays.find(item => item.id === row.dayId); const stop = day?.stops.find(item => item.node.id === row.nodeId); if (!day || !stop) return null;
            const fees = feeValues(stop.place); const feeSearchUrl = canvasPlaceSearchUrl(stop.place, 'fee'); const homepage = safeHomepageUrl(stop.place); const originalDayIndex = itineraryDays.findIndex(item => item.id === day.id);
            const exceptionReason = !stop.place ? (preview ? '예시 일정에 장소 요금 정보가 없어요.' : failedDetails.has(stop.node.contentid) ? '장소 정보를 불러오지 못해 요금을 확인할 수 없어요.' : '장소 정보를 확인하는 중이에요.') : fees.length === 0 ? row.reason ?? '요금 안내가 없어 합산할 수 없어요.' : row.reason ?? '요금의 적용 기준이 분명하지 않아 합산하지 않았어요.';
            return <li className="canvas-itinerary-cost-row" key={stop.node.id}>
              <button type="button" className="canvas-itinerary-cost-place" onClick={() => selectAndJumpToVisit(stop.node.id)}><strong>{stop.place?.title || `${stop.order}번째 방문 장소`}</strong></button>
              <div className="canvas-itinerary-review-actions">{!preview && !stop.place && failedDetails.has(stop.node.contentid) && <button type="button" onClick={() => retryPlaceDetail(stop.node.contentid)}>정보 다시 불러오기</button>}{stop.place && !stop.place.title?.trim() && !feeSearchUrl && <button type="button" onClick={onEditCanvas}>캔버스에서 장소 확인</button>}{feeSearchUrl && <a href={feeSearchUrl} target="_blank" rel="noopener noreferrer" aria-label={`${stop.place?.title} 요금 정보를 네이버에서 검색 (새 탭)`}>네이버 요금 검색</a>}</div>
              <small className="canvas-itinerary-cost-meta">{originalDayIndex + 1}일차{dateLabel(day.date) ? ` · ${dateLabel(day.date)}` : ''} · {stop.order}번째 방문</small>
              <div className="canvas-itinerary-cost-facts"><p className="canvas-itinerary-cost-exception">{exceptionReason}</p>{fees.map((fee, index) => <p key={`${fee}:${index}`}><span>{index === 0 ? '요금 원문' : '상세 요금'}</span>{fee}</p>)}{homepage && <p><span>공식 안내</span><a href={homepage} target="_blank" rel="noopener noreferrer">홈페이지</a></p>}</div>
            </li>;
          })}</ul>}
        </>}
      </section></div>
      <div className="canvas-itinerary-day-controls"><nav className="canvas-itinerary-day-tabs" aria-label="여행 날짜"><button className={`canvas-itinerary-day${effectiveDayId === null ? ' is-selected' : ''}`} type="button" aria-pressed={effectiveDayId === null} onClick={() => { setActiveDayId(null); if (!selectedId || !itineraryDays.some(day => day.stops.some(stop => stop.node.id === selectedId))) setSelectedId(itineraryDays[0]?.stops[0]?.node.id ?? null); }}>전체 일정</button>{itineraryDays.map((day, index) => <button className={`canvas-itinerary-day${day.id === effectiveDayId ? ' is-selected' : ''}`} key={day.id} type="button" aria-pressed={day.id === effectiveDayId} onClick={() => { setActiveDayId(day.id); if (!day.stops.some(stop => stop.node.id === selectedId)) setSelectedId(day.stops[0]?.node.id ?? null); }}><span>{index + 1}일차</span>{dateLabel(day.date) && <small>{dateLabel(day.date)}</small>}</button>)}</nav></div>
      <section className="canvas-itinerary-layout" aria-label="여행 코스와 지도">
        <section ref={mapSectionRef} tabIndex={-1} className="canvas-itinerary-map-column" aria-label="지도">
          {mapData.nodes.length > 0 && <>
            <ResultMap nodes={mapData.nodes} edges={mapData.edges} selectedId={selected?.node.id ?? null} onSelect={setSelectedId} fallbackConnections="none" presentation="summary" focusRequest={selectionFocusRequest} />
            {routes.hasIssue && <div className="canvas-itinerary-route-error" role="status"><span>일부 이동 경로 미확인</span><PreparationActionButton label="경로 다시 확인" onClick={routes.retry} /></div>}
            <button type="button" className="canvas-itinerary-mobile-list-jump" onClick={() => { selectedStopRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' }); selectedStopRef.current?.focus({ preventScroll: true }); }}>일정 목록 보기</button>
            {mapData.nodes.some(node => !isValidWgs84(node.coordinate)) && <p className="canvas-itinerary-location-note">일부 장소의 위치를 확인할 수 없어요.</p>}
          </>}
          {selected && <section ref={selectedDetailRef} className="canvas-itinerary-selected" aria-label="선택한 장소 상세" tabIndex={-1}><header><div><p>{dateLabel(selectedDay?.date ?? null) ?? (selectedDay ? '날짜 미정' : '')} · {selected.order}번째 방문</p></div><button type="button" className="canvas-itinerary-detail-toggle" onClick={() => { selectedStopRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' }); selectedStopRef.current?.focus({ preventScroll: true }); }}>일정 목록 보기</button></header>
            <SelectedPlaceDetail key={selected.node.id} selected={selected} detailFailed={failedDetails.has(selected.node.contentid)} preview={preview} feeNeedsSearch={Boolean(costSummary.rows.find(row => row.nodeId === selected.node.id && (row.basis === 'unknown' || row.minKrw === null || row.maxKrw === null)))} failedImageUrls={failedImageUrls} onImageError={url => setFailedImageUrls(current => new Set([...current, url]))} onEditCanvas={onEditCanvas} />
            {!preview && !selected.place && failedDetails.has(selected.node.contentid) && <div className="canvas-itinerary-retry"><small>장소 정보를 불러오지 못했어요.</small><PreparationActionButton label="다시 시도" onClick={() => retryPlaceDetail(selected.node.contentid)} /></div>}
          </section>}
        </section>
        <section className="canvas-itinerary-course" aria-label="시간순 여행 일정">
          {visibleDays.map(day => { const dayIndex = itineraryDays.findIndex(item => item.id === day.id); return <section className="canvas-itinerary-day-group" key={day.id} aria-label={`${dayIndex + 1}일차 일정`}>
            {effectiveDayId === null && <h2 className="canvas-itinerary-day-heading"><span>{dayIndex + 1}일차</span><small>{dateLabel(day.date) ?? '날짜 미정'} · {day.stops.length}회 방문</small></h2>}
            {day.stops.length === 0 ? <p className="canvas-itinerary-empty-day">연결된 여행 코스가 아직 없어요.</p> : <ol className="canvas-itinerary-stops" aria-label={`${dayIndex + 1}일차 방문 장소 목록`}>{day.chains.map((chain, chainIndex) => <li className="canvas-itinerary-chain" key={chain.id}>
              {chainIndex > 0 && <p className="canvas-itinerary-disconnected">연결되지 않은 코스</p>}
              {chain.stops.map((stop, index) => { const next = chain.stops[index + 1]; const leg = next ? legSummary(stop.node.id, next.node.id) : null; const detailFailed = !stop.place && failedDetails.has(stop.node.contentid); const isSelected = stop.node.id === selected?.node.id; const stay = stop.place?.estimatedStayMinutes; return <div className={`canvas-itinerary-stop-wrap${leg ? ' has-leg' : ''}`} key={stop.node.id}>
                <button ref={isSelected ? selectedStopRef : undefined} type="button" className={`canvas-itinerary-stop${isSelected ? ' is-selected' : ''}${stop.place?.imageUrl && !failedImageUrls.has(stop.place.imageUrl) ? ' has-thumb' : ''}`} aria-pressed={isSelected} onClick={() => { setSelectedId(stop.node.id); setSelectionFocusRequest(value => value + 1); }}><span className="canvas-itinerary-number" aria-label={`${stop.order}번째 방문`}>{stop.order}</span>{stop.place?.imageUrl && !failedImageUrls.has(stop.place.imageUrl) && <img className="canvas-itinerary-stop-thumb" src={stop.place.imageUrl} alt="" onError={() => setFailedImageUrls(current => new Set([...current, stop.place!.imageUrl!]))} />}<span className="canvas-itinerary-stop-copy"><span className="canvas-itinerary-stop-time">{visitTimeLabel(stop.node.schedule?.startAt, stop.node.schedule?.endAt)}</span><strong>{stop.place?.title ?? (preview ? '예시 장소 정보 없음' : detailFailed ? '장소 정보 다시 확인' : '장소 정보를 불러오는 중')}</strong><span className="canvas-itinerary-stop-meta"><span className="canvas-itinerary-stay"><span>머무는 시간</span><strong>{typeof stay === 'number' && Number.isFinite(stay) && stay >= 0 ? `${stay}분` : '미정'}</strong></span><small>{preview ? itineraryFeeLabel(stop.place, true) : detailFailed ? '장소 정보 다시 확인' : itineraryFeeLabel(stop.place)}</small></span></span></button>
                <div className="canvas-itinerary-mobile-actions"><button type="button" onClick={() => { setSelectedId(stop.node.id); selectedDetailRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }); selectedDetailRef.current?.focus({ preventScroll: true }); }}>장소 상세 보기</button><button type="button" onClick={() => { setSelectedId(stop.node.id); mapSectionRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }); mapSectionRef.current?.focus({ preventScroll: true }); }}>지도 보기</button></div>
                {leg && <p className="canvas-itinerary-leg"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m-5-5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span><small>다음 {next.place?.title ?? `${next.order}번째 방문 장소`}까지</small><strong>{leg.label}</strong></span></p>}
                {detailFailed && <span className="canvas-itinerary-retry"><small>장소 정보를 불러오지 못했어요.</small><PreparationActionButton label="다시 시도" onClick={() => retryPlaceDetail(stop.node.contentid)} /></span>}
              </div>; })}
            </li>)}</ol>}
            {document && document.nodes.some(node => node.dayId === day.id && (node.kind === 'comment' || (node.kind === 'place' && node.intent === 'candidate' && !day.stops.some(stop => stop.node.id === node.id)))) && <section className="canvas-itinerary-context" aria-label={`${dayIndex + 1}일차 참고 내용`}>
              {document.nodes.some(node => node.kind === 'comment' && node.dayId === day.id) && <section aria-label="캔버스 메모"><h3>메모</h3><ul>{document.nodes.filter((node): node is Extract<typeof node, { kind: 'comment' }> => node.kind === 'comment' && node.dayId === day.id).map(comment => <li key={comment.id}>{comment.text}</li>)}</ul></section>}
              {document.nodes.some(node => node.kind === 'place' && node.intent === 'candidate' && node.dayId === day.id && !day.stops.some(stop => stop.node.id === node.id)) && <section aria-label="검토 중인 장소"><h3>검토 중인 장소</h3><ul>{document.nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place' && node.intent === 'candidate' && node.dayId === day.id && !day.stops.some(stop => stop.node.id === node.id)).map(candidate => <li key={candidate.id}>{places.get(candidate.contentid)?.title ?? '장소 이름을 확인할 수 없어요.'}</li>)}</ul></section>}
            </section>}
          </section>; })}
          {effectiveDayId !== null && canSelectDay?.stops.length === 0 && <div className="canvas-itinerary-empty"><p>이 날짜에 연결된 여행 코스가 아직 없어요.</p><PreparationActionButton label="캔버스에서 코스 연결하기" onClick={onEditCanvas} /></div>}
        </section>
      </section>
    </>}
  </div></section>;
}
