export type CanvasCommandId = 'undo' | 'redo' | 'add-comment' | 'fit' | 'toggle-drawer' | 'toggle-day-links' | 'edit-menu' | 'copy' | 'paste' | 'disconnect' | 'delete';
export type CanvasCommand = { id: CanvasCommandId; label: string; icon: string; surface: 'toolbar'|'context'|'both' };
export const canvasCommands: CanvasCommand[] = [
  { id:'undo', label:'실행 취소', icon:'↶', surface:'both' },
  { id:'redo', label:'다시 실행', icon:'↷', surface:'both' },
  { id:'add-comment', label:'댓글 추가', icon:'▤', surface:'toolbar' },
  { id:'fit', label:'전체 보기', icon:'⌗', surface:'toolbar' },
  { id:'toggle-drawer', label:'장소 패널', icon:'☰', surface:'toolbar' },
  { id:'toggle-day-links', label:'날짜 연결 표시', icon:'날짜 연결', surface:'toolbar' },
  { id:'edit-menu', label:'편집 메뉴', icon:'편집 메뉴', surface:'toolbar' },
  { id:'copy', label:'복사', icon:'복사', surface:'context' },
  { id:'paste', label:'붙여넣기', icon:'붙여넣기', surface:'context' },
  { id:'disconnect', label:'이 장소 연결 끊기', icon:'연결 끊기', surface:'context' },
  { id:'delete', label:'삭제', icon:'삭제', surface:'context' },
];
