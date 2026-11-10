import { useId, useState } from 'react';
import Button from '../../components/ui/Button';
import type { CanvasCommentNode } from './canvasModel';

type Buffer = { base: string; value: string };
const drafts = new Map<string, Buffer>();

export default function CanvasCommentEditor({ tripId, node, onCommit }: {
  tripId: string;
  node: CanvasCommentNode;
  onCommit: (text: string, expectedText: string, force: boolean) => boolean;
}) {
  const key = `${tripId}:${node.id}`;
  const inputId = useId();
  const [buffer, setBuffer] = useState<Buffer>(() => drafts.get(key) ?? { base: node.text, value: node.text });
  const [notice, setNotice] = useState('');
  const dirty = buffer.value !== buffer.base;
  const value = dirty ? buffer.value : node.text;
  const changedByAnother = dirty && node.text !== buffer.base;
  const replaceBuffer = (next: Buffer) => { drafts.set(key, next); setBuffer(next); };
  const save = (force: boolean) => {
    if (!dirty || !value.trim() || [...value].length > 1000) return;
    if (onCommit(value, buffer.base, force)) {
      replaceBuffer({ base: value, value });
      setNotice('');
    } else setNotice('댓글이 먼저 바뀌었어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.');
  };
  return <div className="tw-comment-editor">
    <label htmlFor={inputId}>참여자와 공유할 댓글</label>
    <textarea id={inputId} maxLength={1000} value={value} onChange={(event) => {
      replaceBuffer({ base: dirty ? buffer.base : node.text, value: event.target.value });
      setNotice('');
    }} onKeyDown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!changedByAnother) save(false);
      }
    }} />
    <small>{[...value].length}/1000자</small>
    {changedByAnother && <div className="tw-comment-conflict" role="status">
      <p>다른 참여자가 댓글을 수정했어요.</p>
      <blockquote>{node.text}</blockquote>
      <Button variant="secondary" onClick={() => { replaceBuffer({ base: node.text, value: node.text }); setNotice(''); }}>최신 댓글 사용</Button>
    </div>}
    {notice && <p role="status">{notice}</p>}
    <Button disabled={!dirty || !value.trim()} onClick={() => save(changedByAnother)}>
      {changedByAnother ? '내 댓글로 저장' : '댓글 저장'}
    </Button>
  </div>;
}
