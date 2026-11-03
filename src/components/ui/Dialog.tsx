import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import Button from './Button';

type DialogProps = {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export default function Dialog({ open, title, children, onClose, onConfirm, confirmLabel = '확인', cancelLabel = '닫기', pending = false, returnFocusRef }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fallbackFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasTextDescription = typeof children === 'string' || typeof children === 'number';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      fallbackFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleNativeClose() {
    (returnFocusRef?.current ?? fallbackFocusRef.current)?.focus();
    if (open) onClose();
  }

  function handleConfirm() {
    if (pending) return;
    (onConfirm ?? onClose)();
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog-backdrop"
      aria-labelledby={titleId}
      aria-describedby={hasTextDescription ? descriptionId : undefined}
      onCancel={(event) => {
        if (pending) event.preventDefault();
        else { event.preventDefault(); onClose(); }
      }}
      onClose={handleNativeClose}
    >
      <section className="dialog-card">
        <h2 id={titleId}>{title}</h2>
        {hasTextDescription ? <p className="dialog-description" id={descriptionId}>{children}</p> : <div className="dialog-content">{children}</div>}
        <div className="dialog-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>{cancelLabel}</Button>
          <Button type="button" onClick={handleConfirm} disabled={pending} loading={pending}>{confirmLabel}</Button>
        </div>
      </section>
    </dialog>
  );
}
