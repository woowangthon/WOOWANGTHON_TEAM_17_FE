import { useState } from 'react';
import type { CanvasPlaceDetail } from './canvasModel';

type PlaceSummary = {
  title: string;
  address?: string | null;
  category?: string | null;
  imageUrl?: string | null;
  feeText?: string | null;
  priceLabel?: string | null;
};

const roleNames: Record<string, string> = {
  meal_stop: '식당', sightseeing_stop: '관광', culture_stop: '문화', activity_stop: '체험',
  shopping_stop: '쇼핑', overnight_lodging: '숙소', overnight_camping: '캠핑', date_specific_event: '행사',
};

function priceText(place?: PlaceSummary) {
  return place?.feeText?.trim() || place?.priceLabel?.trim() || '';
}

function placeCategory(place?: CanvasPlaceDetail) {
  return place?.category?.trim() || roleNames[place?.planningRole ?? ''] || '';
}

function PlacePhoto({ src, className }: { src?: string | null; className: string }) {
  const [failed, setFailed] = useState<string>();
  if (!src || failed === src) return null;
  return <img src={src} alt="" draggable={false} decoding="async" loading="lazy" referrerPolicy="no-referrer"
    className={className} onError={() => setFailed(src)} />;
}

export function CanvasPlaceCardContent({ place, visitLabel, candidate }: {
  place?: CanvasPlaceDetail; visitLabel?: string; candidate: boolean;
}) {
  const category = placeCategory(place);
  const price = priceText(place);
  return <>
    <div className="tw-place-identity">
      <PlacePhoto src={place?.imageUrl} className="tw-place-thumb" />
      <div className="tw-place-title">
        {(category || candidate) && <small>{[category, candidate ? '후보' : ''].filter(Boolean).join(' · ')}</small>}
        <strong>{place?.title || '장소 정보 확인 중'}</strong>
      </div>
    </div>
    {place?.address && <p className="tw-place-address" title={place.address}>{place.address}</p>}
    <div className="tw-place-facts">
      {visitLabel && <span>{visitLabel.replace(/^예상 시각 /u, '').replace(/ KST$/u, '')}</span>}
      {place?.estimatedStayMinutes != null && <span>체류 {place.estimatedStayMinutes}분</span>}
      <span className="tw-place-price" title={price}>가격 <b>{price || '정보 없음'}</b></span>
    </div>
  </>;
}

export function CanvasPlaceOverview({ place }: { place?: CanvasPlaceDetail }) {
  return <div className="tw-place-overview">
    <PlacePhoto src={place?.imageUrl} className="tw-place-cover" />
    {placeCategory(place) && <small>{placeCategory(place)}</small>}
    <h3>{place?.title || '장소 정보 확인 중'}</h3>
    {place?.address && <p>{place.address}</p>}
    <div className="tw-place-overview-price"><span>가격</span><strong>{priceText(place) || '정보 없음'}</strong></div>
  </div>;
}

export function CanvasPlaceCandidate({ place, onChoose, actionLabel, disabled }: {
  place: PlaceSummary; onChoose: () => void; actionLabel: string; disabled?: boolean;
}) {
  return <article className="tw-search-result tw-place-candidate">
    <div className="tw-candidate-main">
      <PlacePhoto src={place.imageUrl} className="tw-candidate-thumb" />
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
    <PlacePhoto src={place.imageUrl} className="tw-menu-place-photo" />
    <div><strong>{place.title}</strong><small title={priceText(place)}>가격 {priceText(place) || '정보 없음'}</small></div>
  </div>;
}
