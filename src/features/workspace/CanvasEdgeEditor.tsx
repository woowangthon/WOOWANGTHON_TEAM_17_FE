import { useId, useState, type FormEvent } from 'react';
import Button from '../../components/ui/Button.tsx';
import type { CanvasTravelMode } from './canvasRoutes.ts';
import { formatCanvasRouteLabel } from './canvasRoutes.ts';
import { useCanvasRoutePreview } from './useCanvasRoutes.ts';
import {
  canvasEdgeDraftModeKey, canvasEdgeOverrideFromFields, modeLabel, resolveCanvasEdgeTime,
  type CanvasEdgeOverride, type CanvasEdgePreference,
} from './canvasEdgePreferences.ts';

export type CanvasEdgeEditorProps = {
  tripId: string;
  conditionsVersion: number | null;
  sourceContentid: number;
  targetContentid: number;
  preview: boolean;
  commonMode: CanvasTravelMode;
  fromName?: string;
  toName?: string;
  automaticLabel?: string;
  preference: CanvasEdgePreference | null;
  onSave: (override: CanvasEdgeOverride | null) => boolean;
  storageError?: string | null;
  disabled?: boolean;
};

export function CanvasEdgeEditor(props: CanvasEdgeEditorProps) { return <EdgePreferenceForm key={JSON.stringify(props.preference)} {...props} />; }

