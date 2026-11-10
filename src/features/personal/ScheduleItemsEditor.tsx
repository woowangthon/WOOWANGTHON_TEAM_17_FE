import { useEffect, useRef, useState } from 'react';
import Button from '../../components/ui/Button';
import { searchPlaces, type PlaceSearchResult } from '../workspace/canvasApi.ts';
import type { ScheduleItem } from '../room/roomData.ts';

type Clarification = { itemId: string; fields: string[]; code: string; candidates: Array<{ contentid: number; title: string; address: string | null }> };

export default function ScheduleItemsEditor({ tripId, items, clarifications, canSetGroup, disabled, onChange }: {
  tripId: string; items: ScheduleItem[]; clarifications: Clarification[]; canSetGroup: boolean; disabled: boolean; onChange: (items: ScheduleItem[]) => void;
}) {
  const [searchingId, setSearchingId] = useState<string | null>(null);
  const [query, setQuery] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, PlaceSearchResult[]>>({});
  const [message, setMessage] = useState('');
  const searchEpochs = useRef(new Map<string, number>());
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => { controllers.current.forEach(controller => controller.abort()); controllers.current.clear(); }, [tripId]);
  const change = (id: string, patch: Partial<ScheduleItem>) => onChange(items.map(item => item.id === id ? { ...item, ...patch } : item));
  async function find(item: ScheduleItem) {
    const q = (query[item.id] ?? item.placeQuery).trim();
    if (!q) return;
    controllers.current.get(item.id)?.abort();
    const controller = new AbortController(); controllers.current.set(item.id, controller);
    const epoch = (searchEpochs.current.get(item.id) ?? 0) + 1; searchEpochs.current.set(item.id, epoch);
    setSearchingId(item.id); setMessage('');
    try { const found = await searchPlaces(tripId, q, controller.signal); if (searchEpochs.current.get(item.id) === epoch && !controller.signal.aborted) setResults(old => ({ ...old, [item.id]: found })); }
    catch (error) { if (searchEpochs.current.get(item.id) === epoch && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : '장소를 검색하지 못했어요.'); }
    finally { if (searchEpochs.current.get(item.id) === epoch) setSearchingId(null); }
  }
  return <section className="prep-schedule-items" aria-label="분석된 숙소와 약속">
    <h3>일정에 반영할 숙소와 약속</h3>
    <p>분석된 항목을 확인하고, 장소는 검색 결과에서 선택해 주세요.</p>
    {!items.length && <p>분석된 숙소나 고정 약속이 없어요.</p>}
    {items.map(item => {
      const clarification = clarifications.find(value => value.itemId === item.id);
      const fieldLabels: Record<string, string> = { placeQuery: '장소', contentid: '장소', date: item.kind === 'lodging' ? '입실 날짜' : '날짜', time: item.kind === 'lodging' ? '입실 시간' : '시간', endDate: item.kind === 'lodging' ? '퇴실 날짜' : '종료 날짜', endTime: item.kind === 'lodging' ? '퇴실 시간' : '종료 시간', scope: '공유 범위', scheduleItems: '일정 내용' };
      const missingFields = (clarification?.fields ?? []).filter(field => !(item.contentid !== null && ['placeQuery', 'contentid'].includes(field)));
      const missingLabels = [...new Set(missingFields.map(field => fieldLabels[field]).filter(Boolean))];
      const itemQuery = query[item.id] ?? item.placeQuery;
      const itemResults = results[item.id] ?? [];
      return <article key={item.id} className="prep-schedule-item">
        <header><strong>{item.kind === 'lodging' ? '숙소' : '고정 약속'}</strong>{missingLabels.length > 0 && <span role="status">확인 필요: {missingLabels.join(', ')}</span>}<button type="button" disabled={disabled} aria-label={`${item.kind === 'lodging' ? '숙소' : '약속'} 항목 삭제`} onClick={() => onChange(items.filter(value => value.id !== item.id))}>삭제</button></header>
        <div className="prep-two-fields">
          <div className="field"><label htmlFor={`schedule-query-${item.id}`}>장소 이름 또는 검색어</label><input id={`schedule-query-${item.id}`} className="text-input" maxLength={200} value={itemQuery} disabled={disabled} onChange={event => { controllers.current.get(item.id)?.abort(); searchEpochs.current.set(item.id, (searchEpochs.current.get(item.id) ?? 0) + 1); setSearchingId(null); setResults(old => ({ ...old, [item.id]: [] })); setQuery(old => ({ ...old, [item.id]: event.target.value })); change(item.id, { placeQuery: event.target.value, contentid: null }); }} /></div>
          <div className="field"><label htmlFor={`schedule-date-${item.id}`}>{item.kind === 'lodging' ? '입실 날짜' : '날짜'}</label><input id={`schedule-date-${item.id}`} className="text-input" type="date" value={item.date ?? ''} disabled={disabled} onChange={event => change(item.id, { date: event.target.value || null })} /></div>
        </div>
        <div className="prep-two-fields">
          <div className="field"><label htmlFor={`schedule-end-date-${item.id}`}>{item.kind === 'lodging' ? '퇴실 날짜' : '종료 날짜'} <span>선택</span></label><input id={`schedule-end-date-${item.id}`} className="text-input" type="date" value={item.endDate ?? ''} disabled={disabled} onChange={event => change(item.id, { endDate: event.target.value || null })} /></div>
          <div className="field"><label htmlFor={`schedule-time-${item.id}`}>{item.kind === 'lodging' ? '입실 시간' : '시간'}</label><input id={`schedule-time-${item.id}`} className="text-input" type="time" value={item.time ?? ''} disabled={disabled} onChange={event => change(item.id, { time: event.target.value || null })} /></div>
        </div>
        <div className="prep-two-fields">
          <div className="field"><label htmlFor={`schedule-end-time-${item.id}`}>{item.kind === 'lodging' ? '퇴실 시간' : '종료 시간'} <span>선택</span></label><input id={`schedule-end-time-${item.id}`} className="text-input" type="time" value={item.endTime ?? ''} disabled={disabled} onChange={event => change(item.id, { endTime: event.target.value || null })} /></div>
        </div>
        <div className="prep-schedule-item-actions"><Button variant="secondary" disabled={disabled || searchingId === item.id || !itemQuery.trim()} onClick={() => void find(item)}>{searchingId === item.id ? '검색 중…' : '장소 검색'}</Button><span>{item.contentid === null ? '장소 미선택' : '장소 선택됨'}</span></div>
        {clarification?.candidates.map(place => <button type="button" className="prep-schedule-place-result" key={place.contentid} disabled={disabled} onClick={() => { change(item.id, { placeQuery: place.title, contentid: place.contentid }); setQuery(old => ({ ...old, [item.id]: place.title })); }}>{place.title}<span>{place.address ?? '주소 미확인'}</span></button>)}
        {itemResults.map(place => <button type="button" className="prep-schedule-place-result" key={place.contentid} disabled={disabled} onClick={() => { change(item.id, { placeQuery: place.title, contentid: place.contentid }); setQuery(old => ({ ...old, [item.id]: place.title })); setResults(old => ({ ...old, [item.id]: [] })); }}><strong>{place.title}</strong><span>{place.address ?? place.category ?? '주소 미확인'}</span></button>)}
        <div className="field"><label htmlFor={`schedule-scope-${item.id}`}>일정 공유 범위</label><select id={`schedule-scope-${item.id}`} className="text-input" value={item.scope ?? ''} disabled={disabled} onChange={event => change(item.id, { scope: event.target.value === 'group' ? 'group' : event.target.value === 'personal' ? 'personal' : null })}><option value="">선택해 주세요</option><option value="personal">개인 일정</option>{canSetGroup ? <option value="group">공통 일정</option> : item.scope === 'group' ? <option value="group" disabled>공통 일정 (방장만)</option> : null}</select></div>
        {item.scope === 'personal' && <small>개인 일정으로 보관해요. 공통 코스에는 고정하지 않아요.</small>}
        {item.scope === 'group' && canSetGroup && <small>공통 일정으로 모두의 코스에 반영돼요.</small>}
        {clarification?.fields.includes('scheduleItems') && clarification.code === 'PERSONAL_SCHEDULE_NOT_SHARED' && <small role="status">이 항목은 본인에게만 보여요. 공통 조건으로 바꾸려면 방장에게 요청해 주세요.</small>}
      </article>;
    })}
    {message && <p role="alert">{message}</p>}
  </section>;
}
