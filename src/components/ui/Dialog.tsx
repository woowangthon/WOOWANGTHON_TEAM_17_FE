import { useEffect, useId, useRef } from 'react';
import Button from './Button';

type DialogProps = {
  open: boolean;
  title: string;
  children: string;
  onClose: () => void;
};

export default function Dialog({ open, title, children, onClose }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function handleNativeClose() {
    if (open) onClose();
    returnFocusRef.current?.focus();
  }

  return (
    <dialog ref={dialogRef} className="dialog-backdrop" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={handleNativeClose}>
      <section className="dialog-card">
        <div className="dialog-icon" aria-hidden="true">✓</div>
        <h2 id={titleId}>{title}</h2>
        <p id={descriptionId}>{children}</p>
        <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>닫기</Button><Button type="button" onClick={onClose}>확인</Button></div>
      </section>
    </dialog>
  );
}
