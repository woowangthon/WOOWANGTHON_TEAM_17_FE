import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CHUNGBUK_REGIONS, regionSelection } from './preparationModel';
import { regionPhotos } from './regionPhotos';

export default function RegionPicker({ value, onChange, error, disabled }: { value: string; onChange: (value: string) => void; error?: string; disabled?: boolean }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number; dragged: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [photosOpen, setPhotosOpen] = useState(true);
  const selection = regionSelection(value);
  const selectedCity = selection.kind === 'specific' ? CHUNGBUK_REGIONS.find((region) => region.label === selection.label)?.value ?? '' : '';
  const selectedRegion = selection.kind === 'all' ? '충북' : selectedCity;
  const summary = selection.kind === 'all' ? '충북 전체' : selection.kind === 'unset' ? '지역을 선택해 주세요' : selection.kind === 'specific' ? `충북 ${selection.label}` : selection.value;

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !photosOpen || !selectedRegion) return;
    const selected = Array.from(strip.querySelectorAll<HTMLButtonElement>('.prep-region-photo')).find((card) => card.dataset.region === selectedRegion);
    if (!selected) return;
    const frame = requestAnimationFrame(() => {
      const stripBounds = strip.getBoundingClientRect();
      const cardBounds = selected.getBoundingClientRect();
      const left = strip.scrollLeft + cardBounds.left - stripBounds.left;
      const right = left + cardBounds.width;
      if (left < strip.scrollLeft) strip.scrollLeft = left;
      else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedCity, selectedRegion, photosOpen]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !stripRef.current) return;
    suppressClick.current = false;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startScroll: stripRef.current.scrollLeft, dragged: false };
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !stripRef.current) return;
    if (event.buttons === 0) {
      dragRef.current = null;
      suppressClick.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 6 && !drag.dragged) {
      drag.dragged = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (drag.dragged) stripRef.current.scrollLeft = drag.startScroll - delta;
  }
  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClick.current = drag.dragged;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className="prep-region-picker">
    <div className="prep-field-label" id="region-picker-label">여행 지역</div>
    <button className="prep-region-summary" type="button" aria-expanded={photosOpen} aria-controls="region-photo-panel" onClick={() => setPhotosOpen((open) => !open)}>
      <span aria-live="polite">{summary}</span><span className="prep-region-summary-toggle"><svg viewBox="0 0 20 20" aria-hidden="true"><path d={photosOpen ? 'm5 12 5-5 5 5' : 'm5 8 5 5 5-5'} /></svg>{photosOpen ? '지역 접기' : '지역 열기'}</span>
    </button>
    <div id="region-photo-panel" ref={stripRef} className="prep-region-strip" hidden={!photosOpen} role="group" aria-labelledby="region-picker-label" aria-invalid={Boolean(error)} aria-describedby={error ? 'region-error' : undefined} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onClickCapture={(event) => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      <button data-region="충북" type="button" className={`prep-region-photo ${selection.kind === 'all' ? 'is-selected' : ''}`} aria-pressed={selection.kind === 'all'} disabled={disabled} onClick={() => onChange('충북')}>
        <span className="prep-region-photo-collage" aria-hidden="true">{regionPhotos.slice(0, 3).map((photo) => <img key={photo.value} src={photo.image} alt="" draggable={false} onError={(event) => { event.currentTarget.hidden = true; }} />)}</span>
        <span className="prep-region-photo-caption"><strong>충북 전체</strong><small>지역 제한 없이</small></span>
      </button>
      {regionPhotos.map((photo) => <button data-region={photo.value} type="button" className={`prep-region-photo ${selectedCity === photo.value ? 'is-selected' : ''}`} aria-pressed={selectedCity === photo.value} disabled={disabled} key={photo.value} onClick={() => onChange(photo.value)}>
        <img src={photo.image} alt="" draggable={false} onError={(event) => { event.currentTarget.hidden = true; }} />
        <span className="prep-region-photo-caption"><strong>{photo.label}</strong><small>{photo.place}</small></span>
      </button>)}
    </div>
    {selection.kind === 'unset' && <p className="prep-region-empty">지역을 아직 정하지 않았어요.</p>}
    {selection.kind === 'legacy' && <p className="prep-region-legacy">기존 저장 지역을 유지하고 있어요.</p>}
    {error && <p id="region-error" className="field-error" role="alert">{error}</p>}
  </div>;
}
