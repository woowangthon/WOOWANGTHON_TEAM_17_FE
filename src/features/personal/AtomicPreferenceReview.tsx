import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  atomicConditionTags, editAtomicCondition, formatAtomicCondition, isVerbatimEvidence, validateUserAtomicCondition,
  type AtomicCondition, type AtomicPreferences, type UnresolvedAcknowledgement,
  type UnresolvedNote, type UnresolvedAcknowledgements,
} from '../room/roomData.ts';
import PreparationActionButton from '../preparation/PreparationActionButton';
import { getEvidenceChoices } from './evidenceChoices.ts';
import './atomic-preference-review.css';

const noteKey = (note: UnresolvedNote) => `${note.code}\u0000${note.evidence}\u0000${note.message}`;
const dimensions: Array<[AtomicCondition['dimension'], string]> = [['activity','활동'],['food','음식'],['walking','걷기'],['visit_count','방문 횟수'],['meal_plan','식사'],['atmosphere','분위기'],['accessibility','편의'],['other','기타']];
const countCategories = new Set<AtomicCondition['dimension']>(['food', 'visit_count', 'meal_plan']);

function ConditionEditor({ condition: initial, originalText, disabled, onCancel, onApply }: {
  condition: AtomicCondition; originalText: string; disabled?: boolean;
  onCancel: () => void; onApply: (condition: AtomicCondition) => void;
}) {
  const [condition, setCondition] = useState(initial);
  const [frequencyInput, setFrequencyInput] = useState(initial.frequency ? String(initial.frequency.count) : '');
  const [error, setError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const evidenceChoices = useMemo(() => getEvidenceChoices(originalText), [originalText]);
  const [evidenceMode, setEvidenceMode] = useState<'preview' | 'choice' | 'manual'>(initial.evidence ? 'preview' : 'choice');
  const [selectedChoice, setSelectedChoice] = useState(() => {
    if (!initial.evidence) return '';
    const matching = evidenceChoices.filter(choice => choice.text === initial.evidence);
    return matching.length === 1 ? matching[0]!.key : 'current';
  });
  const [shortEvidenceChoices] = useState(() => {
    const initialMatches = evidenceChoices.filter(choice => choice.text === initial.evidence);
    const current = initial.evidence && initialMatches.length !== 1 ? [{ text: initial.evidence }] : [];
    const choices = [...evidenceChoices, ...current];
    return evidenceChoices.length > 0 && choices.length <= 6 && choices.every(choice => choice.text.length <= 160) && choices.reduce((total, choice) => total + choice.text.length, 0) <= 420;
  });
  const targetInput = useRef<HTMLInputElement>(null);
  const evidenceInput = useRef<HTMLTextAreaElement>(null);
  const evidenceSelect = useRef<HTMLSelectElement>(null);
  const evidenceChoiceGroup = useRef<HTMLFieldSetElement>(null);
  const frequencyInputRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const evidenceSelectId = useId();
  const evidenceManualId = useId();
  const evidenceErrorId = useId();
  const evidenceStatusId = useId();
  useEffect(() => { targetInput.current?.focus(); }, []);
  const patch = (value: Partial<AtomicCondition>) => {
    setError('');
    setCondition(current => editAtomicCondition(current, value));
  };
  const frequency = condition.frequency;
  const openChoice = () => {
    const matching = evidenceChoices.filter(choice => choice.text === condition.evidence);
    const explicit = evidenceChoices.find(choice => choice.key === selectedChoice && choice.text === condition.evidence);
    setSelectedChoice(explicit?.key ?? (matching.length === 1 ? matching[0]!.key : condition.evidence ? 'current' : ''));
    setEvidenceMode('choice');
    requestAnimationFrame(() => (evidenceSelect.current ?? evidenceChoiceGroup.current?.querySelector('button'))?.focus());
  };
  const openManual = () => { setEvidenceMode('manual'); requestAnimationFrame(() => evidenceInput.current?.focus()); };
  const selectEvidence = (key: string) => {
    setSelectedChoice(key);
    setError('');
    if (key === 'current') return;
    const choice = evidenceChoices.find(item => item.key === key);
    if (!choice) return;
    const exactSourceSlice = originalText.slice(choice.start, choice.end);
    setCondition(current => editAtomicCondition(current, { evidence: exactSourceSlice }));
  };
  const apply = () => {
    const validation = validateUserAtomicCondition(condition, originalText, Boolean(frequency), frequencyInput);
    if (validation) {
      setError(validation);
      if (!condition.target.trim() || condition.target.length > 240) targetInput.current?.focus();
      else if (!isVerbatimEvidence(originalText, condition.evidence)) {
        if (evidenceMode === 'manual') requestAnimationFrame(() => evidenceInput.current?.focus());
        else openChoice();
      }
      else if (frequency && (!/^(0|[1-9]\d*)$/u.test(frequencyInput) || Number(frequencyInput) > 365 || frequency.count !== Number(frequencyInput))) {
        setDetailsOpen(true);
        requestAnimationFrame(() => frequencyInputRef.current?.focus());
      } else if (validation.includes('값') || validation.includes('단위')) {
        setDetailsOpen(true);
        requestAnimationFrame(() => {
          const field = document.querySelector<HTMLElement>(`.atomic-review__editor [data-atomic-field="${validation.includes('단위') ? 'unit' : 'value'}"]`);
          (field?.matches('input, select, textarea') ? field : field?.querySelector<HTMLElement>('input, select, textarea'))?.focus();
        });
      }
      return;
    }
    onApply({ ...condition, target: condition.target.trim(), evidence: condition.evidence });
  };
  const categoryChoice = <label className="atomic-review__field atomic-review__category" data-atomic-field="dimension">
    <span>분류</span><select className="text-input" value={condition.dimension} disabled={disabled} onChange={event => patch({ dimension: event.target.value as AtomicCondition['dimension'] })}>{dimensions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
  </label>;
  const polarityLabels = [['prefer', '원해요'], ['avoid', '피해요'], ['limit', '제한해요']];
  const evidenceInvalid = !isVerbatimEvidence(originalText, condition.evidence);
  const evidenceError = error?.includes('원문') ? error : '';
  const matchingEvidenceChoices = evidenceChoices.filter(choice => choice.text === condition.evidence);
  const explicitEvidenceChoice = evidenceChoices.some(choice => choice.key === selectedChoice && choice.text === condition.evidence);
  const currentEvidenceChoice = condition.evidence && !explicitEvidenceChoice && matchingEvidenceChoices.length !== 1 ? { key: 'current', text: condition.evidence } : null;
  const evidenceControl = <div className="atomic-review__evidence" data-atomic-field="evidence">
    {evidenceMode === 'preview' ? <span className="atomic-review__field-label">{condition.origin === 'user' ? '관련 원문 근거' : '내가 쓴 원문'}</span> : evidenceMode === 'choice' && shortEvidenceChoices ? null : <label className="atomic-review__field-label" htmlFor={evidenceMode === 'manual' ? evidenceManualId : evidenceSelectId}>{evidenceMode === 'choice' ? '원문에서 구절 선택' : condition.origin === 'user' ? '직접 입력한 관련 원문 근거' : '원문 근거 직접 입력'}</label>}
    {condition.evidence && evidenceMode !== 'manual' && <div className="atomic-review__evidence-preview">
      {(evidenceInvalid || evidenceMode === 'choice') && <p id={evidenceInvalid ? evidenceStatusId : undefined} className="atomic-review__evidence-caption" role={evidenceInvalid ? 'status' : undefined}>{evidenceInvalid ? '현재 근거 · 원문 확인 필요' : '선택한 원문'}</p>}
      <q>{condition.evidence}</q>
      {evidenceMode === 'preview' && <div className="atomic-review__evidence-actions"><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={openChoice}>원문에서 바꾸기</button><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={openManual}>직접 입력</button></div>}
    </div>}
    {evidenceMode === 'choice' && <div className="atomic-review__evidence-entry">
      {shortEvidenceChoices ? <fieldset ref={evidenceChoiceGroup} className="atomic-review__choice-buttons" data-atomic-field="evidence-choice" disabled={disabled} aria-invalid={Boolean(evidenceError || (evidenceInvalid && condition.evidence)) || undefined} aria-describedby={evidenceError ? evidenceErrorId : evidenceInvalid && condition.evidence ? evidenceStatusId : undefined}>
        <legend>원문에서 구절 선택</legend>
        <div>{evidenceChoices.map(choice => <button key={choice.key} type="button" data-evidence-key={choice.key} aria-pressed={selectedChoice === choice.key} className={selectedChoice === choice.key ? 'is-selected' : ''} disabled={disabled} onClick={() => selectEvidence(choice.key)}><span>{choice.text}</span>{selectedChoice === choice.key && <span className="atomic-review__choice-check" aria-hidden="true">✓</span>}</button>)}
          {currentEvidenceChoice && <button type="button" data-evidence-key="current" aria-pressed={selectedChoice === 'current'} className={selectedChoice === 'current' ? 'is-selected' : ''} disabled={disabled} onClick={() => selectEvidence('current')}><span>{evidenceInvalid ? '현재 근거 · 원문 확인 필요' : '현재 근거'}</span>{selectedChoice === 'current' && <span className="atomic-review__choice-check" aria-hidden="true">✓</span>}</button>}
        </div>
      </fieldset> : <select ref={evidenceSelect} id={evidenceSelectId} data-atomic-field="evidence-choice" className="text-input" value={selectedChoice} disabled={disabled} aria-label="원문에서 구절 선택" aria-invalid={Boolean(evidenceError || (evidenceInvalid && condition.evidence)) || undefined} aria-describedby={evidenceError ? evidenceErrorId : evidenceInvalid && condition.evidence ? evidenceStatusId : undefined} onChange={event => selectEvidence(event.target.value)}>
        <option value="" disabled>원문에서 구절 선택</option>
        {currentEvidenceChoice && <option value="current">{evidenceInvalid ? '현재 근거 · 원문 확인 필요' : '현재 근거'}</option>}
        {evidenceChoices.map(choice => <option key={choice.key} value={choice.key}>{choice.text}</option>)}
      </select>}
      {!evidenceChoices.length && <p className="atomic-review__hint">선택할 원문 구절이 없어요. 직접 입력하거나 원문을 확인해 주세요.</p>}
      <button type="button" className="atomic-review__text-button" disabled={disabled} onClick={openManual}>직접 입력</button>
    </div>}
    {evidenceMode === 'manual' && <div className="atomic-review__evidence-entry">
      {evidenceInvalid && condition.evidence && <p id={evidenceStatusId} className="atomic-review__evidence-status" role="status">현재 근거 · 원문 확인 필요</p>}
      <textarea ref={evidenceInput} id={evidenceManualId} data-atomic-field="evidence-manual" className="text-input atomic-review__evidence-input" value={condition.evidence} maxLength={1000} disabled={disabled} onChange={event => { setError(''); setCondition(current => editAtomicCondition(current, { evidence: event.target.value })); }} placeholder="원문에 포함된 구절을 붙여 넣거나 입력해 주세요" aria-label={condition.origin === 'user' ? '직접 입력한 관련 원문 근거' : '원문 근거 직접 입력'} aria-invalid={Boolean(evidenceError || (evidenceInvalid && condition.evidence)) || undefined} aria-describedby={evidenceError ? evidenceErrorId : evidenceInvalid && condition.evidence ? evidenceStatusId : undefined} />
      <button type="button" className="atomic-review__text-button" disabled={disabled} onClick={openChoice}>원문에서 구절 선택</button>
      <p className="atomic-review__hint">원문에서 확인되는 문장을 그대로 입력해 주세요. 띄어쓰기와 문장부호도 원문과 같아야 해요.</p>
    </div>}
  </div>;
  // Keep a field in the same place while typing; reclassify after apply/reopen.
  const valueHasIndependentMeaning = initial.value !== null && !(initial.frequency && typeof initial.value === 'number' && initial.value === initial.frequency.count && initial.unit && ['번','회','곳','군데','끼','개'].includes(initial.unit));
  return <div className="atomic-review__editor atomic-review__editor--edit" aria-label="조건 수정">
    <div className="atomic-review__editor-heading">
      <strong>세부 조건 수정</strong>
    </div>
    <div className="atomic-review__main-line">
      <label className="atomic-review__target-field" data-atomic-field="target">
        <span>{condition.dimension === 'activity' ? '원하는 장소·활동' : condition.dimension === 'food' ? '음식·메뉴' : condition.dimension === 'walking' ? '걷기 기준' : condition.dimension === 'visit_count' ? '방문 기준' : condition.dimension === 'meal_plan' ? '식사 기준' : condition.dimension === 'atmosphere' ? '원하는 분위기' : condition.dimension === 'accessibility' ? '필요한 편의' : '조건 내용'}</span>
        <input ref={targetInput} className="text-input" value={condition.target} maxLength={240} disabled={disabled} onChange={event => patch({ target: event.target.value })} placeholder="예: 조용한 카페" />
      </label>
    </div>
    <fieldset className="atomic-review__polarity" data-atomic-field="polarity" disabled={disabled}>
      <legend>어떤 조건인가요?</legend>
      {polarityLabels.map(([value, label]) => <label key={value} className={condition.polarity === value ? 'is-selected' : ''}><input type="radio" name={`polarity-${condition.id}`} value={value} checked={condition.polarity === value} onChange={() => patch({ polarity: value as AtomicCondition['polarity'] })} /><span>{label}</span></label>)}
    </fieldset>
    {frequency && <div className="atomic-review__frequency" data-atomic-field="frequency">
      <span className="atomic-review__frequency-prefix">{condition.dimension === 'food' ? '먹는 횟수' : condition.dimension === 'meal_plan' ? '식사 횟수' : condition.dimension === 'visit_count' ? '방문 횟수' : '횟수'}</span>
      <label className="atomic-review__frequency-count"><span className="sr-only">횟수</span><input ref={frequencyInputRef} data-atomic-field="frequency-count" className="text-input" type="number" min="0" max="365" step="1" value={frequencyInput} disabled={disabled} onChange={event => {
        const input = event.target.value;
        setFrequencyInput(input); setError('');
        if (input !== '' && /^-?\d+$/u.test(input)) patch({ frequency: { count: Number(input) } as AtomicCondition['frequency'] });
      }} aria-label="횟수" /></label>
      <label><span className="sr-only">횟수 기준</span><select data-atomic-field="frequency-operator" className="text-input" value={frequency.operator} disabled={disabled} onChange={event => patch({ frequency: { operator: event.target.value as NonNullable<AtomicCondition['frequency']>['operator'] } as AtomicCondition['frequency'] })}><option value="exact">정확히</option><option value="min">이상</option><option value="max">이하</option><option value="target">정도</option></select></label>
      <label><span className="sr-only">횟수 기간</span><select data-atomic-field="frequency-period" className="text-input" value={frequency.period} disabled={disabled} onChange={event => patch({ frequency: { period: event.target.value as 'trip' | 'day' } as AtomicCondition['frequency'] })}><option value="trip">여행 중</option><option value="day">하루</option></select></label>
      <button type="button" className="atomic-review__text-button" disabled={disabled} onClick={() => { patch({ frequency: null }); setFrequencyInput(''); }}>횟수 빼기</button>
    </div>}
    {!frequency && countCategories.has(condition.dimension) && <button type="button" className="atomic-review__frequency-add" disabled={disabled} onClick={() => { setError(''); setFrequencyInput(''); patch({ frequency: { count: 0, operator: 'exact', period: 'trip' } }); requestAnimationFrame(() => frequencyInputRef.current?.focus()); }}>+ 횟수 추가</button>}
    {valueHasIndependentMeaning && <div className="atomic-review__value-row"><span>값</span><label><span className="sr-only">값</span><input data-atomic-field="value" className="text-input" value={String(condition.value ?? '')} disabled={disabled} onChange={event => { const value = event.target.value; patch({ value: value === '' ? null : /^-?\d+(\.\d+)?$/u.test(value) ? Number(value) : value }); }} /></label><label><span className="sr-only">단위</span><input data-atomic-field="unit" className="text-input" value={condition.unit ?? ''} maxLength={40} disabled={disabled} onChange={event => patch({ unit: event.target.value || null })} placeholder="단위" /></label></div>}
    {evidenceControl}
    <details className="atomic-review__details" ref={detailsRef} open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary>세부 설정</summary>
      <div className="atomic-review__details-body">
        {categoryChoice}
        {!frequency && !countCategories.has(condition.dimension) && <button type="button" className="atomic-review__frequency-add" disabled={disabled} onClick={() => { setError(''); setFrequencyInput(''); setDetailsOpen(true); patch({ frequency: { count: 0, operator: 'exact', period: 'trip' } }); requestAnimationFrame(() => frequencyInputRef.current?.focus()); }}>+ 횟수 추가</button>}
        {!valueHasIndependentMeaning && <div className="atomic-review__scalar-fields" data-atomic-field="value">
          <label className="atomic-review__field"><span>값</span><input data-atomic-field="value" className="text-input" value={condition.value === null ? '' : String(condition.value)} disabled={disabled} onChange={event => { const value = event.target.value; patch({ value: value === '' ? null : /^-?\d+(\.\d+)?$/u.test(value) ? Number(value) : value }); }} /></label>
          <label className="atomic-review__field"><span>단위</span><input data-atomic-field="unit" className="text-input" value={condition.unit ?? ''} maxLength={40} disabled={disabled} onChange={event => patch({ unit: event.target.value || null })} placeholder="예: 분, 원" /></label>
        </div>}
        <label className="atomic-review__field" data-atomic-field="priority"><span>중요도</span><select className="text-input" value={condition.priority} disabled={disabled} onChange={event => patch({ priority: event.target.value as AtomicCondition['priority'] })}><option value="unspecified">정하지 않음</option><option value="preferred">선호</option><option value="required">필수</option></select></label>
        <label className="atomic-review__field" data-atomic-field="scope"><span>적용 범위</span><select className="text-input" value={condition.scope} disabled={disabled} onChange={event => patch({ scope: event.target.value as AtomicCondition['scope'] })}><option value="unspecified">정하지 않음</option><option value="trip">여행 전체</option><option value="day">하루</option><option value="segment">일부 일정</option></select></label>
        <label className="atomic-review__field" data-atomic-field="audience"><span>적용 대상</span><select className="text-input" value={condition.audience} disabled={disabled} onChange={event => patch({ audience: event.target.value as AtomicCondition['audience'] })}><option value="unspecified">정하지 않음</option><option value="personal">나에게</option><option value="group">일행 공통</option></select></label>
        <label className="atomic-review__check" data-atomic-field="approximate"><input type="checkbox" checked={condition.approximate} disabled={disabled} onChange={event => patch({ approximate: event.target.checked })} />값이 대략적이에요</label>
      </div>
    </details>
    {error && <p id={evidenceErrorId} className="atomic-review__error" role="alert">{error}</p>}
    <div className="atomic-review__editor-actions"><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={onCancel}>취소</button><PreparationActionButton className="atomic-review__apply" label="적용" disabled={disabled} onClick={apply} /></div>
  </div>;
}

export default function AtomicPreferenceReview({ profile, originalText, disabled, acknowledgements, savedAcknowledgements,
  sourceChangeBlocked, replaceOnAppend, onChange, onAcknowledge, onAppendPreference, onEditingChange }: {
  profile: AtomicPreferences; originalText: string; disabled?: boolean;
  acknowledgements: UnresolvedAcknowledgements | null; savedAcknowledgements: UnresolvedAcknowledgements | null;
  sourceChangeBlocked: boolean; replaceOnAppend: boolean;
  onChange: (profile: AtomicPreferences) => void;
  onAcknowledge: (note: UnresolvedNote, disposition: UnresolvedAcknowledgement['disposition'] | null) => void;
  onAppendPreference: (sentence: string) => void;
  onEditingChange: (active: boolean) => void;
}) {
  const rowTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const addTrigger = useRef<HTMLButtonElement>(null);
  const pendingSummary = useRef<HTMLHeadingElement>(null);
  const historySummary = useRef<HTMLElement>(null);
  const noteTriggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCondition, setEditingCondition] = useState<AtomicCondition | null>(null);
  const [selectedNote, setSelectedNote] = useState<UnresolvedNote | null>(null);
  const [resolvingNote, setResolvingNote] = useState<UnresolvedNote | null>(null);
  const [noteChoice, setNoteChoice] = useState<'new' | string>('new');
  const [editing, setEditing] = useState(false);
  const [quickEditingId, setQuickEditingId] = useState<string | null>(null);
  const [quickValue, setQuickValue] = useState('');
  const [quickError, setQuickError] = useState('');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState('');
  const [composerError, setComposerError] = useState('');
  const [replaceConfirm, setReplaceConfirm] = useState(false);
  const cancelReplacement = useRef<HTMLButtonElement>(null);
  const replaceMessageId = useId();
  const rowQuickInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const composerInput = useRef<HTMLInputElement>(null);
  const editingSignal = useRef(false);
  const editingCallback = useRef(onEditingChange);
  useEffect(() => { editingCallback.current = onEditingChange; }, [onEditingChange]);
  const unresolved = profile.unresolved;
  const matchingAcks = profile.status === 'current' && acknowledgements?.sourceDigest === profile.sourceDigest ? acknowledgements.items : [];
  const savedMatchingAcks = profile.status === 'current' && savedAcknowledgements?.sourceDigest === profile.sourceDigest ? savedAcknowledgements.items : [];
  const savedKeys = new Set(savedMatchingAcks.map(item => `${noteKey(item.note)}:${item.disposition}`));
  const pendingKeys = new Set(matchingAcks.map(item => `${noteKey(item.note)}:${item.disposition}`));
  const acknowledgementFor = (note: UnresolvedNote) => matchingAcks.find(item => noteKey(item.note) === noteKey(note));
  const acknowledgedNotes = unresolved.filter(note => Boolean(acknowledgementFor(note)));
  const pendingNotes = unresolved.filter(note => !acknowledgementFor(note));
  const focusAfterRender = (getElement: () => HTMLElement | null | undefined) => window.requestAnimationFrame(() => getElement()?.focus());
  const updateCondition = (condition: AtomicCondition) => onChange({ ...profile, conditions: profile.conditions.some(item => item.id === condition.id)
    ? profile.conditions.map(item => item.id === condition.id ? condition : item)
    : [...profile.conditions, condition] });
  const startNoteEditor = (note: UnresolvedNote) => {
    if (disabled || profile.status !== 'current' || editingId) return;
    const existing = profile.conditions.find(item => item.id === noteChoice);
    if (!existing) return;
    const condition = { ...existing, evidence: note.evidence, origin: 'user' as const };
    setResolvingNote(note); setSelectedNote(null); setQuickEditingId(null); setEditingCondition(condition); setEditingId(condition.id);
  };
  const openComposer = (prefill = '') => {
    setQuickEditingId(null);
    setSelectedNote(null);
    setComposerText(prefill);
    setComposerError('');
    setReplaceConfirm(false);
    setComposerOpen(true);
    requestAnimationFrame(() => composerInput.current?.focus());
  };
  const closeComposer = () => {
    setComposerOpen(false); setComposerError(''); setReplaceConfirm(false);
    focusAfterRender(() => addTrigger.current);
  };
  const appendError = (candidate = composerText) => {
    const sentence = candidate.trim();
    if (!sentence) return '추가할 취향을 입력해 주세요.';
    if (!/[\p{L}]/u.test(sentence)) return '숫자만 입력하지 말고 원하는 취향을 문장으로 적어 주세요.';
    const separator = originalText && !originalText.endsWith('\n') ? '\n' : '';
    if ([...(originalText + separator + sentence)].length > 5000) return '원문과 추가 문장의 합은 5,000자 이하여야 해요.';
    return '';
  };
  const submitComposer = () => {
    const message = appendError();
    if (message) { setComposerError(message); composerInput.current?.focus(); return; }
    if (sourceChangeBlocked) return;
    if (replaceOnAppend && !replaceConfirm) {
      setReplaceConfirm(true);
      requestAnimationFrame(() => cancelReplacement.current?.focus());
      return;
    }
    onAppendPreference(composerText.trim());
    setComposerOpen(false); setComposerText(''); setComposerError(''); setReplaceConfirm(false);
  };
  const quickSpec = (condition: AtomicCondition) => {
    if (condition.frequency) {
      const name = condition.dimension === 'food' ? '먹는 횟수' : condition.dimension === 'meal_plan' ? '식사 횟수' : condition.dimension === 'visit_count' ? '방문 횟수' : '횟수';
      const unit = condition.unit && ['번', '회', '곳', '군데', '끼', '개'].includes(condition.unit)
        ? condition.unit : condition.dimension === 'visit_count' ? '곳' : condition.dimension === 'meal_plan' ? '끼' : '회';
      return { kind: 'frequency' as const, label: `${name} (${unit})`, value: String(condition.frequency.count), example: '예: 2' };
    }
    if (typeof condition.value === 'number' && Number.isFinite(condition.value) && condition.unit) {
      const example = condition.unit === '원' ? '예: 10000' : condition.unit === 'km' ? '예: 2' : condition.unit === '분' ? '예: 20' : `예: ${condition.value}`;
      return { kind: 'value' as const, label: `${condition.target} 값 (${condition.unit})`, value: String(condition.value), example };
    }
    if (condition.value !== null) {
      return { kind: 'invalid' as const, label: '값 확인', value: '', example: '세부 조건에서 값을 확인해 주세요' };
    }
    const numericTarget = /^[\d\s.,]+$/u.test(condition.target);
    const example = ({ activity: '예: 소백산', food: '예: 초밥', walking: '예: 오래 걷기',
      visit_count: '예: 여행 중 3곳', meal_plan: '예: 점심·저녁', atmosphere: '예: 조용한 분위기',
      accessibility: '예: 엘리베이터', other: '예: 조용한 카페' } as const)[condition.dimension];
    return { kind: 'target' as const, label: '취향 내용', value: numericTarget ? '' : condition.target, example };
  };
  const beginQuickEdit = (condition: AtomicCondition) => {
    const spec = quickSpec(condition);
    setQuickEditingId(condition.id); setQuickValue(spec.value); setQuickError('');
    setResolvingNote(null); setSelectedNote(null);
    requestAnimationFrame(() => rowQuickInputs.current[condition.id]?.focus());
  };
  const applyQuickEdit = (condition: AtomicCondition) => {
    const spec = quickSpec(condition);
    const value = quickValue.trim();
    if (spec.kind === 'invalid') { setQuickError('저장된 값이 한 칸 수정에 맞지 않아요. 세부 조건을 확인해 주세요.'); return; }
    if (profile.status !== 'current' || !isVerbatimEvidence(originalText, condition.evidence)) {
      setQuickError('현재 원문에서 확인할 수 있는 취향만 간단히 수정할 수 있어요. 세부 조건을 확인해 주세요.');
      return;
    }
    if (!value) { setQuickError('내용을 입력해 주세요.'); rowQuickInputs.current[condition.id]?.focus(); return; }
    if (spec.kind === 'frequency') {
      if (!/^(0|[1-9]\d*)$/u.test(value) || Number(value) > 365) { setQuickError('횟수는 0부터 365 사이의 정수로 입력해 주세요.'); rowQuickInputs.current[condition.id]?.focus(); return; }
      updateCondition(editAtomicCondition(condition, { frequency: { count: Number(value) } as AtomicCondition['frequency'] }));
    } else if (spec.kind === 'value') {
      if (!/^-?(?:\d+\.?\d*|\.\d+)$/u.test(value) || !Number.isFinite(Number(value))) { setQuickError('값을 숫자로 입력해 주세요.'); rowQuickInputs.current[condition.id]?.focus(); return; }
      updateCondition(editAtomicCondition(condition, { value: Number(value) }));
    } else {
      if (!/[\p{L}]/u.test(value)) { setQuickError('숫자만으로는 취향을 정할 수 없어요.'); rowQuickInputs.current[condition.id]?.focus(); return; }
      if (value !== condition.target && !condition.evidence.includes(value)) {
        setQuickError('기존 근거에 없는 내용은 연결할 수 없어요. 새 취향으로 추가해 주세요.');
        return;
      }
      updateCondition(editAtomicCondition(condition, { target: value }));
    }
    setQuickEditingId(null); setQuickError('');
    focusAfterRender(() => rowTriggers.current[condition.id]);
  };
  const activeEdit = Boolean(editingId || quickEditingId || composerOpen || selectedNote);
  useEffect(() => {
    if (editingSignal.current === activeEdit) return;
    editingSignal.current = activeEdit;
    editingCallback.current(activeEdit);
  }, [activeEdit]);
  useEffect(() => () => {
    if (editingSignal.current) editingCallback.current(false);
  }, []);
  return <section className="atomic-review" aria-labelledby="atomic-review-title">
    <h4 id="atomic-review-title" className="sr-only">분석한 세부 조건</h4>
    {!profile.conditions.length && !pendingNotes.length && <p className="atomic-review__empty">아직 일정에 반영할 취향이 없어요.</p>}
    <ul className="atomic-review__list">{profile.conditions.map(condition => <li className={`atomic-review__item${editingId === condition.id || quickEditingId === condition.id ? ' atomic-review__item--editing' : ''}`} key={condition.id}>
      <div className="atomic-review__summary">
        <span className="atomic-review__sentence">{formatAtomicCondition(condition)}</span>
        <div className="atomic-review__metadata">{atomicConditionTags(condition).filter(tag => ['필수', '일행 공통', '일부 일정', '하루 기준'].includes(tag)).map(tag => <span className={tag === '필수' ? 'atomic-review__tag atomic-review__tag--required' : 'atomic-review__tag'} key={tag}>{tag}</span>)}</div>
        {editing && !activeEdit && <div className="atomic-review__row-actions"><button ref={element => { rowTriggers.current[condition.id] = element; }} type="button" className="atomic-review__text-button atomic-review__edit-button" aria-label={`${condition.target || '취향'} 수정`} disabled={disabled} onClick={() => beginQuickEdit(condition)}>수정</button></div>}
      </div>
      {quickEditingId === condition.id && <div className="atomic-review__quick-edit"><label className="atomic-review__field"><span>{quickSpec(condition).label}</span><input ref={element => { rowQuickInputs.current[condition.id] = element; }} className="text-input" value={quickValue} maxLength={quickSpec(condition).kind === 'target' ? 240 : 160} inputMode={quickSpec(condition).kind === 'target' ? 'text' : 'decimal'} placeholder={quickSpec(condition).example} disabled={disabled} onChange={event => { setQuickValue(event.target.value); setQuickError(''); }} /></label>{quickError && <p className="atomic-review__error" role="alert">{quickError}</p>}{quickError.includes('새 취향으로 추가') && <button type="button" className="atomic-review__text-button" disabled={disabled || sourceChangeBlocked} onClick={() => openComposer(quickValue)}>새 취향으로 추가</button>}<div className="atomic-review__editor-actions"><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={() => { setQuickEditingId(null); setQuickError(''); focusAfterRender(() => rowTriggers.current[condition.id]); }}>취소</button><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={() => { setQuickEditingId(null); setEditingCondition(condition); setEditingId(condition.id); }}>세부 조건 편집</button><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={() => { onChange({ ...profile, conditions: profile.conditions.filter(item => item.id !== condition.id) }); setQuickEditingId(null); focusAfterRender(() => addTrigger.current); }}>삭제</button><PreparationActionButton label="적용" disabled={disabled} onClick={() => applyQuickEdit(condition)} /></div></div>}
      {editingId === condition.id && <ConditionEditor key={`${condition.id}-${editingCondition?.evidence ?? condition.evidence}`} condition={editingCondition ?? condition} originalText={originalText} disabled={disabled} onCancel={() => { setEditingId(null); setEditingCondition(null); setResolvingNote(null); focusAfterRender(() => rowTriggers.current[condition.id]); }} onApply={value => { updateCondition(value); if (resolvingNote) { onAcknowledge(resolvingNote, 'handled'); setEditingId(null); setEditingCondition(null); setResolvingNote(null); focusAfterRender(() => historySummary.current); } else { setEditingId(null); setEditingCondition(null); focusAfterRender(() => rowTriggers.current[condition.id]); } }} />}
    </li>)}</ul>
    {editing && !activeEdit && <div className="atomic-review__edit-actions"><button ref={addTrigger} type="button" className="atomic-review__add" disabled={disabled || sourceChangeBlocked} onClick={() => openComposer()}>취향 추가</button></div>}
    {composerOpen && <div className="atomic-review__composer" aria-label="취향 추가">
      <strong>추가할 취향</strong>
      <label className="atomic-review__field"><span className="sr-only">추가할 취향</span><input ref={composerInput} className="text-input" value={composerText} disabled={disabled} onChange={event => { const value = event.target.value; setComposerText(value); setComposerError(value.trim() ? appendError(value) : ''); setReplaceConfirm(false); }} placeholder="예: 점심에는 초밥을 먹고 싶어요." aria-label="추가할 취향" aria-invalid={Boolean(composerError) || undefined} aria-describedby={composerError ? 'atomic-review-composer-error' : 'atomic-review-composer-count'} /></label>
      <p id="atomic-review-composer-count" className="atomic-review__hint">처음 쓴 내용에 이 문장을 보태 다시 분석해요.</p>
      {sourceChangeBlocked && <p className="atomic-review__error" role="status">공통 조건을 저장한 뒤 추가할 수 있어요. 입력한 문장은 그대로 남아 있어요.</p>}
      {composerError && <p id="atomic-review-composer-error" className="atomic-review__error" role="alert">{composerError}</p>}
      {replaceConfirm && <div className="atomic-review__replace-confirm" role="alertdialog" aria-label="기존 취향 바꾸기 확인" aria-describedby={replaceMessageId}>
        <p id={replaceMessageId}>문장을 추가하면 직접 수정한 취향과 안내 기록이 새 분석 결과로 바뀝니다.</p>
        <div className="atomic-review__editor-actions">
          <button ref={cancelReplacement} type="button" className="atomic-review__text-button" onClick={() => {
            setReplaceConfirm(false);
            requestAnimationFrame(() => composerInput.current?.focus());
          }}>취소</button>
          <PreparationActionButton label="추가하고 다시 분석" disabled={disabled || sourceChangeBlocked} onClick={submitComposer} />
        </div>
      </div>}
      {!replaceConfirm && <div className="atomic-review__editor-actions"><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={closeComposer}>취소</button><PreparationActionButton label="추가하고 다시 분석" disabled={disabled || sourceChangeBlocked} onClick={submitComposer} /></div>}
    </div>}
    {profile.status === 'stale' && unresolved.length > 0 && <p className="atomic-review__hint" role="status">원문이 바뀌어 이전 분석을 다시 확인해야 해요.</p>}
    {pendingNotes.length > 0 && <section className="atomic-review__pending-notes atomic-review__notes" aria-labelledby="atomic-review-pending-title"><h5 id="atomic-review-pending-title" ref={pendingSummary} tabIndex={-1}>일정에 반영되지 않은 내용 <span>그대로 준비를 마쳐도 돼요.</span></h5><ul>{pendingNotes.map((note, index) => {
      const key = noteKey(note);
      return <li key={`${note.code}-${index}`}><div className="atomic-review__note-line"><p>{note.message}</p>{note.evidence && note.evidence !== originalText && <q>{note.evidence}</q>}</div>
        {editing && (selectedNote ? noteKey(selectedNote) === key : !activeEdit) && <div className="atomic-review__note-actions">{selectedNote && noteKey(selectedNote) === key ? <div className="atomic-review__note-work"><label className="atomic-review__field"><span>연결할 기존 취향</span><select className="text-input" disabled={disabled || profile.status === 'stale'} value={noteChoice} onChange={event => setNoteChoice(event.target.value)}><option value="">취향을 선택해 주세요</option>{profile.conditions.map(item => <option key={item.id} value={item.id}>{item.target || formatAtomicCondition(item)}</option>)}</select></label><div className="atomic-review__editor-actions"><button type="button" className="atomic-review__text-button" onClick={() => { setSelectedNote(null); focusAfterRender(() => noteTriggers.current[key]); }}>취소</button><PreparationActionButton label="선택한 취향에 연결" disabled={disabled || profile.status === 'stale' || !noteChoice} onClick={() => startNoteEditor(note)} /></div></div> : <><button ref={element => { noteTriggers.current[key] = element; }} type="button" className="atomic-review__text-button" disabled={disabled || profile.status === 'stale' || !profile.conditions.length} onClick={() => { setSelectedNote(note); setNoteChoice(''); }}>기존 취향에 연결</button><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={() => { onAcknowledge(note, 'ignored'); focusAfterRender(() => historySummary.current); }}>안내 숨김</button></>}</div>}
      </li>;
    })}</ul></section>}
    {editing && !activeEdit && acknowledgedNotes.length > 0 && <details className="atomic-review__notes"><summary ref={historySummary}>지난 안내 {acknowledgedNotes.length}개</summary><ul>{acknowledgedNotes.map((note, index) => { const action = acknowledgementFor(note)!; const key = noteKey(note); return <li key={`${note.code}-${index}`}><p>{note.message}</p><div className="atomic-review__note-actions"><span>{savedKeys.has(`${key}:${action.disposition}`) ? '저장됨' : pendingKeys.has(`${key}:${action.disposition}`) ? '저장 전' : ''}</span><button type="button" className="atomic-review__text-button" disabled={disabled} onClick={() => { onAcknowledge(note, null); focusAfterRender(() => pendingSummary.current); }}>다시 표시</button></div></li>; })}</ul></details>}
    {!activeEdit && <div className="atomic-review__mode-actions"><button type="button" className="atomic-review__text-button atomic-review__mode-button" disabled={disabled} onClick={() => { setEditing(value => !value); }}>{editing ? '편집 완료' : '취향 편집'}</button></div>}
  </section>;
}
