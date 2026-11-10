import { useEffect, useRef, useState } from 'react';
import Button from '../../components/ui/Button';
import { searchPlaces, type PlaceSearchResult } from '../workspace/canvasApi.ts';

export type PreparationScheduleFieldsValue = { departureTime: string };
type Props = {
  tripId: string; value: PreparationScheduleFieldsValue; departure: string; returnRoute: string;
  departureError?: string; departureTimeError?: string; departureContentidError?: string; returnRouteError?: string; disabled?: boolean;
  onChange: (key: 'departureTime', value: string) => void; onDepartureChange: (value: string) => void;
  onDepartureContentidChange: (value: string) => void; onReturnRouteChange: (value: string) => void;
};

export default function PreparationScheduleFields({ tripId, value, departure, returnRoute, departureError, departureTimeError, departureContentidError, returnRouteError, disabled = false, onChange, onDepartureChange, onDepartureContentidChange, onReturnRouteChange }: Props) {
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const searchController = useRef<AbortController | null>(null);
  const searchEpoch = useRef(0);
  useEffect(() => () => { searchEpoch.current += 1; searchController.current?.abort(); }, [tripId]);
  async function search() {
    const searchText = departure.trim();
    if (!searchText) return;
    searchController.current?.abort();
    const controller = new AbortController(); searchController.current = controller;
    const own = ++searchEpoch.current;
    setBusy(true); setMessage('');
    try { const found = await searchPlaces(tripId, searchText, controller.signal); if (own === searchEpoch.current && !controller.signal.aborted) setResults(found); }
    catch (error) { if (own === searchEpoch.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '출발 장소를 검색하지 못했어요.'); }
    finally { if (own === searchEpoch.current) setBusy(false); }
  }
  return <section className="prep-schedule-fields" aria-label="출발 정보">
    <div className="prep-schedule-departure">
      <div className="field"><label htmlFor="departure">출발 장소</label><div className="prep-schedule-item-actions"><input id="departure" className="text-input" maxLength={100} value={departure} placeholder="예: 청주역" disabled={disabled} onChange={event => { searchEpoch.current += 1; searchController.current?.abort(); setBusy(false); setResults([]); onDepartureChange(event.target.value); onDepartureContentidChange(''); }} /><Button variant="secondary" aria-label="출발 장소 검색" disabled={disabled || busy || !departure.trim()} onClick={() => void search()}>{busy ? '검색 중…' : '검색'}</Button></div>{departureError && <p className="field-error" role="alert">{departureError}</p>}{departureContentidError && <p className="field-error" role="alert">{departureContentidError}</p>}</div>
      <div className="field"><label htmlFor="prep-departure-time">출발 시간</label><input id="prep-departure-time" className="text-input" type="time" value={value.departureTime} disabled={disabled} onChange={event => onChange('departureTime', event.target.value)} />{departureTimeError && <p className="field-error" role="alert">{departureTimeError}</p>}</div>
    </div>
    {results.map(place => <button type="button" key={place.contentid} className="prep-schedule-place-result" disabled={disabled} onClick={() => { onDepartureChange(place.title); onDepartureContentidChange(String(place.contentid)); setResults([]); }}>{place.title}<span>{place.address ?? place.category ?? '주소 미확인'}</span></button>)}
    {message && <p role="alert">{message}</p>}
    <div className="prep-schedule-departure">
      <div className="field"><label htmlFor="return-route">복귀 장소 <span className="prep-optional">선택</span></label><input id="return-route" className="text-input" maxLength={100} value={returnRoute} placeholder="예: 청주역" disabled={disabled} onChange={event => onReturnRouteChange(event.target.value)} />{returnRouteError && <p className="field-error" role="alert">{returnRouteError}</p>}</div>
    </div>
  </section>;
}
