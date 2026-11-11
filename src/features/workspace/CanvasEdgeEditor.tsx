import { useId, useState, type FormEvent } from 'react';
import Button from '../../components/ui/Button.tsx';
import type { CanvasTravelMode } from './canvasRoutes.ts';
import {
  canvasEdgeOverrideFromFields, modeLabel, resolveCanvasEdgeTime,
  type CanvasEdgeOverride, type CanvasEdgePreference,
} from './canvasEdgePreferences.ts';

export type CanvasEdgeEditorProps = {
  commonMode: CanvasTravelMode;
  fromName?: string;
  toName?: string;
  automaticLabel?: string;
  preference: CanvasEdgePreference | null;
  onSave: (override: CanvasEdgeOverride | null) => boolean;
  storageError?: string | null;
  disabled?: boolean;
};

export function CanvasEdgeEditor(props: CanvasEdgeEditorProps) {
  const key = JSON.stringify(props.preference);
  return <EdgePreferenceForm key={key} {...props} />;
}

function EdgePreferenceForm({ commonMode, fromName, toName, automaticLabel, preference, onSave, storageError = null, disabled = false }: CanvasEdgeEditorProps) {
  const id = useId();
  const [mode, setMode] = useState<string>(preference?.modeOverride ?? '');
  const [minutes, setMinutes] = useState(preference?.manualMinutes?.toString() ?? '');
  const [formError, setFormError] = useState('');
  const [saveError, setSaveError] = useState('');

  const resolved = resolveCanvasEdgeTime(preference, commonMode);
  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = canvasEdgeOverrideFromFields(mode, minutes.trim());
    setFormError(parsed.error ?? '');
    setSaveError('');
    if (parsed.error) return;
    if (!onSave(parsed.value)) setSaveError('개인 이동 설정을 저장하지 못했어요. 다시 시도해 주세요.');
  };
  const clear = () => {
    setFormError('');
    setSaveError('');
    if (onSave(null)) { setMode(''); setMinutes(''); }
    else setSaveError('개인 이동 설정을 초기화하지 못했어요. 다시 시도해 주세요.');
  };

  return <section className="tw-edge-editor" aria-label="이 구간 이동 설정">
    <h3 className="tw-leg-title">
      <span>{fromName || '출발 장소'}</span><span aria-label="에서" className="tw-leg-arrow">→</span><span>{toName || '도착 장소'}</span>
    </h3>
    {automaticLabel && <p className="tw-leg-baseline">여행 준비 기준 <strong>{automaticLabel}</strong></p>}
    <p className="tw-inspector-note">변경한 이동수단과 시간은 이 브라우저에 저장돼요.</p>
    <form onSubmit={handleSave} noValidate>
      <label htmlFor={`${id}-mode`}>이동 수단</label>
      <select id={`${id}-mode`} className="text-input" value={mode} disabled={disabled} onChange={event => { setMode(event.target.value); setFormError(''); }}>
        <option value="">공통 설정 · {modeLabel(commonMode)}</option>
        <option value="car">차량</option>
        <option value="walk">도보</option>
        <option value="transit">대중교통</option>
        <option value="charter">전세버스</option>
      </select>
      <label htmlFor={`${id}-minutes`}>직접 입력 시간 <span>선택 · 분</span></label>
      <input id={`${id}-minutes`} className="text-input" type="number" min={1} max={1440} step={1} inputMode="numeric"
        value={minutes} disabled={disabled} placeholder="예: 35" aria-invalid={Boolean(formError)}
        aria-describedby={formError ? `${id}-error` : `${id}-hint`}
        onChange={event => { setMinutes(event.target.value); setFormError(''); }} />
      <p id={`${id}-hint`} className="tw-inspector-note">{mode && mode !== commonMode ? '이 이동수단으로 예상하는 시간을 입력해 주세요.' : '비워 두면 여행 준비의 이동시간을 사용해요.'}</p>
      {formError && <p id={`${id}-error`} className="tw-panel-error" role="alert">{formError}</p>}
      <div className="tw-inspector-actions">
        <Button variant="secondary" type="submit" disabled={disabled}>이 구간에 저장</Button>
        {preference && <Button variant="secondary" type="button" disabled={disabled} onClick={clear}>공통 설정으로 되돌리기</Button>}
      </div>
    </form>
    {resolved.source === 'required' && <p className="tw-panel-error" role="status">{modeLabel(resolved.mode)} 이동 시간을 확인할 수 없어요. 예상 소요 시간을 입력해 주세요.</p>}
    {resolved.source === 'manual' && <p className="tw-inspector-note" role="status">내가 입력한 시간 · {resolved.minutes}분</p>}
    {(storageError || saveError) && <p className="tw-panel-error" role="alert">{storageError || saveError}</p>}
  </section>;
}
