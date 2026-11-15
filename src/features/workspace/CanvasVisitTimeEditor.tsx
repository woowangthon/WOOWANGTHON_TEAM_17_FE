import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { NodeToolbar, Position, useReactFlow, useStore } from '@xyflow/react';
import type { CanvasPlaceNode } from './canvasModel';
import { canvasStayMinutes, createCanvasVisitTime, getCanvasKstDate, getCanvasVisitClocks, getCanvasVisitTime, moveCanvasVisitStart, type CanvasVisitTime } from './canvasVisitTime';
import { parseVisitClockField } from './canvasVisitTimeClock';
import PreparationActionButton from '../preparation/PreparationActionButton';

type Props = {
  node: CanvasPlaceNode;
  title: string;
  panelId: string;
  onSave: (time: CanvasVisitTime) => string | null;
  onClose: (restoreFocus?: boolean) => void;
};

type Endpoint = 'start' | 'end';
type ClockInput = { text: string; edited: boolean };
type TimeDraft = { start: ClockInput; end: ClockInput; interval: CanvasVisitTime | null; dirty: boolean };

function draftFor(node: CanvasPlaceNode, interval: CanvasVisitTime | null, dirty = false): TimeDraft {
  const clocks = getCanvasVisitClocks(interval ? { ...node, visitTime: interval } : node);
  return {
    start: { text: clocks.startTime, edited: false },
    end: { text: clocks.endTime, edited: false },
    interval,
    dirty,
  };
}

const readClock = (input: ClockInput) => parseVisitClockField(input.text);
const durationLabel = (minutes: number) => `${Math.max(0, minutes)}분`;

function resolveDraft(node: CanvasPlaceNode, draft: TimeDraft): CanvasVisitTime | null {
  const startTime = readClock(draft.start);
  const endTime = readClock(draft.end);
  if (!startTime || !endTime) return null;
  if (draft.interval && draft.start.edited && !draft.end.edited) return moveCanvasVisitStart(node, draft.interval, startTime);
  const base = draft.interval ? { ...node, visitTime: draft.interval } : node;
  return createCanvasVisitTime(base, { startTime, endTime });
}

export default function CanvasVisitTimeEditor(props: Props) {
  return <NodeToolbar nodeId={props.node.id} isVisible position={Position.Bottom} align="start" offset={2} className="tw-visit-toolbar">
    <VisitTimeForm {...props}/>
  </NodeToolbar>;
}

