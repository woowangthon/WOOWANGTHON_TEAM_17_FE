import { useEffect, useRef, useState } from 'react';
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
  const [searched, setSearched] = useState(false);
  const searchController = useRef<AbortController | null>(null);
  const searchEpoch = useRef(0);
  const departureInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { searchEpoch.current += 1; searchController.current?.abort(); }, [tripId]);
  async function search() {
    const searchText = departure.trim();
    if (!searchText) { setResults([]); setSearched(false); setMessage('출발 장소를 입력해 주세요.'); departureInputRef.current?.focus(); return; }
    searchController.current?.abort();
    const controller = new AbortController(); searchController.current = controller;
    const own = ++searchEpoch.current;
    setBusy(true); setMessage(''); setResults([]); setSearched(false);
    try {
      const found = await searchPlaces(tripId, searchText, controller.signal);
      if (own === searchEpoch.current && !controller.signal.aborted) { setResults(found); setSearched(true); if (!found.length) setMessage('검색 결과가 없어요. 장소 이름을 다시 확인해 주세요.'); }
    }
    catch (error) { if (own === searchEpoch.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '출발 장소를 검색하지 못했어요.'); }
    finally { if (own === searchEpoch.current) setBusy(false); }
  }
  return <section className="prep-schedule-fields" aria-label="출발 정보">
    <div className="prep-schedule-departure">
      <div className="field">
        <label htmlFor="departure">출발 장소</label>
        <form className="prep-departure-search" onSubmit={event => { event.preventDefault(); void search(); }}>
          <input ref={departureInputRef} id="departure" className="text-input" maxLength={100}
            value={departure} placeholder="예: 청주역" disabled={disabled}
            aria-describedby={[departureError ? 'departure-error' : '', departureContentidError ? 'departure-place-error' : '', message ? 'departure-search-status' : ''].filter(Boolean).join(' ') || undefined}
            aria-invalid={Boolean(departureError || departureContentidError)}
            onChange={event => {
              searchEpoch.current += 1; searchController.current?.abort();
              setBusy(false); setResults([]); setSearched(false); setMessage('');
              onDepartureChange(event.target.value); onDepartureContentidChange('');
            }} />
          <button className="prep-search-icon" type="submit" title="출발 장소 검색"
            aria-label={busy ? '출발 장소 검색 중' : '출발 장소 검색'} disabled={disabled || busy}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <circle cx="10.7" cy="10.7" r="6.4" /><path d="m15.4 15.4 4.2 4.2" />
            </svg>
          </button>
        </form>
        {departureError && <p className="field-error" id="departure-error" role="alert">{departureError}</p>}
        {departureContentidError && <p className="field-error" id="departure-place-error" role="alert">{departureContentidError}</p>}
      </div>
      <div className="field"><label htmlFor="prep-departure-time">출발 시간</label><input id="prep-departure-time" className="text-input" type="time" value={value.departureTime} disabled={disabled} onChange={event => onChange('departureTime', event.target.value)} />{departureTimeError && <p className="field-error" role="alert">{departureTimeError}</p>}</div>
    </div>
    {results.length > 0 && <ul className="prep-schedule-place-results" aria-label="출발 장소 검색 결과">{results.map(place => <li key={place.contentid}><button type="button" className="prep-schedule-place-result" disabled={disabled} onClick={() => { onDepartureChange(place.title); onDepartureContentidChange(String(place.contentid)); setResults([]); setSearched(false); setMessage(''); }}>{place.title}<span>{place.address ?? place.category ?? '주소 미확인'}</span></button></li>)}</ul>}
    {message && <p id="departure-search-status" className="prep-schedule-search-status" role={searched ? 'status' : 'alert'} aria-live="polite">{message}</p>}
    <div className="prep-schedule-departure">
      <div className="field"><label htmlFor="return-route">복귀 장소 <span className="prep-optional">선택</span></label><input id="return-route" className="text-input" maxLength={100} value={returnRoute} placeholder="예: 청주역" disabled={disabled} onChange={event => onReturnRouteChange(event.target.value)} />{returnRouteError && <p className="field-error" role="alert">{returnRouteError}</p>}</div>
    </div>
  </section>;
}
