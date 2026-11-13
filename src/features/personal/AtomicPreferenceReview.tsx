import { countValueRepresentedByFrequency, editAtomicCondition, type AtomicCondition, type AtomicPreferences } from '../room/roomData.ts';
import './atomic-preference-review.css';

const label = (condition: AtomicCondition) => ({
  activity: '활동', food: '음식', walking: '걷기', visit_count: '방문 횟수', meal_plan: '식사',
  atmosphere: '분위기', accessibility: '편의', other: '기타',
}[condition.dimension]);

function frequencyLabel(condition: AtomicCondition): string {
  if (!condition.frequency) return '';
  const { count, operator, period } = condition.frequency;
  const unit = condition.unit && ['번', '회', '곳', '군데', '끼', '개'].includes(condition.unit)
    ? condition.unit
    : condition.dimension === 'visit_count' ? '곳' : condition.dimension === 'meal_plan' ? '끼' : '회';
  const approximate = condition.approximate || operator === 'target';
  const suffix = operator === 'min' ? ' 이상' : operator === 'max' ? ' 이하' : '';
  return `${period === 'day' ? '하루' : '여행 중'} ${approximate ? '약 ' : ''}${count}${unit}${suffix}`;
}

export default function AtomicPreferenceReview({ profile, disabled, onChange }: {
  profile: AtomicPreferences; disabled?: boolean; onChange: (profile: AtomicPreferences) => void;
}) {
  const update = (id: string, patch: Partial<AtomicCondition>) => onChange({
    ...profile, conditions: profile.conditions.map(item => item.id === id
      ? editAtomicCondition(item, patch)
      : item),
  });
  return <section className="atomic-review" aria-labelledby="atomic-review-title">
    <div className="atomic-review__heading">
      <h4 id="atomic-review-title">분석한 세부 조건</h4>
      <span className={`atomic-review__state atomic-review__state--${profile.status}`}>{profile.status === 'current' ? '현재 원문 기준' : '다시 분석 필요'}</span>
    </div>
    {profile.conditions.length === 0 && <p className="atomic-review__empty">확인된 세부 조건이 없어요.</p>}
    <ul className="atomic-review__list">
      {profile.conditions.map(condition => <li className="atomic-review__item" key={condition.id}>
        <details className="atomic-review__details">
          <summary className="atomic-review__summary">
            <span className="atomic-review__dimension">{label(condition)}</span><strong>{condition.target || '조건 내용 입력'}</strong>
            <span>{condition.polarity === 'prefer' ? '선호' : condition.polarity === 'avoid' ? '피하기' : '제한'}</span>
            {condition.priority !== 'preferred' && <span className="atomic-review__priority">{condition.priority === 'required' ? '필수' : '중요도 미정'}</span>}
            {condition.frequency && <span>{frequencyLabel(condition)}</span>}
            {condition.origin === 'user' && <span className="atomic-review__edited">직접 수정</span>}
            <span className="atomic-review__expand"><span className="atomic-review__closed-label">자세히</span><span className="atomic-review__open-label">접기</span></span>
          </summary>
          <div className="atomic-review__editor">
            <div className="atomic-review__row">
              <label htmlFor={`atomic-target-${condition.id}`}>조건 내용</label>
              <input id={`atomic-target-${condition.id}`} className="text-input atomic-review__target" value={condition.target} maxLength={240} disabled={disabled} aria-invalid={!condition.target.trim()} onChange={event => update(condition.id, { target: event.target.value })} />
              <label htmlFor={`atomic-polarity-${condition.id}`}>방향</label>
              <select id={`atomic-polarity-${condition.id}`} className="text-input atomic-review__select" value={condition.polarity} disabled={disabled} onChange={event => update(condition.id, { polarity: event.target.value as AtomicCondition['polarity'] })}>
                <option value="prefer">선호</option><option value="avoid">피하기</option><option value="limit">제한</option>
              </select>
              <label htmlFor={`atomic-priority-${condition.id}`}>중요도</label>
              <select id={`atomic-priority-${condition.id}`} className="text-input atomic-review__select" value={condition.priority} disabled={disabled} onChange={event => update(condition.id, { priority: event.target.value as AtomicCondition['priority'] })}>
                <option value="unspecified">중요도 미정</option><option value="preferred">선호</option><option value="required">필수</option>
              </select>
            </div>
            {!condition.target.trim() && <p className="atomic-review__error" role="alert">조건 내용을 입력하거나 항목을 삭제해 주세요.</p>}
            <div className="atomic-review__meta">
              <span>범위: {condition.scope === 'unspecified' ? '미정' : condition.scope === 'trip' ? '여행 전체' : condition.scope === 'day' ? '하루' : '일부 일정'}</span>
              {condition.frequency && <div className="atomic-review__frequency">
                <label htmlFor={`atomic-count-${condition.id}`}>횟수</label>
                <input id={`atomic-count-${condition.id}`} className="text-input atomic-review__count" type="number" min="0" max="365" value={condition.frequency.count} disabled={disabled} onChange={event => update(condition.id, { frequency: { ...condition.frequency!, count: Math.min(365, Math.max(0, Number(event.target.value) || 0)) } })} />
                <select className="text-input atomic-review__select" aria-label="횟수 기준" value={condition.frequency.operator} disabled={disabled} onChange={event => update(condition.id, { frequency: { ...condition.frequency!, operator: event.target.value as NonNullable<AtomicCondition['frequency']>['operator'] } })}><option value="exact">정확히</option><option value="min">이상</option><option value="max">이하</option><option value="target">정도</option></select>
                <select className="text-input atomic-review__select" aria-label="횟수 범위" value={condition.frequency.period} disabled={disabled} onChange={event => update(condition.id, { frequency: { ...condition.frequency!, period: event.target.value as NonNullable<AtomicCondition['frequency']>['period'] } })}><option value="trip">여행 중</option><option value="day">하루</option></select>
              </div>}
              {typeof condition.value === 'number' && !countValueRepresentedByFrequency(condition) && <label>수량
                <input className="text-input atomic-review__count" type="number" min="0" value={condition.value} disabled={disabled} onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) update(condition.id, { value: Number(event.target.value) }); }} />
                {condition.unit && <span>{condition.unit}</span>}
              </label>}
              {typeof condition.value === 'string' && !countValueRepresentedByFrequency(condition) && <label>수량
                <input className="text-input atomic-review__target" value={condition.value} maxLength={160} disabled={disabled} onChange={event => update(condition.id, { value: event.target.value })} />
                {condition.unit && <span>{condition.unit}</span>}
              </label>}
              {condition.approximate && <span>약</span>}
            </div>
            {condition.evidence && <p className="atomic-review__evidence">{condition.origin === 'user' ? '분석 원문 근거' : '원문 근거'}: “{condition.evidence}”</p>}
            <button type="button" className="atomic-review__remove" disabled={disabled} onClick={() => onChange({ ...profile, conditions: profile.conditions.filter(item => item.id !== condition.id) })}>조건 삭제</button>
          </div>
        </details>
      </li>)}
    </ul>
    {profile.unresolved.length > 0 && <div className="atomic-review__unresolved"><strong>뜻을 확정하지 않은 내용</strong><ul>{profile.unresolved.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}{item.evidence && <> · “{item.evidence}”</>}</li>)}</ul></div>}
  </section>;
}
