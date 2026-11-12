import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
  const departureSearchRef = useRef<HTMLDivElement>(null);
  const resultsEpoch = useRef(0);
  const resultsId = useId();
  useEffect(() => () => { searchEpoch.current += 1; searchController.current?.abort(); }, [tripId]);
  const dismissResults = useCallback(() => {
    searchEpoch.current += 1;
    searchController.current?.abort();
    searchController.current = null;
    resultsEpoch.current = 0;
    setBusy(false);
    setResults([]);
    setSearched(false);
  }, []);
  useEffect(() => {
    if (!results.length && !busy) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !departureSearchRef.current?.contains(event.target)) dismissResults();
    };
    document.addEventListener('pointerdown', dismissOutside);
    return () => document.removeEventListener('pointerdown', dismissOutside);
  }, [busy, dismissResults, results.length]);
  function selectPlace(place: PlaceSearchResult) {
    if (resultsEpoch.current === 0 || resultsEpoch.current !== searchEpoch.current) return;
    onDepartureChange(place.title);
    onDepartureContentidChange(String(place.contentid));
    dismissResults();
    setMessage('');
    departureInputRef.current?.focus();
  }
  async function search() {
    const searchText = departure.trim();
    if (!searchText) { dismissResults(); setMessage('출발 장소를 입력해 주세요.'); departureInputRef.current?.focus(); return; }
    searchController.current?.abort();
    const controller = new AbortController(); searchController.current = controller;
    const own = ++searchEpoch.current;
    resultsEpoch.current = 0;
    setBusy(true); setMessage(''); setResults([]); setSearched(false);
    try {
      const found = await searchPlaces(tripId, searchText, controller.signal);
      if (own === searchEpoch.current && !controller.signal.aborted) { resultsEpoch.current = own; setResults(found); setSearched(true); if (!found.length) setMessage('검색 결과가 없어요. 장소 이름을 다시 확인해 주세요.'); }
    }
    catch (error) { if (own === searchEpoch.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '출발 장소를 검색하지 못했어요.'); }
    finally { if (own === searchEpoch.current) setBusy(false); }
  }
  return <section className="prep-schedule-fields" aria-label="출발 정보">
    <div className="prep-schedule-departure">
      <div className="field">
        <label htmlFor="departure">출발 장소</label>
        <div className="prep-departure-control" ref={departureSearchRef} onBlur={event => {
          const nextTarget = event.relatedTarget;
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) dismissResults();
        }}>
          <form className="prep-departure-search" onSubmit={event => { event.preventDefault(); departureInputRef.current?.focus(); void search(); }}>
            <input
              ref={departureInputRef}
              id="departure"
              className="text-input"
              maxLength={100}
              value={departure}
              placeholder="예: 청주역"
              disabled={disabled}
              aria-controls={results.length ? resultsId : undefined}
              aria-describedby={[departureError ? 'departure-error' : '', departureContentidError ? 'departure-place-error' : '', message ? 'departure-search-status' : ''].filter(Boolean).join(' ') || undefined}
              aria-invalid={Boolean(departureError || departureContentidError)}
              onChange={event => {
                searchEpoch.current += 1;
                searchController.current?.abort();
                resultsEpoch.current = 0;
                setBusy(false);
                setResults([]);
                setSearched(false);
                setMessage('');
                onDepartureChange(event.target.value);
                onDepartureContentidChange('');
              }}
              onKeyDown={event => {
                if (event.key === 'Escape' && (results.length || busy)) { event.preventDefault(); dismissResults(); }
                else if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); (document.getElementById(`${resultsId}-0`) as HTMLButtonElement | null)?.focus(); }
                else if (event.key === 'Enter' && results.length) { event.preventDefault(); selectPlace(results[0]); }
              }}
            />
            <button className="prep-search-icon" type="submit" aria-controls={results.length ? resultsId : undefined} aria-expanded={Boolean(results.length)} title="출발 장소 검색" aria-label={busy ? '출발 장소 검색 중' : '출발 장소 검색'} disabled={disabled || busy}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                <circle cx="10.7" cy="10.7" r="6.4" /><path d="m15.4 15.4 4.2 4.2" />
              </svg>
            </button>
          </form>
          {results.length > 0 && <ul className="prep-schedule-place-results prep-departure-place-results" id={resultsId} aria-label="출발 장소 검색 결과">
            {results.map((place, index) => <li key={place.contentid}>
              <button
                id={`${resultsId}-${index}`}
                type="button"
                className="prep-schedule-place-result prep-departure-place-result"
                disabled={disabled}
                onMouseDown={event => event.preventDefault()}
                onKeyDown={event => {
                  if (event.key === 'Escape') { event.preventDefault(); dismissResults(); departureInputRef.current?.focus(); }
                  else if (event.key === 'ArrowDown') { event.preventDefault(); (document.getElementById(`${resultsId}-${Math.min(index + 1, results.length - 1)}`) as HTMLButtonElement | null)?.focus(); }
                  else if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) departureInputRef.current?.focus(); else (document.getElementById(`${resultsId}-${index - 1}`) as HTMLButtonElement | null)?.focus(); }
                }}
                onClick={() => selectPlace(place)}
              >
                <strong>{place.title}</strong><span>{place.address?.trim() || '주소 미확인'}</span>
              </button>
            </li>)}
          </ul>}
        </div>
        {departureError && <p className="field-error" id="departure-error" role="alert">{departureError}</p>}
        {departureContentidError && <p className="field-error" id="departure-place-error" role="alert">{departureContentidError}</p>}
      </div>
      <div className="field"><label htmlFor="prep-departure-time">출발 시간</label><input id="prep-departure-time" className="text-input" type="time" value={value.departureTime} disabled={disabled} onChange={event => onChange('departureTime', event.target.value)} />{departureTimeError && <p className="field-error" role="alert">{departureTimeError}</p>}</div>
    </div>
    {message && <p id="departure-search-status" className="prep-schedule-search-status" role={searched ? 'status' : 'alert'} aria-live="polite">{message}</p>}
    <div className="prep-schedule-departure">
      <div className="field"><label htmlFor="return-route">복귀 장소 <span className="prep-optional">선택</span></label><input id="return-route" className="text-input" maxLength={100} value={returnRoute} placeholder="예: 청주역" disabled={disabled} onChange={event => onReturnRouteChange(event.target.value)} />{returnRouteError && <p className="field-error" role="alert">{returnRouteError}</p>}</div>
    </div>
  </section>;
}
