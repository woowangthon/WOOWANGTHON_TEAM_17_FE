import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { applyNodeChanges, Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Button from '../../components/ui/Button';
import PreparationActionButton from '../preparation/PreparationActionButton';
import { canConnectRoute, parseCanvasDocument, safeCanvasText, type CanvasDocument, type CanvasPlace } from './canvasModel';

type PlaceNode = Node<{ place: CanvasPlace; intent: 'route' | 'candidate'; routeLabel?: string }, 'place'>;
type Board = { nodes: PlaceNode[]; edges: Edge[] };
const OpenMenu = createContext<(id: string) => void>(() => {});
const samples: CanvasPlace[] = [
  { name: '도담삼봉', area: '단양 / 자연', note: '강과 봉우리를 바라보는 여행지', day: 1 },
  { name: '구경시장', area: '단양 / 시장', note: '지역 음식과 간식을 둘러보는 전통시장', day: 1 },
  { name: '만천하스카이워크', area: '단양 / 전망', note: '전망 시설과 주변 산책로', day: 1 },
  { name: '수양개빛터널', area: '단양 / 전시', note: '빛 전시를 둘러보는 공간', day: 2 },
];
const edgeStyle = { type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } };
const storageKey = (tripId: string) => `wayfind.canvas.v2.${tripId}`;
function PlaceCard({ id, data, selected }: NodeProps<PlaceNode>) {
  const open = useContext(OpenMenu);
  return <article className={`tw-place-node ${selected ? 'is-selected' : ''} ${data.intent === 'candidate' ? 'is-candidate' : ''}`}>
    <div className="tw-node-meta"><span>{data.place.day}일차</span><span>{data.routeLabel}</span></div>
    <button type="button" className="tw-node-menu-button nodrag nopan" aria-label={`${data.place.name} 장소 메뉴 열기`} onClick={(event) => { event.stopPropagation(); open(id); }}>메뉴</button>
    <strong>{data.place.name}</strong><small>{data.place.area}</small><p>{data.place.note}</p>
    <Handle type="target" position={Position.Left} className="tw-handle" aria-label={`${data.place.name} 앞 장소 연결점`} />
    <Handle type="source" position={Position.Right} className="tw-handle" aria-label={`${data.place.name} 다음 장소 연결점`} />
  </article>;
}
const nodeTypes = { place: PlaceCard };
function seed(): CanvasDocument {
  return { schemaVersion: 2, dayCount: 2, nodes: [
    { id: 'sample-1', position: { x: 40, y: 100 }, data: { place: samples[0], intent: 'route' } },
    { id: 'sample-2', position: { x: 380, y: 100 }, data: { place: samples[1], intent: 'route' } },
    { id: 'sample-3', position: { x: 380, y: 390 }, data: { place: samples[2], intent: 'candidate' } },
    { id: 'sample-4', position: { x: 80, y: 100 }, data: { place: samples[3], intent: 'candidate' } },
  ], edges: [{ id: 'sample-edge', source: 'sample-1', target: 'sample-2' }] };
}
function restore(tripId: string): CanvasDocument {
  try { const raw = localStorage.getItem(storageKey(tripId)); return raw && raw.length < 200_000 ? parseCanvasDocument(JSON.parse(raw)) ?? seed() : seed(); }
  catch { return seed(); }
}
function boardOf(document: CanvasDocument): Board {
  return { nodes: document.nodes.map((node) => ({ ...node, type: 'place' })), edges: document.edges.map((edge) => ({ ...edge, ...edgeStyle })) };
}
function documentOf(board: Board, dayCount: number): CanvasDocument {
  return { schemaVersion: 2, dayCount, nodes: board.nodes.map(({ id, position, data }) => ({ id, position: { ...position }, data: { place: { ...data.place }, intent: data.intent } })), edges: board.edges.map(({ id, source, target }) => ({ id, source, target })) };
}

