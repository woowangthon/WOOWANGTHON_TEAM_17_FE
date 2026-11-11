import { useEffect, useId, useRef, useState } from 'react';
import Button from '../../components/ui/Button';
import type { CanvasCommentNode } from './canvasModel';

type Buffer = { base: string; value: string };
const drafts = new Map<string, Buffer>();
const placeholder = '댓글을 입력해 주세요';

export default function CanvasCommentEditor({ tripId, node, focusRequest = 0, focusReady = true, onCommit }: {
  tripId: string;
  node: CanvasCommentNode;
  focusRequest?: number;
  focusReady?: boolean;
  onCommit: (text: string, expectedText: string, force: boolean) => boolean;
}) {
  const key = `${tripId}:${node.id}`;
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const appliedFocusRequest = useRef(0);
  const [buffer, setBuffer] = useState<Buffer>(() => drafts.get(key) ?? { base: node.text, value: node.text });
  const [notice, setNotice] = useState('');
  const dirty = buffer.value !== buffer.base;
  const value = dirty ? buffer.value : node.text;
  const changedByAnother = dirty && node.text !== buffer.base;
  const overLimit = [...value].length > 1000;
  const replaceBuffer = (next: Buffer) => { drafts.set(key, next); setBuffer(next); };
  const save = (force: boolean) => {
    if (composing.current || !dirty || !value.trim() || [...value].length > 1000) return;
    if (onCommit(value, buffer.base, force)) {
      replaceBuffer({ base: value, value });
      setNotice('');
    } else setNotice('댓글을 저장하지 못했어요. 최신 내용을 확인한 뒤 다시 시도해 주세요.');
  };
  useEffect(() => {
    if (!focusRequest || focusRequest === appliedFocusRequest.current || !focusReady) return;
    const textarea = input.current;
    if (!textarea) return;
    let frame = 0;
    let attempts = 0;
    let cancelled = false;
    const focusWhenVisible = () => {
      if (cancelled) return;
      const visible = textarea.isConnected && textarea.getClientRects().length > 0
        && window.getComputedStyle(textarea).visibility === 'visible';
      if (visible) {
        textarea.focus({ preventScroll: true });
        if (document.activeElement === textarea) {
          appliedFocusRequest.current = focusRequest;
          if (value === placeholder) textarea.select();
          else textarea.setSelectionRange(value.length, value.length);
          return;
        }
      }
      if (attempts++ < 8) frame = window.requestAnimationFrame(focusWhenVisible);
    };
    frame = window.requestAnimationFrame(focusWhenVisible);
    return () => { cancelled = true; window.cancelAnimationFrame(frame); };
  }, [focusReady, focusRequest, value]);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const composingKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => composing.current
    || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;

  return <div className="tw-comment-editor nodrag nopan nowheel" onMouseDown={stop} onClick={stop} onContextMenu={stop} onWheel={stop} onKeyDown={stop}>
    <label className="sr-only" htmlFor={inputId}>참여자와 공유할 댓글</label>
    <textarea ref={input} id={inputId} value={value} aria-invalid={overLimit} aria-describedby={`${inputId}-meta`} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onChange={(event) => {
      replaceBuffer({ base: dirty ? buffer.base : node.text, value: event.target.value });
      setNotice('');
    }} onKeyDown={(event) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !composingKey(event)) {
        event.preventDefault();
        if (!changedByAnother) save(false);
      }
    }} />
    <small id={`${inputId}-meta`} className="tw-comment-meta">{[...value].length}/1000자{overLimit&&' · 1000자 이내로 줄여 주세요.'}</small>
    {changedByAnother && <div className="tw-comment-conflict" role="status">
      <p>다른 참여자가 댓글을 수정했어요.</p>
      <blockquote>{node.text}</blockquote>
      <Button variant="secondary" className="nodrag nopan" onClick={() => { replaceBuffer({ base: node.text, value: node.text }); setNotice(''); }}>최신 댓글 사용</Button>
    </div>}
    {notice && <p className="tw-comment-meta" role="status">{notice}</p>}
    <div className="tw-comment-editor-actions nodrag nopan">
      <Button disabled={!dirty || !value.trim() || overLimit} onClick={() => save(changedByAnother)}>
        {changedByAnother ? '내 댓글로 저장' : '댓글 저장'}
      </Button>
    </div>
  </div>;
}
