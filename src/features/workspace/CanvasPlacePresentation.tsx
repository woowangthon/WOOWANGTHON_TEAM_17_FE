import { useState } from 'react';
import { regionPhotos } from '../preparation/regionPhotos';
import type { CanvasPlaceDetail, CanvasPlaceNode } from './canvasModel';

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

function PhotoSource({ sources, className, reserve }: { sources: string[]; className: string; reserve: boolean }) {
  const [index, setIndex] = useState(0);
  const src = sources[index];
  if (src) return <img key={src} src={src} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer"
    className={className} onError={() => setIndex(index + 1)} />;
  if (!reserve) return null;
  return <span className={`${className} tw-photo-missing`}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/>
    </svg>
    <span>사진 없음</span>
  </span>;
}

function PlacePhoto({ place, className, reserve = false }: { place?: PlaceSummary; className: string; reserve?: boolean }) {
  const local = place?.contentid == null ? undefined : localPhotos.get(place.contentid);
  const sources = [local, place?.imageUrl].filter((value): value is string => Boolean(value));
  return <PhotoSource key={JSON.stringify(sources)} sources={sources} className={className} reserve={reserve} />;
}

function stayMinutes(schedule?: CanvasPlaceNode['schedule'], estimate?: number | null) {
  if (schedule?.startAt && schedule.endAt) {
    const duration = Math.round((Date.parse(schedule.endAt) - Date.parse(schedule.startAt)) / 60000);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  return estimate ?? null;
}

export function CanvasPlaceCardContent({ place, visitLabel, candidate, schedule }: {
  place?: CanvasPlaceDetail; visitLabel?: string; candidate: boolean; schedule?: CanvasPlaceNode['schedule'];
}) {
  const minutes = stayMinutes(schedule, place?.estimatedStayMinutes);
  const clock = visitLabel?.replace(/^예상 시각 /u, '').replace(/ KST$/u, '');
  const price = priceText(place);
  const categoryLabel = [placeCategory(place), candidate ? '후보' : ''].filter(Boolean).join(' · ');
  return <>
    <div className="tw-stop-time" aria-label={`방문 시간 ${clock || '미정'}`}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.6"/><path d="M10 6v4l2.6 1.7"/></svg>
      {clock || '시간 미정'}
    </div>
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
      <span className="tw-stop-fee" title={price}>{price || '요금 미확인'}</span>
    </div>
  </>;
}

export function CanvasPlaceOverview({ place }: { place?: CanvasPlaceDetail }) {
  const info = [
    ['운영 시간', place?.openingHoursText], ['휴무일', place?.closedDaysText], ['가격', priceText(place) || '정보 없음'],
    ['예약', place?.bookingText], ['주차', place?.parkingText], ['전화', place?.tel],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()));
  return <div className="tw-place-overview">
    <PlacePhoto place={place} className="tw-place-cover" reserve />
    <div className="tw-place-overview-heading">
      {placeCategory(place) && <small>{placeCategory(place)}</small>}
      <h3>{place?.title || '장소 정보 확인 중'}</h3>
      <p className="tw-location"><span className="sr-only">위치 </span>{place?.address || '주소 정보 없음'}</p>
    </div>
    {place?.menuText?.trim() && <section><h4>메뉴</h4><p>{place.menuText}</p></section>}
    <section><h4>이용 정보</h4><dl className="tw-place-info-list">{info.map(([name, value]) =>
      <div key={name} className={name === '가격' ? 'tw-place-overview-price' : undefined}><dt>{name}</dt><dd>{value}</dd></div>
    )}</dl></section>
    {place?.overviewText?.trim() && <section><h4>장소 소개</h4><p>{place.overviewText}</p></section>}
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