export default function CanvasPreview({ tripId }: { tripId: string }) {
  const [initial] = useState(() => restore(tripId));
  const [board, setBoard] = useState(() => boardOf(initial));
  const [dayCount, setDayCount] = useState(initial.dayCount);
  const [day, setDay] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(() => window.matchMedia('(min-width: 701px)').matches);
  const [message, setMessage] = useState('');
  const [undoStack, setUndoStack] = useState<Board[]>([]);
  const [redoStack, setRedoStack] = useState<Board[]>([]);
  const [placeName, setPlaceName] = useState('');
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('전체');
  const [catalog, setCatalog] = useState(samples);
  const [replacement, setReplacement] = useState(samples[0].name);
  const [targetId, setTargetId] = useState('');
  const flow = useRef<ReactFlowInstance<PlaceNode> | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const dragStart = useRef<Board | null>(null);
  const selectedNode = board.nodes.find((node) => node.selected && node.data.place.day === day);
  const selectedEdges = board.edges.filter((edge) => edge.selected && board.nodes.some((node) => node.id === edge.source && node.data.place.day === day));
  const days = useMemo(() => new Map(board.nodes.map((node) => [node.id, node.data.place.day])), [board.nodes]);
  const connectedIds = new Set(board.edges.flatMap((edge) => [edge.source, edge.target]));
  const visibleNodes = board.nodes.filter((node) => node.data.place.day === day).map((node) => ({ ...node, data: { ...node.data, routeLabel: node.data.intent === 'candidate' ? '대체 후보' : connectedIds.has(node.id) ? '동선에 포함' : '연결 필요' } }));
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = board.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  const candidates = catalog.filter((place) => (category === '전체' || place.area.endsWith(category)) && place.name.includes(filter.trim()));
  const routeNodes = visibleNodes.filter((node) => node.data.intent === 'route');
  const disconnected = routeNodes.length > 1 && visibleEdges.length !== routeNodes.length - 1;
  useEffect(() => {
    const closePanel = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      setDrawerOpen(false);
      setBoard((current) => ({ nodes: current.nodes.map((node) => ({ ...node, selected: false })), edges: current.edges.map((edge) => ({ ...edge, selected: false })) }));
      document.querySelector<HTMLButtonElement>('[aria-controls="tw-place-panel"]')?.focus();
    };
    window.addEventListener('keydown', closePanel);
    return () => window.removeEventListener('keydown', closePanel);
  }, []);
  function commit(next: Board, note: string) { setUndoStack((stack) => [...stack.slice(-29), structuredClone(board)]); setRedoStack([]); setBoard(next); setMessage(note); }
  function openMenu(id: string) { setBoard((current) => ({ ...current, nodes: current.nodes.map((node) => ({ ...node, selected: node.id === id })), edges: current.edges.map((edge) => ({ ...edge, selected: false })) })); setTargetId(''); setDrawerOpen(true); }
  function changeDay(next: number) { setDay(next); setTargetId(''); setBoard((current) => ({ nodes: current.nodes.map((node) => ({ ...node, selected: false })), edges: current.edges.map((edge) => ({ ...edge, selected: false })) })); }
  function connect(connection: Pick<Connection, 'source' | 'target'>) {
    if (!connection.source || !connection.target || !canConnectRoute(connection.source, connection.target, days, board.edges)) { setMessage('같은 날짜에서 앞뒤 한 장소씩 연결할 수 있어요. 순환 연결은 만들 수 없어요.'); return; }
    const next = { id: crypto.randomUUID(), source: connection.source, target: connection.target, ...edgeStyle };
    commit({ nodes: board.nodes.map((node) => node.id === connection.source || node.id === connection.target ? { ...node, data: { ...node.data, intent: 'route' } } : node), edges: [...board.edges, next] }, '장소를 연결했어요. 카드 배치는 그대로예요.'); setTargetId('');
  }
  function removeSelection() {
    const ids = new Set(board.nodes.filter((node) => node.selected && node.data.place.day === day).map((node) => node.id));
    const edgeIds = new Set(selectedEdges.map((edge) => edge.id)); if (!ids.size && !edgeIds.size) return;
    commit({ nodes: board.nodes.filter((node) => !ids.has(node.id)), edges: board.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target) && !edgeIds.has(edge.id)) }, '선택한 항목을 삭제했어요. 남은 장소를 자동으로 연결하지 않아요.');
  }
  function addPlace(place: CanvasPlace, point?: { x: number; y: number }) {
    if (board.nodes.length >= 100) { setMessage('장소는 최대 100개까지 둘 수 있어요.'); return; }
    const box = canvas.current?.getBoundingClientRect();
    const position = point ?? (box && flow.current ? flow.current.screenToFlowPosition({ x: box.left + box.width / 2 - 100, y: box.top + box.height / 2 - 70 }) : { x: 100, y: 100 });
    commit({ ...board, nodes: [...board.nodes, { id: crypto.randomUUID(), type: 'place', position, data: { place: { ...place, day }, intent: 'candidate' } }] }, `${place.name}을 대체 후보로 추가했어요.`);
  }
  function undo() { const previous = undoStack.at(-1); if (!previous) return; setRedoStack((stack) => [...stack, structuredClone(board)]); setUndoStack((stack) => stack.slice(0, -1)); setBoard(previous); setMessage('이전 편집으로 돌아갔어요.'); }
  function redo() { const next = redoStack.at(-1); if (!next) return; setUndoStack((stack) => [...stack, structuredClone(board)]); setRedoStack((stack) => stack.slice(0, -1)); setBoard(next); setMessage('편집을 다시 적용했어요.'); }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target as HTMLElement).closest('input,textarea,select,button')) { event.preventDefault(); removeSelection(); }
  }
  const serialized = JSON.stringify(documentOf(board, dayCount));
  const lastDocument = useRef(serialized);
  useLayoutEffect(() => { lastDocument.current = serialized; }, [serialized]);
  useEffect(() => () => { try { localStorage.setItem(storageKey(tripId), lastDocument.current); } catch { /* Keep the in-memory board when storage is unavailable. */ } }, [tripId]);
  useEffect(() => { const timer = window.setTimeout(() => { try { localStorage.setItem(storageKey(tripId), serialized); } catch { setMessage('이 기기에 저장하지 못했어요. 페이지를 닫기 전에 편집 내용을 확인해 주세요.'); } }, 150); return () => window.clearTimeout(timer); }, [serialized, tripId]);

  return <section className="tw-canvas-embedded" aria-label="일정 캔버스" onKeyDown={keyboard} tabIndex={-1}>
    <div className="prep-main prep-canvas-intro"><header className="prep-page-heading"><div className="prep-heading-info"><h1>일정 캔버스</h1><p>카드는 자유롭게, 방문 순서는 연결선으로.</p></div><div className="tw-canvas-actions"><PreparationActionButton label="실행 취소" onClick={undo} disabled={!undoStack.length} /><PreparationActionButton label="다시 실행" onClick={redo} disabled={!redoStack.length} /><PreparationActionButton label={drawerOpen ? '장소 목록 닫기' : '장소 목록 열기'} onClick={() => setDrawerOpen((open) => !open)} ariaExpanded={drawerOpen} ariaControls="tw-place-panel" /></div></header>
      <p className="tw-sample-note">예시 장소로 편집을 시험해 보세요. 이 기기에만 저장되며 다른 참여자에게 공유되지 않아요.</p>
    </div>
    <div className={`tw-canvas-shell ${drawerOpen ? '' : 'is-drawer-closed'}`}>
      <section className="tw-flow-area" aria-label="일정 장소 캔버스">
        <nav className="tw-day-tabs" aria-label="여행 날짜">{Array.from({ length: dayCount }, (_, index) => index + 1).map((number) => <button type="button" key={number} aria-current={day === number ? 'page' : undefined} aria-pressed={day === number} onClick={() => changeDay(number)}>{number}일차</button>)}<button type="button" disabled={dayCount >= 31} onClick={() => { setDayCount(dayCount + 1); changeDay(dayCount + 1); }}>날짜 추가</button></nav>
        <div className="tw-flow-canvas" ref={canvas} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={(event) => { event.preventDefault(); const place = samples.find((item) => item.name === event.dataTransfer.getData('application/osami-place')); if (place && flow.current) addPlace(place, flow.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })); }}>
          <OpenMenu.Provider value={openMenu}><ReactFlow<PlaceNode> nodes={visibleNodes} edges={visibleEdges} nodeTypes={nodeTypes} onInit={(instance) => { flow.current = instance; }} onNodesChange={(changes) => setBoard((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }))} onEdgesChange={(changes) => setBoard((current) => ({ ...current, edges: current.edges.map((edge) => { const selection = changes.find((change) => change.type === 'select' && change.id === edge.id); return selection?.type === 'select' ? { ...edge, selected: selection.selected } : edge; }) }))} onConnect={connect} isValidConnection={(connection) => canConnectRoute(connection.source, connection.target, days, board.edges)} onNodeDragStart={() => { dragStart.current = structuredClone(board); }} onNodeDragStop={() => { if (dragStart.current) { const previous = dragStart.current; setUndoStack((stack) => [...stack.slice(-29), previous]); setRedoStack([]); dragStart.current = null; } }} onNodeContextMenu={(event, node) => { event.preventDefault(); openMenu(node.id); }} fitView fitViewOptions={{ padding: 0.25, maxZoom: 1 }} minZoom={0.2} maxZoom={2} deleteKeyCode={null} defaultEdgeOptions={edgeStyle}>
            <Background variant={BackgroundVariant.Lines} gap={32} size={1} color="var(--tw-grid)" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor="var(--tw-rule)" maskColor="var(--tw-map-mask)" />
          </ReactFlow></OpenMenu.Provider>
          {visibleNodes.length === 0 && <div className="tw-empty-canvas"><strong>{day}일차가 비어 있어요</strong><p>장소 목록에서 후보를 추가해 보세요.</p><Button variant="secondary" onClick={() => setDrawerOpen(true)}>장소 목록 열기</Button></div>}
          {selectedEdges.length > 0 && <div className="tw-edge-actions"><span>선택한 연결</span><Button variant="secondary" onClick={removeSelection}>연결 끊기</Button></div>}
        </div>
        <div className="tw-canvas-summary"><span>동선 {routeNodes.length}곳</span><span>대체 후보 {visibleNodes.length - routeNodes.length}곳</span><span>{disconnected ? '동선 연결 필요' : '이동 시간과 요금 미확인'}</span></div>
        <p className="tw-canvas-help" role="status">{message || '카드의 연결점을 끌어 연결하세요. 카드 메뉴에서도 다음 장소를 고를 수 있어요.'}</p>
      </section>
      {drawerOpen && <aside id="tw-place-panel" className="tw-place-drawer" aria-label="장소 목록"><div className="tw-drawer-heading"><h2>장소 목록</h2><button type="button" onClick={() => setDrawerOpen(false)} aria-label="장소 패널 닫기">닫기</button></div>
        {selectedNode && <section className="tw-node-inspector" aria-label="선택한 장소 메뉴"><div className="tw-drawer-head"><h3>{selectedNode.data.place.name}</h3><p>{selectedNode.data.place.area}</p></div>
          <label htmlFor="tw-change-day">여행 날짜</label><select id="tw-change-day" className="text-input" value={selectedNode.data.place.day} onChange={(event) => { const nextDay = Number(event.target.value); if (nextDay === day) return; commit({ nodes: board.nodes.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, place: { ...node.data.place, day: nextDay } } } : node), edges: board.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id) }, '날짜를 옮기고 이전 연결을 끊었어요.'); setDay(nextDay); }}>{Array.from({ length: dayCount }, (_, index) => index + 1).map((number) => <option key={number} value={number}>{number}일차</option>)}</select>
          <label htmlFor="tw-connect-target">다음에 방문할 장소</label><select id="tw-connect-target" className="text-input" value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">장소 선택</option>{visibleNodes.filter((node) => canConnectRoute(selectedNode.id, node.id, days, board.edges)).map((node) => <option key={node.id} value={node.id}>{node.data.place.name}</option>)}</select><Button variant="secondary" disabled={!targetId} onClick={() => connect({ source: selectedNode.id, target: targetId })}>다음 장소 연결</Button>
          <Button variant="secondary" disabled={!board.edges.some((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)} onClick={() => commit({ ...board, edges: board.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id) }, '연결만 끊었어요. 장소와 카드 배치는 남아 있어요.')}>이 장소의 연결 끊기</Button>
          <label htmlFor="tw-replace-place">대체 장소</label><select id="tw-replace-place" className="text-input" value={replacement} onChange={(event) => setReplacement(event.target.value)}>{samples.map((place) => <option key={place.name}>{place.name}</option>)}</select><Button variant="secondary" onClick={() => { const place = samples.find((item) => item.name === replacement); if (place) commit({ ...board, nodes: board.nodes.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, place: { ...place, day } } } : node) }, '장소를 바꾸고 카드 위치와 연결을 유지했어요.'); }}>장소 바꾸기</Button><Button variant="secondary" onClick={removeSelection}>장소 삭제</Button>
        </section>}
        <div className="tw-drawer-head"><h3>대체 후보 찾기</h3><p>예시 목록이에요. 선택하거나 캔버스로 끌어 놓으세요.</p></div><label htmlFor="tw-place-search">장소 이름</label><input id="tw-place-search" className="text-input" maxLength={100} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="후보 검색" /><div className="tw-filter-row"><label htmlFor="tw-place-category">종류</label><select id="tw-place-category" className="text-input" value={category} onChange={(event) => setCategory(event.target.value)}>{['전체', '자연', '시장', '전망', '전시'].map((item) => <option key={item}>{item}</option>)}</select><Button variant="secondary" onClick={() => { const shuffled = [...catalog]; for (let index = shuffled.length - 1; index > 0; index--) { const swap = Math.floor(Math.random() * (index + 1)); [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]; } setCatalog(shuffled); }}>목록 순서 섞기</Button></div>
        <ul className="tw-place-list">{candidates.map((place) => <li key={place.name}><article draggable onDragStart={(event) => { event.dataTransfer.setData('application/osami-place', place.name); event.dataTransfer.effectAllowed = 'copy'; }}><strong>{place.name}</strong><small>{place.area}</small><p>{place.note}</p><Button variant="secondary" disabled={board.nodes.length >= 100} onClick={() => addPlace(place)}>캔버스에 추가</Button></article></li>)}</ul>{!candidates.length && <p>일치하는 예시 장소가 없어요.</p>}
        <label htmlFor="custom-place">직접 장소 추가</label><div className="tw-custom-place"><input id="custom-place" className="text-input" maxLength={100} value={placeName} onChange={(event) => setPlaceName(event.target.value)} placeholder="장소 이름" /><Button variant="secondary" disabled={!placeName.trim() || board.nodes.length >= 100} onClick={() => { const name = placeName.trim(); if (!safeCanvasText(name, 100)) { setMessage('장소 이름에 사용할 수 없는 문자가 있어요.'); return; } addPlace({ name, area: '직접 추가', note: '상세 정보와 요금은 아직 확인하지 않았어요.', day }); setPlaceName(''); }}>추가</Button></div>
        <Button disabled aria-describedby="tw-ai-note">AI 추천</Button><small id="tw-ai-note">추천 API 연결 전이에요. 현재는 직접 장소를 고를 수 있어요.</small>
      </aside>}
    </div>
  </section>;
}