function EdgePreferenceForm({ tripId, conditionsVersion, sourceContentid, targetContentid, preview, commonMode, fromName, toName, automaticLabel, preference, onSave, storageError = null, disabled = false }: CanvasEdgeEditorProps) {
  const id = useId();
  const [mode, setMode] = useState<string>(preference?.modeOverride ?? '');
  const initialMode = preference?.modeOverride ?? commonMode;
  const [minutesByMode, setMinutesByMode] = useState<Record<string, string>>(() =>
    preference?.manualMinutes != null ? { [initialMode ?? 'none']: preference.manualMinutes.toString() } : {});
  const [formError, setFormError] = useState('');
  const [saveError, setSaveError] = useState('');
  const selectedMode = (mode || commonMode) as CanvasTravelMode;
  const modeKey = canvasEdgeDraftModeKey(selectedMode);
  const minutes = minutesByMode[modeKey] ?? '';
  const matchesSavedMode = selectedMode === (preference?.modeOverride ?? commonMode);
  const routeInput = !preview && !matchesSavedMode && conditionsVersion !== null && selectedMode !== null ? {
    tripId, sourceContentid, targetContentid, conditionsVersion, mode: selectedMode,
    ...(selectedMode !== commonMode ? { modeOverride: selectedMode } : {}),
  } : null;
  const routePreview = useCanvasRoutePreview(routeInput, !disabled);
  const draftMode = mode === '' ? null : mode as CanvasEdgeOverride['modeOverride'];
  const draftManualMinutes = /^\d+$/u.test(minutes) && Number.isSafeInteger(Number(minutes)) && Number(minutes) >= 1 && Number(minutes) <= 1440 ? Number(minutes) : null;
  const resolved = resolveCanvasEdgeTime({ modeOverride: draftMode, manualMinutes: draftManualMinutes }, commonMode);
  const labelForCurrentMode = matchesSavedMode ? automaticLabel : undefined;
  const automaticVerified = (matchesSavedMode && Boolean(labelForCurrentMode && labelForCurrentMode !== '시간 미확인' && labelForCurrentMode !== '조회 중'))
    || (routePreview.phase === 'ready' && routePreview.route?.status === 'verified');
  const previewFailed = routePreview.phase === 'error' || routePreview.phase === 'stale'
    || (routePreview.phase === 'ready' && routePreview.route?.status === 'unknown');
  const noAutomaticCommonTime = routeInput === null && !preview && conditionsVersion !== null
    && matchesSavedMode && labelForCurrentMode !== '조회 중' && !automaticVerified;
  const showManualTime = minutes !== '' || resolved.source === 'manual' || previewFailed
    || (routeInput === null && (preview || conditionsVersion === null || selectedMode === null || noAutomaticCommonTime));
  const showAutomaticLabel = Boolean(labelForCurrentMode);
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
    if (onSave(null)) { setMode(''); setMinutesByMode({}); }
    else setSaveError('개인 이동 설정을 초기화하지 못했어요. 다시 시도해 주세요.');
  };

  return <section className="tw-edge-editor" aria-label="이 구간 이동 설정">
    <h3 className="tw-leg-title">
      <span>{fromName || '출발 장소'}</span><span aria-label="에서" className="tw-leg-arrow">→</span><span>{toName || '도착 장소'}</span>
    </h3>
    {showAutomaticLabel && <p className="tw-leg-baseline">현재 자동 경로 <strong>{automaticLabel}</strong></p>}
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
      {routeInput && <p className={routePreview.phase === 'ready' && routePreview.route?.status === 'verified' ? 'tw-inspector-note' : 'tw-panel-error'} role="status">
      {routePreview.phase === 'idle' || routePreview.phase === 'loading' ? `${modeLabel(selectedMode)} 경로 시간 확인 중…`
        : routePreview.phase === 'ready' && routePreview.route?.status === 'verified' ? `${formatCanvasRouteLabel(routePreview.route)} · 자동 조회`
        : routePreview.phase === 'stale' ? '여행 정보가 바뀌어 이 이동 경로를 확인할 수 없어요. 아래에 시간을 입력할 수 있어요.'
        : routePreview.phase === 'error' || (routePreview.phase === 'ready' && routePreview.route?.status === 'unknown') ? `${modeLabel(selectedMode)} 이동 시간을 확인하지 못했어요. 아래에 시간을 직접 입력해 주세요.`
        : conditionsVersion === null ? '경로 기준 정보가 없어 자동 시간을 조회할 수 없어요. 아래에 직접 입력할 수 있어요.'
        : '이동 시간을 자동 조회할 수 없어요. 아래에 직접 입력할 수 있어요.'}
    </p>}
      {showManualTime && <>
        <label htmlFor={`${id}-minutes`}>직접 입력 시간 <span>(분)</span></label>
        <input id={`${id}-minutes`} className="text-input" type="number" min={1} max={1440} step={1} inputMode="numeric"
          value={minutes} disabled={disabled} placeholder="예: 35" aria-invalid={Boolean(formError)}
          aria-describedby={formError ? `${id}-error` : `${id}-hint`}
          onChange={event => { setMinutesByMode(current => ({ ...current, [modeKey]: event.target.value })); setFormError(''); }} />
        <p id={`${id}-hint`} className="tw-inspector-note">{mode && mode !== commonMode ? '이 이동수단으로 예상하는 시간을 입력해 주세요.' : '비워 두면 공통 경로 시간을 사용해요.'}</p>
      </>}
      {formError && <p id={`${id}-error`} className="tw-panel-error" role="alert">{formError}</p>}
      <div className="tw-inspector-actions">
        <Button variant="secondary" type="submit" disabled={disabled}>이 구간에 저장</Button>
        {preference && <Button variant="secondary" type="button" disabled={disabled} onClick={clear}>공통 설정으로 되돌리기</Button>}
      </div>
    </form>
    {resolved.source === 'required' && routeInput === null && routePreview.phase !== 'loading' && <p className="tw-panel-error" role="status">{modeLabel(resolved.mode)} 이동 시간을 확인할 수 없어요. 예상 소요 시간을 입력해 주세요.</p>}
    {resolved.source === 'manual' && <p className="tw-inspector-note" role="status">내가 입력한 시간 · {resolved.minutes}분</p>}
    {(storageError || saveError) && <p className="tw-panel-error" role="alert">{storageError || saveError}</p>}
  </section>;
}
