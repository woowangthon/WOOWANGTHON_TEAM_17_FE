import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import PreparationActionButton from '../preparation/PreparationActionButton';
import '../../styles/generation-loading.css';

export type GenerationLoadingPhase = 'checking' | 'generating' | 'routing' | 'opening';

type Props = {
  open: boolean;
  phase: GenerationLoadingPhase;
  message?: string;
  onRetry?: () => void;
  onReturn?: () => void;
};

const phaseMessage: Record<GenerationLoadingPhase, string> = {
  checking: '참여자와 저장한 여행 조건을 확인하고 있어요.',
  generating: '여행 조건과 취향에 맞는 장소를 연결하고 있어요.',
  routing: '장소 사이의 이동과 여행 시간을 확인하고 있어요.',
  opening: '생성한 일정을 캔버스에 담고 있어요.',
};

/** Owns only the transition; completion and retries follow the actual server job. */
export function GenerationLoadingOverlay({ open, phase, message, onRetry, onReturn }: Props) {
  const titleId = useId();
  const messageId = useId();
  const surface = useRef<HTMLDivElement>(null);
  const hasAction = Boolean(onReturn || onRetry);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflowY;
    const siblings = [...document.body.children].filter((child): child is HTMLElement => child instanceof HTMLElement && !child.contains(surface.current));
    const priorInert = siblings.map((child) => ({ child, inert: child.inert }));
    siblings.forEach((child) => { child.inert = true; });
    document.body.style.overflowY = 'hidden';
    surface.current?.focus();
    return () => {
      document.body.style.overflowY = overflow;
      priorInert.forEach(({ child, inert }) => { child.inert = inert; });
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  const failed = Boolean(onRetry);

  return createPortal(
    <div
      ref={surface}
      className={`generation-loading${failed ? ' generation-loading-error' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onReturn) { event.preventDefault(); onReturn(); }
        if (event.key !== 'Tab') return;
        const actions = surface.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!actions?.length) { event.preventDefault(); return; }
        const first = actions[0];
        const last = actions[actions.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === surface.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === surface.current)) { event.preventDefault(); first.focus(); }
      }}
    >
      <div className="generation-loading-brand" aria-hidden="true">충북 여행 계획</div>
      <div className="generation-loading-content">
        <span className="generation-loading-mark" aria-hidden="true"><span /><span /></span>
        <h1 id={titleId}>{failed ? '일정 생성을 확인해 주세요' : '경로를 생성하고 있어요'}</h1>
        <p id={messageId} role="status" aria-live="polite" aria-atomic="true">{message || phaseMessage[phase]}</p>
        {!failed && <p className="generation-loading-caption">완료되면 일정 캔버스로 이동해요.</p>}
        {hasAction && <div className="generation-loading-actions">
          {onReturn && <PreparationActionButton onClick={onReturn} label="여행 준비로" />}
          {onRetry && <PreparationActionButton onClick={onRetry} label="다시 확인하기" />}
        </div>}
      </div>
    </div>, document.body,
  );
}
