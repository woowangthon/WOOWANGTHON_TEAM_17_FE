import { useEffect, useId, useRef, useState } from 'react';
import { InfoIcon } from './PreparationIcons';

export default function InfoTip({ text, label = '설명 보기' }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return <span className="prep-info-tip" ref={root} onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(event) => { if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button type="button" className="prep-info-trigger" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen(true)}>
      <InfoIcon />
    </button>
    {open && <span className="prep-info-popover" id={id} role="tooltip">{text}</span>}
  </span>;
}
