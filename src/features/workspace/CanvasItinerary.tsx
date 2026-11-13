import { useEffect, useMemo, useRef, useState } from 'react';
import PreparationActionButton from '../preparation/PreparationActionButton';
import ResultMap from '../generation/ResultMap';
import { isValidWgs84, verifiedEdgeGeometry } from '../generation/mapUtils';
import type { CanvasPlaceDetail, CanvasPlaceNode } from './canvasModel.ts';
import type { CanvasTravelMode } from './canvasRoutes.ts';
import { getPlaceDetail } from './canvasApi.ts';
import { canvasItineraryDays, toCanvasMapData, type CanvasItineraryStop } from './canvasItineraryModel.ts';
import { useCanvasEdgePreferences } from './useCanvasEdgePreferences.ts';
import { useCanvasRoutes } from './useCanvasRoutes.ts';
import { useCanvasSync } from './useCanvasSync.ts';
import { modeLabel, resolveCanvasEdgeTime } from './canvasEdgePreferences.ts';
import '../../styles/generation.css';
import '../../styles/canvas-itinerary.css';

type Props = { tripId: string; preview: boolean; tripName: string; conditionsVersion: number | null; transport: CanvasTravelMode; onEditCanvas: () => void };
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
  if (!start || timeLabel(start) === '시간 미정') return '시간 미정';
  const endLabel = end ? timeLabel(end) : '시간 미정';
  return `예상 ${timeLabel(start)}${endLabel === '시간 미정' ? '' : `–${endLabel}`}`;
};

const feeValues = (place: CanvasPlaceDetail | null | undefined) => {
  const values = [place?.priceLabel, place?.feeText].filter((value): value is string => Boolean(value?.trim()));
  return values.filter((value, index) => values.findIndex(candidate => candidate.trim() === value.trim()) === index);
};

const shortFee = (value: string | undefined) => Boolean(value && [...value].length <= 28 && !/[\r\n\u2028\u2029]/.test(value));

const itineraryFeeLabel = (place: CanvasPlaceDetail | null | undefined) => {
  const values = feeValues(place);
  if (!values.length) return '요금 미확인';
  return shortFee(values[0]) ? values[0] : '상세 요금 있음';
};

