import { useEffect, useMemo, useRef, useState } from 'react';
import PreparationActionButton from '../preparation/PreparationActionButton';
import ResultMap from '../generation/ResultMap';
import { isValidWgs84 } from '../generation/mapUtils';
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
  return Number.isNaN(parsed.valueOf()) ? '시간 미정' : parsed.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
};

function SelectedPlaceDetail({ selected, imageUrl, imageFailed, onImageError }: {
  selected: CanvasItineraryStop;
  imageUrl: string | null;
  imageFailed: boolean;
  onImageError: () => void;
}) {
  const hasExtraDetails = Boolean(selected.place?.menuText || selected.place?.openingHoursText || selected.place?.closedDaysText || selected.place?.tel || selected.place?.overviewText);
  return <article className={`canvas-itinerary-detail${imageUrl && !imageFailed ? ' has-photo' : ''}`} aria-label={`${selected.place?.title ?? `장소 ${selected.node.contentid}`} 장소 정보`}>
    {imageUrl && !imageFailed && <div className="canvas-itinerary-detail-image"><img src={imageUrl} alt="" onError={onImageError} /></div>}
    <div className="canvas-itinerary-detail-copy">
      <h3>{selected.place?.title ?? `장소 ${selected.node.contentid}`}</h3>
      <dl>
        <div><dt>방문</dt><dd>예상 {timeLabel(selected.node.schedule?.startAt)}</dd></div>
        <div><dt>체류</dt><dd>{selected.place?.estimatedStayMinutes ? `${selected.place.estimatedStayMinutes}분` : '시간 미정'}</dd></div>
        {selected.place?.category && <div><dt>분류</dt><dd>{selected.place.category}</dd></div>}
        <div><dt>주소</dt><dd>{selected.place?.address ?? '주소 정보 미확인'}</dd></div>
        <div><dt>비용</dt><dd>{selected.place?.priceLabel ?? selected.place?.feeText ?? '비용 미확인'}</dd></div>
      </dl>
      {hasExtraDetails && <details className="canvas-itinerary-place-more"><summary>장소 정보 더 보기</summary>
        <dl>
          {selected.place?.menuText && <div><dt>메뉴</dt><dd>{selected.place.menuText}</dd></div>}
          {selected.place?.openingHoursText && <div><dt>운영</dt><dd>{selected.place.openingHoursText}</dd></div>}
          {selected.place?.closedDaysText && <div><dt>휴무</dt><dd>{selected.place.closedDaysText}</dd></div>}
          {selected.place?.tel && <div><dt>연락처</dt><dd>{selected.place.tel}</dd></div>}
          {selected.place?.overviewText && <div><dt>소개</dt><dd>{selected.place.overviewText}</dd></div>}
        </dl>
      </details>}
    </div>
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
  const selectedImageUrl = selected?.place?.imageUrl ?? null;
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
    const label = pref?.manualMinutes ? `${modeLabel(resolved.mode)} · 직접 입력 ${pref.manualMinutes}분`
      : preview ? '예시 · 경로 미조회' : conditionsVersion === null ? '경로 기준 정보 미설정' : routes.labels.get(edge.id) ?? '시간 확인 중';
    const hasGeometry = Boolean(route?.status === 'verified' && route.geometry?.length > 1);
    return { edge, route, label, hasGeometry };
  };

  const firstDate = itineraryDays.find(day => day.date)?.date ?? null;
  const lastDate = [...itineraryDays].reverse().find(day => day.date)?.date ?? null;
  const dateRange = firstDate && lastDate ? firstDate === lastDate ? dateLabel(firstDate) : `${dateLabel(firstDate)} – ${dateLabel(lastDate)}` : firstDate ? dateLabel(firstDate) : null;

  return <section className="generation-workspace canvas-itinerary-page"><div className="canvas-itinerary prep-main" aria-label="여행 종합">
    <header className="canvas-itinerary-heading prep-page-heading"><div className="prep-heading-info"><h1>여행 종합</h1>{dateRange && <div className="prep-heading-meta">{dateRange}</div>}</div><div className="canvas-itinerary-actions"><span className={`canvas-itinerary-save is-${sync.status}`} role={sync.status === 'conflict' || sync.status === 'error' ? 'alert' : 'status'}>{sync.message || ({ loading: '불러오는 중', saving: '저장 중', saved: '저장됨', offline: '저장 대기', conflict: '저장 충돌', error: '오류' }[sync.status])}</span><PreparationActionButton label="일정 수정" onClick={onEditCanvas} /></div></header>
    {busy && <section className="canvas-itinerary-state" role="status">최신 캔버스 일정을 불러오고 있어요.</section>}
    {loadError && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '일정을 불러오지 못했어요.'}</p><PreparationActionButton label="다시 시도" onClick={sync.retry} /></section>}
    {sync.status === 'conflict' && sync.state && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '다른 참여자가 일정을 수정했어요.'}</p><div className="canvas-itinerary-action-group"><PreparationActionButton label="내 변경 유지" onClick={() => sync.resolve('local')} /><PreparationActionButton label="최신 내용 사용" onClick={() => sync.resolve('remote')} /></div></section>}
    {['offline', 'error'].includes(sync.status) && sync.state && <section className="canvas-itinerary-state" role="alert"><p>{sync.message || '변경 사항을 저장하지 못했어요.'}</p><PreparationActionButton label="저장 다시 시도" onClick={sync.retry} /></section>}
    {routes.hasIssue && <section className="canvas-itinerary-route-error" role="status"><span>일부 이동 경로를 확인하지 못했어요. 장소 순서는 그대로 유지돼요.</span><PreparationActionButton label="경로 다시 확인" onClick={routes.retry} /></section>}
    {!busy && !loadError && document && itineraryDays.length === 0 && <section className="canvas-itinerary-empty-document"><p>아직 일정 날짜가 없어요.</p><PreparationActionButton label="캔버스에서 일정 만들기" onClick={onEditCanvas} /></section>}
    {!busy && !loadError && document && itineraryDays.length > 0 && <section className="canvas-itinerary-card prep-grid" aria-label="여행 코스">
      <section className="canvas-itinerary-course prep-condition-section" aria-label="여행 코스">
        <div className="prep-section-heading"><div className="prep-title-line"><h2>여행 코스</h2></div></div>
        <div className="canvas-itinerary-day-tabs prep-transport-options" role="group" aria-label="여행 날짜">{itineraryDays.map((day, index) => <button className={`prep-transport-option${day.id === selectedDay?.id ? ' is-selected' : ''}`} key={day.id} type="button" aria-pressed={day.id === selectedDay?.id} onClick={() => { setActiveDayId(day.id); setSelectedId(day.stops[0]?.node.id ?? null); }}><span>{index + 1}일차</span>{dateLabel(day.date) && <small>{dateLabel(day.date)}</small>}</button>)}</div>
        {selectedDay && selectedDay.stops.length === 0 ? <div className="canvas-itinerary-empty"><p>연결된 여행 코스가 아직 없어요.</p><PreparationActionButton label="캔버스에서 코스 연결하기" onClick={onEditCanvas} /></div> : selectedDay && <ol className="canvas-itinerary-stops" aria-label="방문 장소 목록">{selectedDay.chains.map((chain, chainIndex) => <li className="canvas-itinerary-chain" key={chain.id}>
          {chainIndex > 0 && <p className="canvas-itinerary-disconnected">연결되지 않은 코스</p>}
          {chain.stops.map((stop, index) => { const next = chain.stops[index + 1]; const leg = next ? legSummary(stop.node.id, next.node.id) : null; const detailFailed = !stop.place && failedDetails.has(stop.node.contentid); const isSelected = stop.node.id === selected?.node.id; return <div className="canvas-itinerary-stop-wrap" key={stop.node.id}>
            <button type="button" className={`canvas-itinerary-stop${isSelected ? ' is-selected' : ''}${stop.place?.imageUrl && !failedImageUrls.has(stop.place.imageUrl) ? ' has-photo' : ''}`} aria-pressed={isSelected} onClick={() => setSelectedId(stop.node.id)}><span className="canvas-itinerary-number">{stop.order}</span>{stop.place?.imageUrl && !failedImageUrls.has(stop.place.imageUrl) && <img className="canvas-itinerary-stop-photo" src={stop.place.imageUrl} alt="" onError={() => setFailedImageUrls(current => new Set([...current, stop.place?.imageUrl ?? '']))} />}<span className="canvas-itinerary-stop-copy"><strong>{stop.place?.title ?? `장소 정보 ${detailFailed ? '확인 실패' : '불러오는 중'} (${stop.node.contentid})`}</strong><span className="canvas-itinerary-stop-meta"><span>예상 {timeLabel(stop.node.schedule?.startAt)}</span><span>체류 {stop.place?.estimatedStayMinutes ? `${stop.place.estimatedStayMinutes}분` : '시간 미정'}</span></span><small>{stop.place?.priceLabel ?? stop.place?.feeText ?? '비용 미확인'}</small></span></button>
            {isSelected && selected && <div className="canvas-itinerary-mobile-detail"><SelectedPlaceDetail selected={selected} imageUrl={selectedImageUrl} imageFailed={Boolean(selectedImageUrl && failedImageUrls.has(selectedImageUrl))} onImageError={() => selectedImageUrl && setFailedImageUrls(current => new Set([...current, selectedImageUrl]))} /></div>}
            {detailFailed && <span className="canvas-itinerary-retry"><small>장소 정보를 불러오지 못했어요.</small><PreparationActionButton label="다시 시도" onClick={() => retryPlaceDetail(stop.node.contentid)} /></span>}
            {leg && <p className="canvas-itinerary-leg"><span>{leg.label}</span>{leg.route?.status === 'verified' && !leg.hasGeometry && <small>경로 선 정보가 제공되지 않았어요.</small>}{leg.route?.status !== 'verified' && <small>실제 경로를 확인하지 못했어요.</small>}</p>}
          </div>; })}
        </li>)}</ol>}
      </section>
      <section className="canvas-itinerary-map-column prep-personal-section" aria-label="지도·장소 정보">
        <div className="prep-section-heading"><div className="prep-title-line"><h2>지도·장소 정보</h2></div></div>
        {selectedDay && selectedDay.stops.length > 0 && <>
          <ResultMap nodes={mapData.nodes} edges={mapData.edges} selectedId={selected?.node.id ?? null} onSelect={setSelectedId} fallbackConnections="none" presentation="summary" />
          {mapData.nodes.some(node => !isValidWgs84(node.coordinate)) && <p className="canvas-itinerary-location-note">일부 장소의 위치를 확인할 수 없어요.</p>}
          {selected && <div className="canvas-itinerary-desktop-detail"><SelectedPlaceDetail selected={selected} imageUrl={selectedImageUrl} imageFailed={Boolean(selectedImageUrl && failedImageUrls.has(selectedImageUrl))} onImageError={() => selectedImageUrl && setFailedImageUrls(current => new Set([...current, selectedImageUrl]))} /></div>}
          <details className="canvas-itinerary-notes"><summary>일정 정보</summary><ul><li>방문 시각은 생성 당시 예상이며 수정 뒤 다시 계산되지 않아요.</li><li>전체 비용은 편집본 기준으로 산출되지 않아요.</li><li>검증된 도로 좌표가 있는 이동만 지도에 선으로 표시해요.</li></ul></details>
        </>}
      </section>
    </section>}
  </div></section>;
}
