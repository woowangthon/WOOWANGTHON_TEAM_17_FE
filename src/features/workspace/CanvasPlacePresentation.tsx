import { useState } from 'react';
import { regionPhotos } from '../preparation/regionPhotos';
import type { CanvasPlaceDetail, CanvasPlaceNode } from './canvasModel';
import { canEditCanvasVisitTime, canvasStayMinutes, getCanvasVisitClocks } from './canvasVisitTime';

type PlaceSummary = {
  contentid?: number;
  title: string;
  address?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  feeText?: string | null;
  priceLabel?: string | null;
};

const roleNames: Record<string, string> = {
  meal_stop: '음식점', sightseeing_stop: '관광지', culture_stop: '문화', activity_stop: '체험',
  shopping_stop: '쇼핑', overnight_lodging: '숙소', overnight_camping: '캠핑', date_specific_event: '행사',
};
const localPhotos = new Map<number, string>(regionPhotos.map(photo => [Number(photo.contentId), photo.image]));

function priceText(place?: PlaceSummary) {
  return place?.feeText?.trim() || place?.priceLabel?.trim() || '';
}

function placeCategory(place?: CanvasPlaceDetail) {
  return place?.category?.trim() || roleNames[place?.planningRole ?? ''] || '';
}

function PhotoSource({ sources, className }: { sources: string[]; className: string }) {
  const [index, setIndex] = useState(0);
  const src = sources[index];
  if (src) return <img key={src} src={src} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer"
    className={className} onError={() => setIndex(index + 1)} />;
  return null;
}

function PlacePhoto({ place, className }: { place?: PlaceSummary; className: string }) {
  const local = place?.contentid == null ? undefined : localPhotos.get(place.contentid);
  const sources = [local, place?.imageUrl].filter((value): value is string => Boolean(value));
  return <PhotoSource key={JSON.stringify(sources)} sources={sources} className={className} />;
}

export function CanvasPlaceCardContent({ place, node, onEditTime, timePanelId }: {
  place?: CanvasPlaceDetail;
  node: CanvasPlaceNode;
  onEditTime?: (opener: HTMLButtonElement) => void;
  timePanelId?: string;
}) {
  const { startTime, endTime } = getCanvasVisitClocks(node);
  const clock = startTime && endTime ? `${startTime}–${endTime}` : startTime || (endTime && `종료 ${endTime}`);
  const timeAction = clock ? '방문 시간 수정' : '방문 시간 설정';
  const minutes = canvasStayMinutes(node, place?.estimatedStayMinutes);
  const price = priceText(place);
  const categoryLabel = [placeCategory(place), node.intent === 'candidate' ? '후보' : ''].filter(Boolean).join(' · ');
  const clockIcon = <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.6"/><path d="M10 6v4l2.6 1.7"/></svg>;
  return <>
    {onEditTime && canEditCanvasVisitTime(node) ? <button type="button"
      className="tw-stop-time tw-stop-time-edit nodrag nopan" aria-haspopup="dialog"
      aria-expanded={Boolean(timePanelId)} aria-controls={timePanelId}
      aria-label={[`${place?.title || '장소'} ${timeAction}`, clock].filter(Boolean).join(', ')} title={timeAction}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}
      onDoubleClick={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); onEditTime(event.currentTarget); }}>
      {clockIcon}{clock || '시간 설정'}
      <svg className="tw-time-pencil" viewBox="0 0 20 20" aria-hidden="true"><path d="m4 12.8 8.8-8.7a1.7 1.7 0 0 1 2.4 2.4l-8.8 8.7-3.2.8.8-3.2ZM11.8 5.1l2.4 2.4"/></svg>
    </button> : <div className="tw-stop-time" title={node.schedule?.locked ? '예약으로 고정된 방문 시간' : undefined}>
      {clockIcon}{clock || '시간 미정'}
    </div>}
    <div className="tw-stop-body">
      <div className="tw-stop-heading">
        {categoryLabel && <small>{categoryLabel}</small>}
        <strong>{place?.title || '장소 확인 중'}</strong>
        <p className="tw-place-address" title={place?.address ?? undefined}>{place?.address || '주소 정보 없음'}</p>
      </div>
      <PlacePhoto place={place} className="tw-stop-picture" />
    </div>
    <div className="tw-stop-foot">
      <span aria-label={`체류 시간 ${minutes == null ? '미정' : minutes + '분'}`}>{minutes != null ? `체류 ${minutes}분` : '체류 미정'}</span>
      <span className="tw-stop-fee" aria-label={`요금 ${price || '미확인'}`} title={price}>{price || '요금 미확인'}</span>
    </div>
  </>;
}

export function CanvasPlaceOverview({ place }: { place?: CanvasPlaceDetail }) {
  const info = [
    ['운영 시간', place?.openingHoursText], ['휴무일', place?.closedDaysText], ['이용 요금', priceText(place) || '미확인'],
    ['예약', place?.bookingText], ['주차', place?.parkingText], ['전화', place?.tel],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
  const menus = place?.menuText?.trim().split(/\r?\n|\s+\/\s+/u).map(menu => menu.trim()).filter(Boolean) ?? [];
  const paragraphs = place?.overviewText?.trim().split(/\r?\n/u).map(paragraph => paragraph.trim()).filter(Boolean) ?? [];
  return <div className="tw-place-overview">
    <div className="tw-place-overview-heading">
      {placeCategory(place) && <small>{placeCategory(place)}</small>}
      <h3>{place?.title || '장소 정보 확인 중'}</h3>
      <p className="tw-location"><span className="sr-only">위치 </span>{place?.address || '주소 정보 없음'}</p>
    </div>
    <PlacePhoto place={place} className="tw-place-cover" />
    <section><h4>이용 정보</h4><dl className="tw-place-info-list">{info.map(([name, value]) =>
      <div key={name}><dt>{name}</dt><dd>{value}</dd></div>
    )}</dl></section>
    {menus.length > 0 && <section><h4>메뉴</h4>
      {menus.length === 1 ? <p>{menus[0]}</p> : <ul className="tw-place-menu-list">{menus.map((menu, index) => <li key={index}>{menu}</li>)}</ul>}
    </section>}
    {paragraphs.length > 0 && <section className="tw-place-introduction"><h4>장소 소개</h4>{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>}
    {place?.homepageUrl && <a href={place.homepageUrl} target="_blank" rel="noreferrer">공식 홈페이지 ↗</a>}
  </div>;
}

export function CanvasPlaceCandidate({ place, onChoose, actionLabel, disabled }: {
  place: PlaceSummary; onChoose: () => void; actionLabel: string; disabled?: boolean;
}) {
  return <article className="tw-search-result tw-place-candidate">
    <div className="tw-candidate-main">
      <PlacePhoto place={place} className="tw-candidate-thumb" />
      <div>
        <strong>{place.title}</strong>
        {place.address && <small>{place.address}</small>}
        {priceText(place) && <small>가격 {priceText(place)}</small>}
      </div>
    </div>
    <button className="tw-candidate-action" type="button" onClick={onChoose} disabled={disabled}
      aria-label={`${place.title} · ${actionLabel}`}>{actionLabel}</button>
  </article>;
}

export function CanvasPlaceMenuSummary({ place }: { place?: CanvasPlaceDetail }) {
  if (!place) return null;
  return <div className="tw-menu-place">
    <PlacePhoto place={place} className="tw-menu-place-photo" />
    <div><strong>{place.title}</strong><small title={priceText(place)}>가격 {priceText(place) || '정보 없음'}</small></div>
  </div>;
}