function SelectedPlaceDetail({ selected, failedImageUrls, onImageError }: { selected: CanvasItineraryStop; failedImageUrls: Set<string>; onImageError: (url: string) => void }) {
  const hasExtraDetails = Boolean(selected.place?.menuText || selected.place?.openingHoursText || selected.place?.closedDaysText || selected.place?.tel || selected.place?.overviewText || selected.place?.bookingText || selected.place?.parkingText || selected.place?.homepageUrl);
  const imageUrl = selected.place?.imageUrl;
  const hasPhoto = Boolean(imageUrl && !failedImageUrls.has(imageUrl));
  const safeHomepage = selected.place?.homepageUrl && /^https?:\/\//i.test(selected.place.homepageUrl) ? selected.place.homepageUrl : null;
  const priceLabel = selected.place?.priceLabel;
  const feeText = selected.place?.feeText;
  const fees = feeValues(selected.place);
  const showFeeDisclosure = fees.length > 0 && (fees.length > 1 || !shortFee(fees[0]));
  return <article className={`canvas-itinerary-detail${hasPhoto ? ' has-photo' : ''}`} aria-label={`${selected.place?.title ?? `장소 ${selected.node.contentid}`} 장소 정보`}>
    {hasPhoto && <img className="canvas-itinerary-detail-photo" src={imageUrl!} alt="" onError={() => onImageError(imageUrl!)} />}
    <div className="canvas-itinerary-detail-copy">
      <h3>{selected.place?.title ?? `장소 ${selected.node.contentid}`}</h3>
      <dl className="canvas-itinerary-primary-facts">
        <div><dt>방문</dt><dd>{visitTimeLabel(selected.node.schedule?.startAt, selected.node.schedule?.endAt)}</dd></div>
        <div><dt>체류</dt><dd>{selected.place?.estimatedStayMinutes ? `${selected.place.estimatedStayMinutes}분` : '시간 미정'}</dd></div>
        {selected.place?.category && <div><dt>분류</dt><dd>{selected.place.category}</dd></div>}
        <div className="canvas-itinerary-address-fact"><dt>주소</dt><dd>{selected.place?.address ?? '주소 정보 미확인'}</dd></div>
      </dl>
    </div>
    {!showFeeDisclosure && <div className="canvas-itinerary-fees"><span>이용 요금</span><p>{fees[0] ?? '요금 미확인'}</p></div>}
    {showFeeDisclosure && <details className="canvas-itinerary-fee-more"><summary>이용 요금</summary>
      <dl>
        {priceLabel?.trim() && <div><dt>요금 안내</dt><dd>{priceLabel}</dd></div>}
        {feeText?.trim() && (!priceLabel?.trim() || feeText.trim() !== priceLabel.trim()) && <div><dt>상세 요금</dt><dd>{feeText}</dd></div>}
      </dl>
    </details>}
    {hasExtraDetails && <details className="canvas-itinerary-place-more"><summary>장소 정보 더 보기</summary>
        <dl>
          {selected.place?.menuText && <div><dt>메뉴</dt><dd>{selected.place.menuText}</dd></div>}
          {selected.place?.openingHoursText && <div><dt>운영</dt><dd>{selected.place.openingHoursText}</dd></div>}
          {selected.place?.closedDaysText && <div><dt>휴무</dt><dd>{selected.place.closedDaysText}</dd></div>}
          {selected.place?.tel && <div><dt>연락처</dt><dd>{selected.place.tel}</dd></div>}
          {selected.place?.bookingText && <div><dt>예약</dt><dd>{selected.place.bookingText}</dd></div>}
          {selected.place?.parkingText && <div><dt>주차</dt><dd>{selected.place.parkingText}</dd></div>}
          {selected.place?.overviewText && <div><dt>소개</dt><dd>{selected.place.overviewText}</dd></div>}
          {safeHomepage && <div><dt>홈페이지</dt><dd><a href={safeHomepage} target="_blank" rel="noopener noreferrer">공식 홈페이지</a></dd></div>}
        </dl>
      </details>}
  </article>;
}