function VisitTimeForm({ node, title, panelId, onSave, onClose }: Props) {
  const clocks = getCanvasVisitClocks(node);
  const initialInterval = node.visitTime ?? createCanvasVisitTime(node, clocks);
  const [draft, setDraft] = useState(() => draftFor(node, initialInterval));
  const [error, setError] = useState<{ text: string; field?: Endpoint } | null>(null);
  const errorId = useId();
  const form = useRef<HTMLFormElement>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const flow = useReactFlow();
  const zoom = useStore(state => state.transform[2]);
  const candidate = resolveDraft(node, draft);
  const minutes = candidate && canvasStayMinutes({ ...node, visitTime: candidate });
  const originalMinutes = canvasStayMinutes(node);
  const originalInterval = node.visitTime ?? createCanvasVisitTime(node, clocks);
  let durationFeedback = '';
  if (draft.dirty && candidate && minutes != null) {
    if (!originalInterval) durationFeedback = `체류 ${durationLabel(minutes)}`;
    else if (originalMinutes != null && minutes !== originalMinutes) {
      durationFeedback = `체류 ${durationLabel(originalMinutes)} → ${durationLabel(minutes)}`;
    }
  }
  const original = getCanvasVisitTime(node);
  const startDate = original && 'startAt' in original && original.startAt ? getCanvasKstDate(original.startAt) : '';
  const endDate = original && 'endAt' in original && original.endAt ? getCanvasKstDate(original.endAt) : '';
  const overnight = Boolean(startDate && endDate && startDate !== endDate);

  function applyTime(time: CanvasVisitTime) {
    setDraft(draftFor(node, time, true));
    setError(null);
  }

  function updateText(field: Endpoint, text: string) {
    setDraft(current => ({ ...current, [field]: { ...current[field], text, edited: true }, dirty: true }));
    setError(null);
  }

  function finishEntry(field: Endpoint) {
    const input = draft[field];
    if (!input.edited) return;
    const clock = readClock(input);
    if (!clock) {
      setError({ field, text: `${field === 'start' ? '도착' : '출발'} 시각을 09:37 또는 0937처럼 입력해 주세요.` });
      return;
    }
    const next: TimeDraft = { ...draft, [field]: { text: clock, edited: true }, dirty: true };
    const time = resolveDraft(node, next);
    if (time) applyTime(time);
    else {
      setDraft(next);
      const complete = readClock(next.start) && readClock(next.end);
      setError(complete ? {
        field,
        text: field === 'start' && next.interval && !next.end.edited
          ? '체류 시간을 유지하면 날짜 범위를 벗어나요. 도착이나 출발 시각을 조정해 주세요.'
          : '출발 시각은 도착 시각보다 늦게 입력해 주세요.',
      } : null);
    }
  }

  function focusInvalid(field: Endpoint, text: string) {
    const input = field === 'start' ? firstInput.current : endInput.current;
    input?.focus({ preventScroll: true });
    input?.select();
    setError({ field, text });
  }

  function save() {
    if (!draft.dirty) return;
    if (!readClock(draft.start)) return focusInvalid('start', '도착 시각을 09:37 또는 0937처럼 입력해 주세요.');
    if (!readClock(draft.end)) return focusInvalid('end', '출발 시각을 10:45 또는 1045처럼 입력해 주세요.');
    const time = resolveDraft(node, draft);
    if (!time) {
      const startWasChanged = draft.start.edited && !draft.end.edited;
      return focusInvalid(startWasChanged ? 'start' : 'end', startWasChanged
        ? '체류 시간을 유지하면 날짜 범위를 벗어나요. 도착이나 출발 시각을 조정해 주세요.'
        : '출발 시각은 도착 시각보다 늦게 입력해 주세요.');
    }
    applyTime(time);
    const problem = onSave(time);
    if (problem) setError({ text: problem });
    else onClose();
  }

  useLayoutEffect(() => {
    form.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const panel = form.current;
    const canvas = panel?.closest<HTMLElement>('.tw-flow-canvas');
    const toolbar = panel?.closest<HTMLElement>('.tw-visit-toolbar');
    if (!panel || !canvas || !toolbar) return;
    const card = canvas.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(node.id)}"]`);
    const clockChip = card?.querySelector<HTMLElement>('.tw-stop-time-edit');
    if (!card || !clockChip) return;
    const alignToClock = () => {
      const chipBounds = clockChip.getBoundingClientRect();
      const cardBounds = card.getBoundingClientRect();
      // NodeToolbar follows the card. Apply the button's offset in screen pixels on top of that transform.
      toolbar.style.translate = `${chipBounds.left - cardBounds.left}px ${chipBounds.bottom - cardBounds.bottom}px`;
    };
    alignToClock();
    let frame = 0;
    function keepInView() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!panel?.isConnected || !canvas) return;
        alignToClock();
        const canvasBounds = canvas.getBoundingClientRect();
        const visual = window.visualViewport;
        const bounds = visual
          ? {
              left: Math.max(canvasBounds.left, visual.offsetLeft),
              right: Math.min(canvasBounds.right, visual.offsetLeft + visual.width),
              top: Math.max(canvasBounds.top, visual.offsetTop),
              bottom: Math.min(canvasBounds.bottom, visual.offsetTop + visual.height),
              width: Math.min(canvasBounds.right, visual.offsetLeft + visual.width) - Math.max(canvasBounds.left, visual.offsetLeft),
            }
          : canvasBounds;
        if (bounds.width <= 0 || bounds.bottom <= bounds.top) return;
        panel.style.maxWidth = `${Math.max(1, bounds.width - 16)}px`;
        const rect = panel.getBoundingClientRect();
        const dx = Math.max(0, bounds.left + 8 - rect.left) - Math.max(0, rect.right - bounds.right + 8);
        let bottom = bounds.bottom - 12;
        for (const control of canvas.querySelectorAll('.tw-canvas-tool-dock, .react-flow__controls')) {
          const controlBounds = control.getBoundingClientRect();
          if (controlBounds.height && rect.left + dx < controlBounds.right && rect.right + dx > controlBounds.left) bottom = Math.min(bottom, controlBounds.top - 8);
        }
        panel.style.maxHeight = `${Math.max(1, bottom - bounds.top - 8)}px`;
        const sized = panel.getBoundingClientRect();
        const dy = Math.max(0, bounds.top + 8 - sized.top) - Math.max(0, sized.bottom - bottom);
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        const viewport = flow.getViewport();
        void flow.setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
      });
    }
    const observer = new ResizeObserver(keepInView);
    observer.observe(canvas);
    observer.observe(panel);
    observer.observe(clockChip);
    observer.observe(card);
    const visual = window.visualViewport;
    visual?.addEventListener('resize', keepInView);
    visual?.addEventListener('scroll', keepInView);
    keepInView();
    return () => {
      observer.disconnect();
      visual?.removeEventListener('resize', keepInView);
      visual?.removeEventListener('scroll', keepInView);
      cancelAnimationFrame(frame);
    };
  }, [flow, node.id, zoom]);

  useEffect(() => {
    const canvas = form.current?.closest<HTMLElement>('.tw-flow-canvas');
    function dismiss(event: PointerEvent) {
      if (!(event.target instanceof Element) || form.current?.contains(event.target)) return;
      const trigger = event.target.closest('.tw-stop-time-edit');
      if (trigger?.closest<HTMLElement>('.react-flow__node')?.dataset.id === node.id) return;
      onClose(false);
    }
    function cancelFromCanvas(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || !(event.target instanceof Element)) return;
      if (event.target.closest('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener('pointerdown', dismiss, true);
    canvas?.addEventListener('keydown', cancelFromCanvas);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      canvas?.removeEventListener('keydown', cancelFromCanvas);
    };
  }, [node.id, onClose]);

  return <form ref={form} id={panelId} role="dialog" aria-label={`${title} 방문 시간 편집`} aria-modal="false" tabIndex={-1}
    className="tw-visit-editor nodrag nopan nowheel" noValidate
    onSubmit={event => { event.preventDefault(); save(); }}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && !event.nativeEvent.isComposing) {
        event.preventDefault();
        if (event.target === firstInput.current && readClock(draft.start) && !readClock(draft.end)) endInput.current?.focus({ preventScroll: true });
        else save();
      }
    }}>
    <div className="tw-visit-fields">
      <div className="tw-visit-range">
        {(['start', 'end'] as const).map(field => {
          const input = draft[field];
          const visibleText = field === 'end' && candidate && draft.start.edited && !draft.end.edited
            ? getCanvasVisitClocks({ ...node, visitTime: candidate }).endTime
            : input.text;
          const date = field === 'start' ? startDate : endDate;
          const fieldId = `${panelId}-${field}`;
          const dateId = `${fieldId}-date`;
          const description = [overnight && dateId, error?.field === field && errorId].filter(Boolean).join(' ');
          return <div className="tw-visit-field" key={field}>
            {overnight && <time id={dateId} dateTime={date} title={date}>
              <span aria-hidden="true">{date.slice(5).replace('-', '.')}</span>
              <span className="sr-only">{date}</span>
            </time>}
            <input id={fieldId} ref={field === 'start' ? firstInput : endInput} type="text" inputMode="numeric" autoComplete="off" maxLength={5}
              aria-label={field === 'start' ? '도착 시각' : '출발 시각'} aria-invalid={error?.field === field || undefined}
              aria-describedby={description || undefined}
              value={visibleText} placeholder="--:--"
              onFocus={event => event.currentTarget.select()} onChange={event => updateText(field, event.currentTarget.value)}
              onBlur={() => finishEntry(field)}/>
          </div>;
        })}
        <span className="tw-visit-dash" aria-hidden="true">–</span>
      </div>
      <PreparationActionButton label="저장" type="submit" className="tw-visit-save" disabled={!candidate || !draft.dirty}/>
    </div>
    {durationFeedback && <p className="tw-visit-duration" aria-live="polite">{durationFeedback}</p>}
    {error && <p className="tw-visit-error" role="alert" id={errorId}>{error.text}</p>}
  </form>;
}