export default function CanvasItinerary({ tripId, preview, conditionsVersion, transport, onEditCanvas }: Props) {
  const sync = useCanvasSync(tripId, preview);
  const document = sync.document;
  const [activeDayId, setActiveDayId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraPlaces, setExtraPlaces] = useState<Map<number, CanvasPlaceDetail>>(new Map());
  const [failedDetails, setFailedDetails] = useState<Set<number>>(new Set());
  const [detailsRetry, setDetailsRetry] = useState(0);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const mapSectionRef = useRef<HTMLElement>(null);
  const selectedStopRef = useRef<HTMLButtonElement>(null);
  const attemptedDetails = useRef(new Set<string>());
  const edgePreferences = useCanvasEdgePreferences(tripId, preview);
  const effectiveModeForEdge = (edgeId: string): CanvasTravelMode => {
    const edge = document?.edges.find(item => item.id === edgeId);
    return edge && document ? edgePreferences.get(edge, document)?.modeOverride ?? transport : transport;
  };
  const days = useMemo(() => canvasItineraryDays(document ?? { schemaVersion: 3, days: [], nodes: [], edges: [] }, []), [document]);
  const activeDay = days.find(day => day.id === activeDayId) ?? days[0] ?? null;
  const routes = useCanvasRoutes(tripId, conditionsVersion, transport, document, activeDay?.id ?? null, preview, effectiveModeForEdge, true);
  const places = useMemo(() => new Map<number, CanvasPlaceDetail>([...extraPlaces, ...(sync.state?.places ?? []).map(place => [place.contentid, place] as const)]), [extraPlaces, sync.state?.places]);
  const itineraryDays = useMemo(() => canvasItineraryDays(document ?? { schemaVersion: 3, days: [], nodes: [], edges: [] }, [...places.values()]), [document, places]);
  const selectedDay = itineraryDays.find(day => day.id === activeDay?.id) ?? itineraryDays[0] ?? null;
  const selected = selectedDay?.stops.find(stop => stop.node.id === selectedId) ?? selectedDay?.stops[0] ?? null;
  const mapData = useMemo(() => toCanvasMapData(selectedDay?.chains ?? [], document ?? { schemaVersion: 3, days: [], nodes: [], edges: [] }, routes.routesByEdge), [document, routes.routesByEdge, selectedDay]);

  useEffect(() => {
    if (!document) return;
    if (!document.days.some(day => day.id === activeDayId)) setActiveDayId(document.days[0]?.id ?? null);
    const day = document.days.find(item => item.id === activeDayId) ?? document.days[0];
    const linked = new Set(document.edges.flatMap(edge => [edge.source, edge.target]));
    const ids = new Set(document.nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place' && node.dayId === day?.id && (node.intent === 'route' || linked.has(node.id))).map(node => node.id));
    if (selectedId && !ids.has(selectedId)) setSelectedId(null);
  }, [activeDayId, document, selectedId]);

  useEffect(() => {
    if (preview || !document) return;
    const dayId = activeDay?.id ?? days[0]?.id;
    const linked = new Set(document.edges.flatMap(edge => [edge.source, edge.target]));
    const ids = [...new Set(document.nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place' && node.dayId === dayId && (node.intent === 'route' || linked.has(node.id))).map(node => node.contentid))];
    const missing = ids.filter(id => !places.has(id) && !attemptedDetails.current.has(`${sync.sourceEpoch}:${id}`));
    if (!missing.length) return;
    missing.forEach(id => attemptedDetails.current.add(`${sync.sourceEpoch}:${id}`));
    let active = true; let settled = false;
    const controller = new AbortController();
    void Promise.all(missing.map(id => getPlaceDetail(tripId, id, controller.signal).then(place => [id, place] as const).catch(() => null))).then(results => {
      if (!active || controller.signal.aborted) return;
      settled = true;
      const successful = results.filter((result): result is readonly [number, CanvasPlaceDetail] => result !== null);
      const failed = results.flatMap((result, index) => result ? [] : [missing[index]]);
      if (failed.length) setFailedDetails(current => new Set([...current, ...failed]));
      if (successful.length) setExtraPlaces(current => new Map([...current, ...successful]));
    });
    return () => { active = false; controller.abort(); if (!settled) missing.forEach(id => attemptedDetails.current.delete(`${sync.sourceEpoch}:${id}`)); };
  }, [activeDay?.id, days, detailsRetry, document, places, preview, sync.sourceEpoch, tripId]);

  const retryPlaceDetail = (id: number) => { attemptedDetails.current.delete(`${sync.sourceEpoch}:${id}`); setFailedDetails(current => { const next = new Set(current); next.delete(id); return next; }); setDetailsRetry(value => value + 1); };
  const busy = sync.status === 'loading';
  const loadError = ['offline', 'error'].includes(sync.status) && !document;

  const legFor = (sourceId: string, targetId: string) => document?.edges.find(edge => edge.source === sourceId && edge.target === targetId) ?? null;
  const legSummary = (sourceId: string, targetId: string) => {
    const edge = legFor(sourceId, targetId);
    if (!edge) return null;
    const pref = document ? edgePreferences.get(edge, document) : null;
    const resolved = resolveCanvasEdgeTime(pref, transport);
    const route = routes.routesByEdge.get(edge.id);
    const rawLabel = routes.labels.get(edge.id);
    const hasGeometry = Boolean(route && verifiedEdgeGeometry(route));
    const label = pref?.manualMinutes ? `${modeLabel(resolved.mode)} · 직접 입력 ${pref.manualMinutes}분`
      : preview ? '예시 · 경로 미조회'
      : conditionsVersion === null ? '경로 기준 정보 미설정'
      : route?.status === 'verified'
        ? `${rawLabel ?? '이동 시간 미확인'}${hasGeometry ? '' : ' · 지도 경로 미제공'}`
        : rawLabel === '조회 중' ? '이동 시간 확인 중' : '이동 시간 미확인';
    return { edge, route, label, hasGeometry };
  };

  const firstDate = itineraryDays.find(day => day.date)?.date ?? null;
  const lastDate = [...itineraryDays].reverse().find(day => day.date)?.date ?? null;
  const dateRange = firstDate && lastDate ? firstDate === lastDate ? dateLabel(firstDate) : `${dateLabel(firstDate)} – ${dateLabel(lastDate)}` : firstDate ? dateLabel(firstDate) : null;
  const dayComments = document?.nodes.filter((node): node is Extract<typeof node, { kind: 'comment' }> => node.kind === 'comment' && node.dayId === selectedDay?.id) ?? [];
  const confirmedNodeIds = new Set(selectedDay?.stops.map(stop => stop.node.id) ?? []);
  const dayCandidates = document?.nodes.filter((node): node is CanvasPlaceNode => node.kind === 'place' && node.intent === 'candidate' && node.dayId === selectedDay?.id && !confirmedNodeIds.has(node.id)) ?? [];
  const renderSelectedDetail = () => selected && <SelectedPlaceDetail key={selected.node.id} selected={selected} failedImageUrls={failedImageUrls} onImageError={url => setFailedImageUrls(current => new Set([...current, url]))} />;

  return <section className="generation-workspace canvas-itinerary-page"><div className="canvas-itinerary prep-main" aria-label="여행 종합">
    <header className="canvas-itinerary-heading prep-page-heading"><div className="prep-heading-info"><h1>여행 종합</h1>{dateRange && <div className="prep-heading-meta">{dateRange}</div>}</div><div className="canvas-itinerary-actions"><span className={`canvas-itinerary-save is-${sync.status}`} role={sync.status === 'conflict' || sync.status === 'error' ? 'alert' : 'status'}>{sync.message || ({ loading: '불러오는 중', saving: '저장 중', saved: '저장됨', offline: '저장 대기', conflict: '저장 충돌', error: '오류' }[sync.status])}</span><PreparationActionButton label="일정 수정" onClick={onEditCanvas} /></div></header>
    {busy && <section className="canvas-itinerary-state" role="status">최신 캔버스 일정을 불러오고 있어요.</section>}
    {loadError && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '일정을 불러오지 못했어요.'}</p><PreparationActionButton label="다시 시도" onClick={sync.retry} /></section>}
    {sync.status === 'conflict' && sync.state && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '다른 참여자가 일정을 수정했어요.'}</p><div className="canvas-itinerary-action-group"><PreparationActionButton label="내 변경 유지" onClick={() => sync.resolve('local')} /><PreparationActionButton label="최신 내용 사용" onClick={() => sync.resolve('remote')} /></div></section>}
    {['offline', 'error'].includes(sync.status) && sync.state && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '변경 사항을 저장하지 못했어요.'}</p><PreparationActionButton label="저장 다시 시도" onClick={sync.retry} /></section>}
    {!busy && !loadError && document && itineraryDays.length === 0 && <section className="canvas-itinerary-empty-document"><p>아직 일정 날짜가 없어요.</p><PreparationActionButton label="캔버스에서 일정 만들기" onClick={onEditCanvas} /></section>}
    {!busy && !loadError && document && itineraryDays.length > 0 && <>
      <nav className="canvas-itinerary-day-tabs" aria-label="여행 날짜">{itineraryDays.map((day, index) => <button className={`canvas-itinerary-day${day.id === selectedDay?.id ? ' is-selected' : ''}`} key={day.id} type="button" aria-pressed={day.id === selectedDay?.id} onClick={() => { setActiveDayId(day.id); setSelectedId(day.stops[0]?.node.id ?? null); }}><span>{index + 1}일차</span>{dateLabel(day.date) && <small>{dateLabel(day.date)}</small>}</button>)}</nav>
    <section className="canvas-itinerary-layout" aria-label="여행 코스와 지도">
      <section ref={mapSectionRef} tabIndex={-1} className="canvas-itinerary-map-column" aria-label="지도·장소 정보">
        {selectedDay && selectedDay.stops.length > 0 && <>
          <ResultMap nodes={mapData.nodes} edges={mapData.edges} selectedId={selected?.node.id ?? null} onSelect={setSelectedId} fallbackConnections="none" presentation="summary" />
          {routes.hasIssue && <div className="canvas-itinerary-route-error" role="status"><span>일부 이동 경로 미확인</span><PreparationActionButton label="경로 다시 확인" onClick={routes.retry} /></div>}
          <button type="button" className="canvas-itinerary-back-to-stop" onClick={() => { selectedStopRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' }); selectedStopRef.current?.focus({ preventScroll: true }); }}>선택한 장소로 돌아가기</button>
          {mapData.nodes.some(node => !isValidWgs84(node.coordinate)) && <p className="canvas-itinerary-location-note">일부 장소의 위치를 확인할 수 없어요.</p>}
          <div className="canvas-itinerary-desktop-detail">{renderSelectedDetail()}</div>
          <details className="canvas-itinerary-notes"><summary>일정 정보</summary><ul><li>방문 시각은 생성 당시 예상이며 수정 뒤 다시 계산되지 않아요.</li><li>전체 비용은 편집본 기준으로 산출되지 않아요.</li><li>검증된 도로 좌표가 있는 이동만 지도에 선으로 표시해요.</li></ul></details>
        </>}
      </section>
      <section className="canvas-itinerary-course" aria-label="시간순 여행 일정">
        <button type="button" className="canvas-itinerary-map-jump" disabled={!selected} onClick={() => { mapSectionRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }); mapSectionRef.current?.focus({ preventScroll: true }); }}>지도 보기</button>
        {selectedDay && selectedDay.stops.length === 0 ? <div className="canvas-itinerary-empty"><p>연결된 여행 코스가 아직 없어요.</p><PreparationActionButton label="캔버스에서 코스 연결하기" onClick={onEditCanvas} /></div> : selectedDay && <ol className="canvas-itinerary-stops" aria-label="방문 장소 목록">{selectedDay.chains.map((chain, chainIndex) => <li className="canvas-itinerary-chain" key={chain.id}>
          {chainIndex > 0 && <p className="canvas-itinerary-disconnected">연결되지 않은 코스</p>}
          {chain.stops.map((stop, index) => { const next = chain.stops[index + 1]; const leg = next ? legSummary(stop.node.id, next.node.id) : null; const detailFailed = !stop.place && failedDetails.has(stop.node.contentid); const isSelected = stop.node.id === selected?.node.id; return <div className={`canvas-itinerary-stop-wrap${leg ? ' has-leg' : ''}`} key={stop.node.id}>
            <button ref={isSelected ? selectedStopRef : undefined} type="button" className={`canvas-itinerary-stop${isSelected ? ' is-selected' : ''}`} aria-pressed={isSelected} onClick={() => setSelectedId(stop.node.id)}><span className="canvas-itinerary-number" aria-label={`${stop.order}번째 방문`}>{stop.order}</span><span className="canvas-itinerary-stop-copy"><strong>{stop.place?.title ?? `장소 정보 ${detailFailed ? '확인 실패' : '불러오는 중'} (${stop.node.contentid})`}</strong><span className="canvas-itinerary-stop-meta"><span>{visitTimeLabel(stop.node.schedule?.startAt, stop.node.schedule?.endAt)}</span><span>체류 {stop.place?.estimatedStayMinutes ? `${stop.place.estimatedStayMinutes}분` : '시간 미정'}</span></span><small>{itineraryFeeLabel(stop.place)}</small></span></button>
            {isSelected && <div className="canvas-itinerary-mobile-detail">{renderSelectedDetail()}</div>}
            {detailFailed && <span className="canvas-itinerary-retry"><small>장소 정보를 불러오지 못했어요.</small><PreparationActionButton label="다시 시도" onClick={() => retryPlaceDetail(stop.node.contentid)} /></span>}
            {leg && <p className="canvas-itinerary-leg">{leg.label}</p>}
          </div>; })}
        </li>)}</ol>}
    {(dayComments.length > 0 || dayCandidates.length > 0) && <section className="canvas-itinerary-context" aria-label="캔버스 참고 내용">
      {dayComments.length > 0 && <section aria-label="캔버스 메모"><h2>캔버스 메모</h2><ul>{dayComments.map(comment => <li key={comment.id}>{comment.text}</li>)}</ul></section>}
      {dayCandidates.length > 0 && <section aria-label="검토 중인 장소"><h2>검토 중인 장소</h2><ul>{dayCandidates.map(candidate => <li key={candidate.id}>{places.get(candidate.contentid)?.title ?? `장소 정보 미확인 (${candidate.contentid})`}</li>)}</ul></section>}
    </section>}
      </section>
    </section>

    </>}
  </div></section>;
}
