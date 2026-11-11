import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { addEdge, applyNodeChanges, Background, BackgroundVariant, BaseEdge, Controls, Handle, MarkerType, Position, ReactFlow, useStore, useReactFlow, type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance, type Rect } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Button from '../../components/ui/Button';
import CanvasToolIcon from './CanvasToolIcon';
import CanvasCommentEditor from './CanvasCommentEditor';
import { getPlaceDetail, recommendPlace, searchPlaces, type PlaceSearchResult } from './canvasApi';
import { canConnectRoute, canvasClipboardCopy, copyCanvasNode, mergeCanvasDocuments, replaceCanvasPlace, type CanvasColor, type CanvasCommentNode, type CanvasDocument, type CanvasNode, type CanvasPlaceDetail, type CanvasPlaceNode } from './canvasModel';
import { canvasCommands, type CanvasCommandId } from './canvasCommands';
import { retainRecommendationRequest, type RecommendationRequest } from './canvasRecommendation.ts';
import { useCanvasSync } from './useCanvasSync';
import { useCanvasRoutes } from './useCanvasRoutes.ts';
import type { CanvasTravelMode } from './canvasRoutes.ts';
import { canvasViewScope, consumeHandoff, firstRouteDay, hasFittedHandoff, markHandoffFitted, readCanvasView, resolveCanvasMountView, writeCanvasView, type CanvasHandoff, type CanvasViewMemory, type CanvasViewport } from './canvasHandoff.ts';
import { canvasDocumentPosition, canvasFrameNodePosition, ensureCanvasDateRange, frameForPoint, layoutCanvasDayFrames, dayLabel, resolveCanvasDrop, type CanvasFrameLayout } from './canvasDayFrames.ts';

type FlowNode = Node<{ model: CanvasNode; title?: string; detail?: CanvasPlaceDetail; visitLabel?: string; dayTitle?: string; nextDayId?:string; isActive?:boolean; placeCount?: number; mealCount?: number; commentCount?: number }, 'place'|'comment'|'dayFrame'>;
type Board = { nodes: FlowNode[]; edges: Edge[] };
type FlowEdge = Edge<{ worldPoints?: Array<{x:number;y:number}>; targetDayId?:string }>;
const OpenCanvasMenu=createContext<(id:string,element:HTMLElement)=>void>(()=>{});
const FocusCanvasDay=createContext<(dayId:string)=>void>(()=>{});
type DiscoveryMemory={tab:'ai'|'search';query:string;results:PlaceSearchResult[];prompt:string;aiPlace:CanvasPlaceDetail|null;aiAlternatives:CanvasPlaceDetail[];pending:RecommendationRequest|null};
const discoveryMemory=new Map<string,DiscoveryMemory>();
const colorOptions: Array<[CanvasColor,string]> = [['default','기본'],['lime','연두'],['sky','하늘'],['rose','분홍'],['amber','살구']];
const colorName=(color:CanvasColor)=>colorOptions.find(([value])=>value===color)?.[1]??'기본';
const marker = { type: MarkerType.ArrowClosed, color: 'var(--color-accent-hover)' };
const edgeStyle = { type: 'smoothstep' as const, markerEnd: marker, style: { stroke: 'var(--color-accent-hover)', strokeWidth: 2 } };
function frameBounds(frames: CanvasFrameLayout[]): Rect | null {
  if (!frames.length) return null;
  const x = Math.min(...frames.map(frame => frame.position.x));
  const y = Math.min(...frames.map(frame => frame.position.y));
  const right = Math.max(...frames.map(frame => frame.position.x + frame.width));
  const bottom = Math.max(...frames.map(frame => frame.position.y + frame.height));
  return { x, y, width: right - x, height: bottom - y };
}

function FitDayFrames({ bounds, onFitted }: { bounds: Rect; onFitted: (viewport: CanvasViewport) => void }) {
  const flow = useReactFlow<FlowNode>();
  const ready = useStore(state => Boolean(state.width && state.height && state.panZoom));
  const { x, y, width, height } = bounds;
  useEffect(() => {
    if (!ready) return;
    let current = true;
    void flow.fitBounds({ x, y, width, height }, { padding: .14, duration: 0 }).then(fitted => {
      if (current && fitted) onFitted(flow.getViewport());
    });
    return () => { current = false; };
  }, [flow, ready, x, y, width, height, onFitted]);
  return null;
}

function RestoreCanvasViewport({ viewport, onRestored }: { viewport:CanvasViewport; onRestored:()=>void }) {
  const flow = useReactFlow<FlowNode>();
  const viewportReady = flow.viewportInitialized;
  useEffect(() => {
    if (!viewportReady) return;
    let active = true;
    void flow.setViewport(viewport, { duration: 0 }).then(restored => { if (active && restored) onRestored(); }, () => {});
    return () => { active = false; };
  }, [flow, viewportReady, onRestored, viewport]);
  return null;
}
function DayFrame({ data }: NodeProps<FlowNode>) {
  const focusDay=useContext(FocusCanvasDay);
  return <section className={`tw-canvas-day-frame ${data.isActive?'is-active':''}`} aria-label={`${data.dayTitle} 일정 그룹`}>
    <Handle type="target" id="day-order-in" position={Position.Left} isConnectable={false} className="tw-daylink-handle" />
    <Handle type="source" id="day-order-out" position={Position.Right} isConnectable={false} className="tw-daylink-handle" />
    <header><button type="button" className="tw-day-frame-focus nodrag nopan" aria-label={`${data.dayTitle} 영역으로 이동`} onClick={event=>{event.stopPropagation();focusDay(data.model.dayId);}}>{data.dayTitle}</button><span>장소 {data.placeCount}{data.mealCount ? ` · 식사 ${data.mealCount}` : ''} · 댓글 {data.commentCount}</span>{data.nextDayId&&<button type="button" className="tw-day-frame-next nodrag nopan" aria-label={`${data.dayTitle} 다음 날짜로 이동`} onClick={event=>{event.stopPropagation();focusDay(data.nextDayId!);}}>다음 날짜 →</button>}</header>
  </section>;
}
const roleLabels: Record<string, string> = {
  meal_stop: '식당', sightseeing_stop: '관광', culture_stop: '문화', activity_stop: '체험',
  shopping_stop: '쇼핑', overnight_lodging: '숙소', overnight_camping: '캠핑', date_specific_event: '행사',
};
function DayOrderEdge({ id, data, markerEnd }: EdgeProps<FlowEdge>) {
  const points = data?.worldPoints ?? [];
  if (points.length < 2) return null;
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={18} style={{ stroke: 'var(--canvas-muted)', strokeWidth: 2, strokeDasharray: '5 4' }} />;
}
function PlaceCard({ id,data, selected }: NodeProps<FlowNode>) { const model = data.model as CanvasPlaceNode; const open=useContext(OpenCanvasMenu); return <article className={`tw-place-node ${selected?'is-selected':''} ${model.intent==='candidate'?'is-candidate':''} color-${model.color}`}><button type="button" className="tw-node-menu-button nodrag nopan" aria-label={`${data.title??'장소'} 편집 메뉴`} onClick={event=>{event.stopPropagation();open(id,event.currentTarget);}}>⋯</button><div className="tw-node-meta"><span>{model.intent==='candidate'?'대안':'동선'}</span><span>{model.color==='default'?'':colorName(model.color)}</span></div><strong>{data.title ?? '장소 정보 확인 중'}</strong><small>{data.detail?.address ?? data.detail?.category ?? '주소·상세 정보 미확인'}</small>{data.visitLabel&&<small className="tw-place-schedule">{data.visitLabel}</small>}{Number.isInteger(data.detail?.estimatedStayMinutes)&&<small>체류 {data.detail!.estimatedStayMinutes}분 · 장소 정보</small>}{data.detail?.planningRole && roleLabels[data.detail.planningRole] && <p>{roleLabels[data.detail.planningRole]}</p>}<Handle type="target" position={Position.Left} className="tw-handle" aria-label="앞 장소 연결점" /><Handle type="source" position={Position.Right} className="tw-handle" aria-label="다음 장소 연결점" /></article>; }
function CommentCard({ id,data, selected }: NodeProps<FlowNode>) { const model = data.model as CanvasCommentNode; const open=useContext(OpenCanvasMenu); return <article className={`tw-comment-node color-${model.color} ${selected?'is-selected':''}`}><button type="button" className="tw-node-menu-button nodrag nopan" aria-label="댓글 편집 메뉴" onClick={event=>{event.stopPropagation();open(id,event.currentTarget);}}>⋯</button><span>공유 댓글</span><p>{model.text}</p></article>; }
const nodeTypes = { place: PlaceCard, comment: CommentCard, dayFrame: DayFrame };
const edgeTypes = { dayOrder: DayOrderEdge };
function plannedKst(schedule: CanvasPlaceNode['schedule']): string | undefined {
  if (!schedule || (!schedule.startAt && !schedule.endAt)) return undefined;
  const format = (value: string | null) => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : null;
  const start = format(schedule.startAt); const end = format(schedule.endAt);
  return start && end ? `예상 시각 ${start}–${end} KST` : `예상 시각 ${start ?? end} KST`;
}
function boardOf(doc: CanvasDocument, details: Map<number,CanvasPlaceDetail>): Board { return { nodes: doc.nodes.map((model) => ({ id:model.id,type:model.kind,position:{...model.position},data:{model,...(model.kind==='place'?{title:details.get(model.contentid)?.title,detail:details.get(model.contentid),visitLabel:plannedKst(model.schedule)}:{})} })), edges:doc.edges.map((edge)=>({...edge,...edgeStyle})) }; }
function docOf(nodes: FlowNode[], edges: Edge[], days: CanvasDocument['days']): CanvasDocument { return { schemaVersion:3, days, nodes:nodes.filter(n=>n.type!=='dayFrame').map((n)=>n.data.model), edges:edges.map(({id,source,target})=>({id,source,target})) }; }

export default function CanvasPreview({ tripId, preview = false, startDate, endDate, conditionsVersion = null, transport = null, handoff }: { tripId:string; preview?:boolean; startDate?:string|null; endDate?:string|null; conditionsVersion?:number|null; transport?:CanvasTravelMode; handoff?:CanvasHandoff|null }) {
  const sync = useCanvasSync(tripId, preview); const doc = sync.document;
  const viewScope=canvasViewScope(tripId,preview); const savedView=readCanvasView(viewScope);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const closeDrawer = () => { setDrawerOpen(false); drawerTrigger.current?.focus(); };
  const initialDiscovery=discoveryMemory.get(tripId); const [details,setDetails]=useState<Map<number,CanvasPlaceDetail>>(new Map()); const [dayId,setDayId]=useState(savedView?.dayId??''); const [restoreViewport,setRestoreViewport]=useState<CanvasViewport|null>(null); const [initialFitPending,setInitialFitPending]=useState(false); const [drawerOpen,setDrawerOpen]=useState(()=>window.matchMedia('(min-width: 701px)').matches); const [tab,setTab]=useState<DiscoveryMemory['tab']>(initialDiscovery?.tab??'ai'); const [query,setQuery]=useState(initialDiscovery?.query??''); const [results,setResults]=useState<PlaceSearchResult[]>(initialDiscovery?.results??[]); const [prompt,setPrompt]=useState(initialDiscovery?.prompt??''); const [aiPlace,setAiPlace]=useState<CanvasPlaceDetail|null>(initialDiscovery?.aiPlace??null); const [aiAlternatives,setAiAlternatives]=useState<CanvasPlaceDetail[]>(initialDiscovery?.aiAlternatives??[]); const [busy,setBusy]=useState(false); const [recommendationPending,setRecommendationPending]=useState(Boolean(initialDiscovery?.pending)); const [message,setMessage]=useState(''); const [searchMessage,setSearchMessage]=useState(''); const [selectedId,setSelectedId]=useState(''); const [selectedEdgeId,setSelectedEdgeId]=useState(''); const [replaceTargetId,setReplaceTargetId]=useState(''); const [dayLinksOn,setDayLinksOn]=useState(true); const [measuredSizes,setMeasuredSizes]=useState<Map<string,{width:number;height:number}>>(new Map()); const [menu,setMenu]=useState<{x:number;y:number;nodeId?:string}|null>(null);  const [hasClipboard,setHasClipboard]=useState(false);
  const [flowNodes,setFlowNodes]=useState<{base:CanvasDocument|null;nodes:FlowNode[]}|null>(null); const [fitFocus,setFitFocus]=useState<'all'|'day'>('all'); const flow=useRef<ReactFlowInstance<FlowNode>|null>(null); const shell=useRef<HTMLDivElement>(null); const menuRef=useRef<HTMLDivElement>(null); const menuOpener=useRef<HTMLElement|null>(null); const clipboard=useRef<CanvasNode|null>(null); const abort=useRef<AbortController|null>(null); const triedDetails=useRef<Set<number>>(new Set()); const pendingRecommendation=useRef<RecommendationRequest|null>(initialDiscovery?.pending??null);
  const viewInitialized=useRef(false); const viewSnapshot=useRef<CanvasViewMemory>({dayId:savedView?.dayId??'',viewport:savedView?.viewport??null});
  const [fitTarget,setFitTarget]=useState<{key:string;nodes:string[]}|null>(null);
  const currentFitKey=useRef<string|null>(null);currentFitKey.current=fitTarget?.key??null;
  const completeFit=useCallback((viewport:CanvasViewport)=>{const key=currentFitKey.current;if(key){markHandoffFitted(key);setFitTarget(current=>current?.key===key?null:current);}setInitialFitPending(false);viewSnapshot.current={...viewSnapshot.current,viewport};writeCanvasView(viewScope,viewSnapshot.current);},[viewScope]);
  const completeRestore=useCallback(()=>setRestoreViewport(null),[]);
  useEffect(()=>{ if(!doc)return;
    const mountView=resolveCanvasMountView(doc,viewScope,handoff?.tripId===tripId?handoff:null);
    if(mountView.kind==='handoff'){
      const {target,key}=mountView;consumeHandoff(viewScope,handoff!.handoffId);viewInitialized.current=true;
      setDayId(target.dayId);viewSnapshot.current={dayId:target.dayId,viewport:null};writeCanvasView(viewScope,viewSnapshot.current);
      setSelectedId('');setSelectedEdgeId('');setMenu(null);setRestoreViewport(null);setInitialFitPending(false);
      const frameIds=doc.days.map(day=>`day-frame:${day.id}`);
      setFitTarget(frameIds.length&&!hasFittedHandoff(key)?{key,nodes:frameIds}:null);
      if(!target.matched)setMessage(target.nodeIds.length?'생성한 장소가 삭제되어 저장된 경로를 보여주고 있어요.':'생성한 장소가 삭제되어 캔버스가 비어 있어요.');
      return;
    }
    if(viewInitialized.current){
      if(dayId&&!doc.days.some(day=>day.id===dayId)){
        const fallbackDay=firstRouteDay(doc);setDayId(fallbackDay);viewSnapshot.current={dayId:fallbackDay,viewport:null};
        setRestoreViewport(null);setFitFocus('day');setInitialFitPending(Boolean(doc.nodes.some(node=>node.kind==='place'&&node.dayId===fallbackDay)));
        if(fallbackDay)writeCanvasView(viewScope,viewSnapshot.current);
      }
      return;
    }
    const targetDay=mountView.dayId;
    viewInitialized.current=true;setDayId(targetDay);viewSnapshot.current={dayId:targetDay,viewport:mountView.viewport};
    setRestoreViewport(mountView.viewport);setInitialFitPending(!mountView.viewport && Boolean(doc.days.length));
    if(targetDay)writeCanvasView(viewScope,viewSnapshot.current);
  },[dayId,doc,handoff,tripId,viewScope]);
  useEffect(()=>()=>writeCanvasView(viewScope,viewSnapshot.current),[viewScope]);
  const pendingMountView=doc?resolveCanvasMountView(doc,viewScope,handoff?.tripId===tripId?handoff:null):null;
  const pendingHandoffTarget=pendingMountView?.kind==='handoff'?pendingMountView.target:null;
  const activeDayId=pendingHandoffTarget?.dayId||(doc?.days.some(item=>item.id===dayId)?dayId:doc?firstRouteDay(doc):'');
  const handoffWarningLabels=handoff?.tripId===tripId&&sync.state?.sourcePlan?.planId===handoff.planId&&sync.state.sourcePlan.versionId===handoff.versionId?[...new Set(handoff.warningCodes??[])].flatMap(code=>({MEAL_SLOT_UNFILLED:'점심 또는 저녁 식사 후보가 일정에 포함되지 않았어요.',TRANSFER_TIME_ESTIMATED:'일부 이동 시간은 확인되지 않았어요.',STAY_TIME_ESTIMATED:'장소별 체류 시간은 예상값이에요.'}[code]??[])):[];
  const completeInitialFit=useCallback((viewport:CanvasViewport)=>{setInitialFitPending(false);setFitFocus('all');viewSnapshot.current={...viewSnapshot.current,dayId:activeDayId,viewport};writeCanvasView(viewScope,viewSnapshot.current);},[activeDayId,viewScope]);
  const knownDates=doc?.days.flatMap(item=>item.date?[item.date]:[])??[];
  const formatTripDate=(date:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}).format(new Date(`${date}T12:00:00Z`));
  const tripRangeLabel=knownDates.length?`${formatTripDate(knownDates[0])}${knownDates.length>1&&knownDates.at(-1)!==knownDates[0]?`–${formatTripDate(knownDates.at(-1)!)}`:''} · ${doc?.days.length??0}일`:`여행 일정 · ${doc?.days.length??0}일`;
  const routes=useCanvasRoutes(tripId,conditionsVersion,transport,doc??null,null,preview);
  useEffect(()=>{
    if(!doc)return;
    const dated=ensureCanvasDateRange(doc,startDate,endDate,Boolean(sync.state?.sourcePlan));
    if(dated!==doc)sync.update(dated);
  },[doc,endDate,startDate,sync.state?.sourcePlan,sync.update]);
  const placeDetails=useMemo(()=>{const combined=new Map((sync.state?.places??[]).map(place=>[place.contentid,place]));for(const [id,place] of details)combined.set(id,place);return combined;},[sync.state,details]);
  useEffect(()=>{ if(!doc||preview) return; const missing=[...new Set(doc.nodes.filter((n):n is CanvasPlaceNode=>n.kind==='place').map(n=>n.contentid))].filter(id=>!placeDetails.has(id)&&!triedDetails.current.has(id)); if(!missing.length)return; const attemptedDetails=triedDetails.current;missing.forEach(id=>attemptedDetails.add(id)); const ctrl=new AbortController();let settled=false; void Promise.all(missing.map(id=>getPlaceDetail(tripId,id,ctrl.signal).then(p=>[id,p] as const).catch(()=>null))).then(items=>{settled=true;if(ctrl.signal.aborted)return;const successful=items.filter((item):item is readonly [number,CanvasPlaceDetail]=>item!==null);if(successful.length)setDetails(old=>{const next=new Map(old);for(const [id,place] of successful)next.set(id,place);return next;});}); return ()=>{ctrl.abort();if(!settled)for(const id of missing)attemptedDetails.delete(id);}; },[doc,placeDetails,preview,tripId]);
  const board=useMemo(()=>doc?boardOf(doc,placeDetails):{nodes:[],edges:[]},[doc,placeDetails]);
  const frameLayouts=useMemo(()=>doc?layoutCanvasDayFrames(doc,measuredSizes):new Map<string,CanvasFrameLayout>(),[doc,measuredSizes]);
  const focusDay = useCallback((nextId: string) => {
    const frame = frameLayouts.get(nextId);
    if (!frame) return;
    setDayId(nextId);
    setSelectedId('');
    setReplaceTargetId('');
    setSelectedEdgeId('');
    setMenu(null);
    viewSnapshot.current = { dayId: nextId, viewport: null };
    writeCanvasView(viewScope, viewSnapshot.current);
    const bounds = { ...frame.position, width: frame.width, height: frame.height };
    void flow.current?.fitBounds(bounds, { padding: .12, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 });
  }, [frameLayouts, viewScope]);
  const allFrameNodes=useMemo(()=>{
    if(!doc)return [];
    const frames:FlowNode[]=doc.days.map((item,index)=>{
      const layout=frameLayouts.get(item.id)!;
      const groupNodes=doc.nodes.filter(node=>node.dayId===item.id);
      return {id:`day-frame:${item.id}`,type:'dayFrame',position:layout.position,draggable:false,selectable:false,connectable:false,zIndex:-1,style:{width:layout.width,height:layout.height},data:{model:{id:item.id,kind:'comment',dayId:item.id,position:{x:0,y:0},color:'default',text:''},dayTitle:dayLabel(item,index),nextDayId:doc.days[index+1]?.id,isActive:item.id===activeDayId,placeCount:groupNodes.filter(node=>node.kind==='place').length,mealCount:groupNodes.filter((node):node is CanvasPlaceNode=>node.kind==='place'&&placeDetails.get(node.contentid)?.planningRole==='meal_stop').length,commentCount:groupNodes.filter(node=>node.kind==='comment').length}} as FlowNode;
    });
    const children=board.nodes.map(node=>{
      const layout=frameLayouts.get(node.data.model.dayId)!;
      return {...node,parentId:`day-frame:${layout.dayId}`,position:canvasFrameNodePosition(node.data.model,layout),selected:node.id===selectedId,zIndex:1};
    });
    return [...frames,...children];
  },[activeDayId,board.nodes,doc,frameLayouts,placeDetails,selectedId]);
  const overviewBounds = frameBounds([...frameLayouts.values()]);
  const activeFrame = frameLayouts.get(activeDayId);
  const initialBounds = fitFocus === 'day' && activeFrame ? frameBounds([activeFrame]) : overviewBounds;
  const cardsMeasured = doc?.nodes.every(node => measuredSizes.has(node.id));
  const totalPlaces=doc?.nodes.filter(node=>node.kind==='place').length??0;
  const totalComments=doc?.nodes.filter(node=>node.kind==='comment').length??0;
  const totalConnections=doc?.edges.length??0;
  const visibleEdges:FlowEdge[]=[
    ...board.edges.map(e=>({...e,...edgeStyle,selected:e.id===selectedEdgeId,label:preview?'시간 미확인':routes.labels.get(e.id)??'시간 미확인',labelStyle:{fill:'var(--canvas-ink)',fontSize:12},labelBgStyle:{fill:'var(--canvas-surface)',stroke:'var(--canvas-border)'},labelBgPadding:[6,3] as [number,number],labelBgBorderRadius:8,labelShowBg:true})),
    ...(dayLinksOn&&doc?doc.days.slice(0,-1).flatMap((day,index)=>{
      const next=doc.days[index+1];
      const connector=frameLayouts.get(day.id)?.connectorToNext;
      if(!next||!connector)return [];
      return [{id:`day-order:${day.id}:${next.id}`,source:`day-frame:${day.id}`,sourceHandle:'day-order-out',target:`day-frame:${next.id}`,targetHandle:'day-order-in',type:'dayOrder',selectable:false,deletable:false,focusable:false,markerEnd:{...marker,color:'var(--canvas-muted)'},data:{worldPoints:connector.points,targetDayId:next.id}}];
    }):[]),
  ];
  const selected=board.nodes.find(n=>n.id===selectedId); const selectedModel=selected?.data.model;
  const placeMap=new Map(board.nodes.filter(n=>n.data.model.kind==='place').map(n=>[n.id,n.data.model.dayId]));
  const publish=(nextNodes:FlowNode[],nextEdges:Edge[],note:string)=>{if(!doc)return;const proposed=docOf(nextNodes,nextEdges,doc.days);let conflictPaths:string[]=[];const updated=sync.update(current=>{const merged=mergeCanvasDocuments(doc,proposed,current);conflictPaths=merged.conflicts;return merged.document??current;});if(!updated&&conflictPaths.length){setMessage(`다른 참여자의 변경과 겹쳐 이 편집을 보류했어요: ${conflictPaths.slice(0,3).join(', ')}`);return;}setMessage(note);};
  const editNode=(id:string,update:(model:CanvasNode)=>CanvasNode,note='변경 사항을 저장하고 있어요.')=>{const nodes=board.nodes.map(n=>n.id===id?{...n,data:{...n.data,model:update(n.data.model)}}:n);publish(nodes,board.edges,note);};
  const moveNode=(nodeId:string,nextDay:string)=>{if(!doc)return;const model=board.nodes.find(n=>n.id===nodeId)?.data.model;if(!model||model.dayId===nextDay)return;const from=frameLayouts.get(model.dayId);const to=frameLayouts.get(nextDay);if(!to)return;const local=from?canvasFrameNodePosition(model,from):model.position;const position=canvasDocumentPosition(local,to);const edges=model.kind==='place'?board.edges.filter(e=>e.source!==nodeId&&e.target!==nodeId):board.edges;const nodes=board.nodes.map(n=>n.id===nodeId?{...n,data:{...n.data,model:{...model,dayId:nextDay,position}}}:n);publish(nodes,edges,model.kind==='place'?'날짜를 옮기고 기존 연결을 함께 제거했어요.':'댓글 날짜를 옮겼어요.');changeDay(nextDay);};
  const connect=(connection:Pick<Connection,'source'|'target'>)=>{if(!connection.source||!connection.target||!doc||!canConnectRoute(connection.source,connection.target,placeMap,doc.edges)){setMessage('같은 날짜의 장소끼리 앞뒤 한 곳씩 연결할 수 있어요. 순환 연결은 만들 수 없어요.');return;}const nodes=board.nodes.map(node=>node.id===connection.source||node.id===connection.target?{...node,data:{...node.data,model:node.data.model.kind==='place'?{...node.data.model,intent:'route' as const}:node.data.model}}:node);publish(nodes,addEdge({...connection,id:crypto.randomUUID(),...edgeStyle},board.edges),'장소를 연결했어요. 다른 카드는 자동으로 연결하지 않아요.');};
  const remove=()=>{if(!doc)return;const nodeId=board.nodes.find(node=>node.id===(menu?.nodeId??selectedId))?.id;if(nodeId){const ids=new Set([nodeId]);publish(board.nodes.filter(n=>!ids.has(n.id)),board.edges.filter(e=>!ids.has(e.source)&&!ids.has(e.target)),'선택한 카드를 삭제하고 연결선을 함께 제거했어요.');setSelectedId('');setMenu(null);return;}if(selectedEdgeId&&visibleEdges.some(e=>e.id===selectedEdgeId)){publish(board.nodes,board.edges.filter(e=>e.id!==selectedEdgeId),'선택한 연결을 삭제했어요.');setSelectedEdgeId('');setMenu(null);}};
  const addPosition=(point?:{x:number;y:number},targetDay=activeDayId)=>{
    const layout=frameLayouts.get(targetDay);if(!layout)return null;
    if(point){const dropped=resolveCanvasDrop(point,frameLayouts,targetDay);if(dropped&&frameForPoint(frameLayouts,point))return dropped;}
    const existing=doc?.nodes.filter(node=>node.dayId===targetDay).length??0;
    const local={x:44+(existing%2)*270,y:105+Math.floor(existing/2)*168};
    return {dayId:targetDay,position:canvasDocumentPosition(local,layout)};
  };
  const addPlace=(place:CanvasPlaceDetail,position?:{x:number;y:number},targetDay=activeDayId)=>{if(!doc)return;const placed=addPosition(position,targetDay);if(!placed)return;const model:CanvasPlaceNode={id:crypto.randomUUID(),kind:'place',dayId:placed.dayId,position:placed.position,color:'default',contentid:place.contentid,intent:'candidate'};const updated=sync.update(current=>current.nodes.length>=500||!current.days.some(item=>item.id===placed.dayId)?current:{...current,nodes:[...current.nodes,model]});if(!updated){setMessage('날짜가 바뀌었거나 캔버스가 가득 차 장소를 추가하지 못했어요.');return;}setDetails(m=>new Map(m).set(place.contentid,place));setMessage(`${place.title}을 검토용 후보로 추가했어요.`);setSelectedId(model.id);setDayId(model.dayId);};
  const selectPlace=async(item:PlaceSearchResult)=>{
    setBusy(true);setSearchMessage('');
    try{
      const full=await getPlaceDetail(tripId,item.contentid,abort.current?.signal);
      if(replaceTargetId){
        const nodeId=replaceTargetId;
        const target=doc?.nodes.find(node=>node.id===nodeId);
        if(!target||target.kind!=='place'){setSearchMessage('바꿀 장소가 이미 일정에서 사라졌어요.');setReplaceTargetId('');return;}
        if(target.contentid===full.contentid){setReplaceTargetId('');setSelectedId(nodeId);setSearchMessage('');return;}
        let replaced=false;
        const updated=sync.update(current=>{
          const found=current.nodes.some(node=>node.id===nodeId&&node.kind==='place'&&node.contentid===target.contentid);
          if(!found)return current;
          replaced=true;
          return {...current,nodes:current.nodes.map(node=>node.id===nodeId&&node.kind==='place'?replaceCanvasPlace(node,full.contentid):node)};
        });
        if(!updated||!replaced){setSearchMessage('장소를 바꾸지 못했어요. 최신 공유 상태를 확인해 주세요.');return;}
        setDetails(previous=>new Map(previous).set(full.contentid,full));
        setReplaceTargetId('');setSelectedId(nodeId);setTab('ai');setMessage(`${full.title}로 장소를 바꿨어요. 기존 연결은 유지돼요.`);
      }else addPlace(full);
    }catch(error){setSearchMessage(error instanceof Error?error.message:'장소 정보를 불러오지 못했어요.');}
    finally{setBusy(false);}
  };
  const retryPlaceDetail=async(contentid:number)=>{
    triedDetails.current.delete(contentid);
    try{
      const detail=await getPlaceDetail(tripId,contentid);
      setDetails(previous=>new Map(previous).set(contentid,detail));
      setMessage('장소 상세 정보를 다시 불러왔어요.');
    }catch(error){setMessage(error instanceof Error?error.message:'장소 상세 정보를 불러오지 못했어요.');}
  };
  const addComment=(position?:{x:number;y:number})=>{if(!doc||doc.nodes.length>=500||!activeDayId)return;const placed=addPosition(position);if(!placed)return;const model:CanvasCommentNode={id:crypto.randomUUID(),kind:'comment',dayId:placed.dayId,position:placed.position,color:'default',text:'댓글을 입력해 주세요'};const newNode:FlowNode={id:model.id,type:'comment',parentId:`day-frame:${model.dayId}`,position:canvasFrameNodePosition(model,frameLayouts.get(model.dayId)!),data:{model}};publish([...allFrameNodes.filter(node=>node.type!=='dayFrame'),newNode],board.edges,'공유 댓글 카드를 추가했어요.');setSelectedId(model.id);setDayId(model.dayId);};
  const copy=()=>{
    if(!selectedModel)return;
    clipboard.current=canvasClipboardCopy(selectedModel);
    setHasClipboard(true);setMessage('카드를 복사했어요.');setMenu(null);
  };
  const paste=()=>{const source=clipboard.current;if(!source||!doc||doc.nodes.length>=500)return;const placed=addPosition(undefined,activeDayId);if(!placed)return;const model=copyCanvasNode(source,crypto.randomUUID(),placed.dayId);model.position=placed.position;const layout=frameLayouts.get(model.dayId)!;publish([...allFrameNodes.filter(node=>node.type!=='dayFrame'),{id:model.id,type:model.kind,parentId:`day-frame:${model.dayId}`,position:canvasFrameNodePosition(model,layout),data:{model,...(model.kind==='place'?{title:placeDetails.get(model.contentid)?.title,detail:placeDetails.get(model.contentid)}:{})}}],board.edges,'복사한 카드를 추가했어요. 연결선은 복사하지 않았어요.');setMenu(null);};
  const undo=()=>sync.undo();
  const redo=()=>sync.redo();
  const runSearch=async()=>{abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setSearchMessage('');setResults([]);try{const found=await searchPlaces(tripId,query,controller.signal);if(controller.signal.aborted)return;setResults(found);setSearchMessage(found.length?'':`“${query.trim()}” 검색 결과가 없어요.`);}catch(error){if(!controller.signal.aborted)setSearchMessage(error instanceof Error?error.message:'장소 검색에 실패했어요.');}finally{if(abort.current===controller){abort.current=null;setBusy(false);}}};
  const askAI=async()=>{if(busy||!prompt.trim()||!activeDayId||!doc)return;const exclude=doc.nodes.filter((n):n is CanvasPlaceNode=>n.kind==='place').map(n=>n.contentid);const hadPending=Boolean(pendingRecommendation.current);pendingRecommendation.current=retainRecommendationRequest(pendingRecommendation.current,prompt.trim(),activeDayId,exclude);if(!hadPending)setRecommendationPending(true);const request=pendingRecommendation.current;setBusy(true);try{const result=await recommendPlace(tripId,request.prompt,request.dayId,request.exclude,request.key);pendingRecommendation.current=null;setRecommendationPending(false);setAiPlace(result.place);setAiAlternatives(result.alternatives);setTab('ai');addPlace(result.place,undefined,request.dayId);setMessage('추천 장소 한 곳을 해당 날짜에 후보로 추가했어요.');}catch(error){setMessage(error instanceof Error?error.message:'추천 요청을 처리하지 못했어요. 같은 요청으로 다시 결과를 확인할 수 있어요.');}finally{setBusy(false);}};
  useEffect(()=>()=>abort.current?.abort(),[]);
  useEffect(()=>{discoveryMemory.set(tripId,{tab,query,results,prompt,aiPlace,aiAlternatives,pending:pendingRecommendation.current});},[tripId,tab,query,results,prompt,aiPlace,aiAlternatives,recommendationPending]);
  useEffect(()=>{if(!menu)return;const focusTimer=window.setTimeout(()=>menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),0);const outside=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as globalThis.Node))setMenu(null);};const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){setMenu(null);menuOpener.current?.focus();}};window.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);return()=>{window.clearTimeout(focusTimer);window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);};},[menu]);
  const keydown=(event:ReactKeyboardEvent<HTMLElement>)=>{if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'){event.preventDefault();copy();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v'){event.preventDefault();paste();}else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove();}else if((event.key==='F10'&&event.shiftKey)||event.key==='ContextMenu'){event.preventDefault();const target=(event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');const nodeId=target?.getAttribute('data-id')??selectedId;const rect=target?.getBoundingClientRect()??shell.current?.getBoundingClientRect();context({preventDefault:()=>event.preventDefault(),clientX:rect?rect.left+24:100,clientY:rect?rect.top+24:100},nodeId||undefined);}};
  const context=(event:{preventDefault:()=>void;clientX:number;clientY:number},nodeId?:string)=>{event.preventDefault();menuOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;if(nodeId){const target=board.nodes.find(node=>node.id===nodeId);if(!target)return;setDayId(target.data.model.dayId);setSelectedId(nodeId);setSelectedEdgeId('');}else{setSelectedId('');setSelectedEdgeId('');}setMenu({x:event.clientX,y:event.clientY,nodeId});};
  const openCardMenu=(nodeId:string,element:HTMLElement)=>{const rect=element.getBoundingClientRect();context({preventDefault:()=>{},clientX:rect.right,clientY:rect.bottom},nodeId);};
  const openToolbarMenu=(element:HTMLElement)=>{const rect=element.getBoundingClientRect();menuOpener.current=element;setMenu({x:rect.left,y:rect.bottom,nodeId:selectedId||undefined});};
  const changeDay=(nextId:string)=>{setDayId(nextId);setFitFocus('day');viewSnapshot.current={dayId:nextId,viewport:null};writeCanvasView(viewScope,viewSnapshot.current);setRestoreViewport(null);setInitialFitPending(Boolean(doc?.days.some(item=>item.id===nextId)));setFitTarget(null);setSelectedId('');setSelectedEdgeId('');setMenu(null);};
  const runCommand=(command:CanvasCommandId)=>{if(command==='undo')undo();else if(command==='redo')redo();else if(command==='add-comment')addComment();else if(command==='fit'&&overviewBounds)void flow.current?.fitBounds(overviewBounds,{padding:.14,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:180});else if(command==='toggle-drawer')setDrawerOpen(open=>!open);else if(command==='toggle-day-links')setDayLinksOn(value=>!value);else if(command==='copy')copy();else if(command==='paste')paste();else if(command==='disconnect'){if(selectedModel?.kind==='place')publish(board.nodes,board.edges.filter(e=>e.source!==selectedModel.id&&e.target!==selectedModel.id),'이 장소의 기존 연결을 끊었어요.');}else if(command==='delete')remove();};
  const syncLabel=preview?'예시 미리보기':sync.status==='saved'?'공유 초안 저장됨':sync.status==='saving'?'저장 중':sync.status==='offline'?'저장 대기':sync.status==='conflict'?'변경 확인 필요':sync.status==='error'?'저장 오류':'공유 일정 불러오는 중';

  return <section className={`tw-canvas-embedded ${preview?'is-preview':''}`} aria-label="공동 일정 캔버스" onKeyDown={keydown} tabIndex={-1}>
    <header className="tw-canvas-header">
      <div className="tw-canvas-heading"><h1>일정 캔버스</h1><span>{tripRangeLabel}</span><span className={`tw-canvas-save-state status-${preview?'preview':sync.status}`} role="status">{syncLabel}</span></div>
      <div className="tw-canvas-toolbar" role="toolbar" aria-label="캔버스 도구">
        <div className="tw-canvas-toolbar-group" role="group" aria-label="편집">
          {canvasCommands.filter(item=>['undo','redo','add-comment'].includes(item.id)).map(command=><button key={command.id} title={command.label} aria-label={command.label} disabled={command.id==='undo'?!sync.canUndo:command.id==='redo'?!sync.canRedo:false} onClick={()=>runCommand(command.id)}><CanvasToolIcon command={command.id} /><span>{command.id==='add-comment'?'댓글':''}</span></button>)}
        </div>
        <div className="tw-canvas-toolbar-group" role="group" aria-label="보기">
          {canvasCommands.filter(item=>['fit','toggle-day-links'].includes(item.id)).map(command=><button key={command.id} title={command.label} aria-label={command.label} aria-pressed={command.id==='toggle-day-links'?dayLinksOn:undefined} className={command.id==='toggle-day-links'&&dayLinksOn?'is-active':''} onClick={()=>runCommand(command.id)}><CanvasToolIcon command={command.id} /><span>{command.id==='fit'?'전체 보기':'날짜 연결'}</span></button>)}
        </div>
        <div className="tw-canvas-toolbar-group" role="group" aria-label="패널">
          <button className="tw-toolbar-menu-button" title="편집 메뉴" aria-label="편집 메뉴" aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event=>openToolbarMenu(event.currentTarget)}><CanvasToolIcon command="edit-menu" /><span>메뉴</span></button>
          <button ref={drawerTrigger} title={drawerOpen?'장소 패널 닫기':'장소 패널 열기'} aria-label={drawerOpen?'장소 패널 닫기':'장소 패널 열기'} aria-expanded={drawerOpen} onClick={()=>runCommand('toggle-drawer')}><CanvasToolIcon command="toggle-drawer" /><span>{drawerOpen?'패널 닫기':'장소 찾기'}</span></button>
        </div>
      </div>
    </header>
    {preview&&<p className="tw-preview-banner">예시 미리보기 · 이 화면의 변경은 실제 여행방과 공유되지 않아요.</p>}
    {!preview&&['offline','conflict','error'].includes(sync.status)&&<div className={`tw-sync-status status-${sync.status}`} role="alert"><span>{sync.message||'캔버스 상태를 확인해 주세요.'}</span>{sync.status==='offline'&&<Button variant="secondary" onClick={sync.retry}>다시 연결</Button>}{sync.status==='conflict'&&<><Button variant="secondary" onClick={()=>sync.resolve('local')}>내 변경 유지</Button><Button variant="secondary" onClick={()=>sync.resolve('remote')}>최신 내용 사용</Button></>}</div>}
    {handoffWarningLabels.length>0&&<aside className="tw-canvas-plan-notes" aria-label="생성 일정 참고 사항" role="status">{handoffWarningLabels.map(label=><span key={label}>{label}</span>)}</aside>}
    <div className={`tw-canvas-shell ${drawerOpen?'':'is-drawer-closed'}`}>
      <section className="tw-flow-area" aria-label="캔버스 작업 영역">
        <div className="tw-flow-canvas" ref={shell} onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();const raw=e.dataTransfer.getData('application/canvas-contentid');const id=Number(raw);const detail=placeDetails.get(id);if(detail&&flow.current)addPlace(detail,flow.current.screenToFlowPosition({x:e.clientX,y:e.clientY}));}}>
          {doc&&<FocusCanvasDay.Provider value={focusDay}><OpenCanvasMenu.Provider value={openCardMenu}><ReactFlow<FlowNode>
            nodes={flowNodes?.base===doc?flowNodes.nodes:allFrameNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={instance=>{flow.current=instance;}}
            onNodesChange={changes=>{
              const current=flowNodes?.base===doc?flowNodes.nodes:allFrameNodes;
              const next=applyNodeChanges(changes,current);
              if(changes.some(change=>change.type==='dimensions')) {
                const measured=changes.flatMap(change=>change.type==='dimensions'&&change.dimensions?[{id:change.id,...change.dimensions}]:[]);
                if(measured.length)setMeasuredSizes(previous=>{
                  const updated=new Map(previous);
                  let changed=false;
                  for(const item of measured){const before=updated.get(item.id);if(before?.width!==item.width||before?.height!==item.height){updated.set(item.id,{width:item.width,height:item.height});changed=true;}}
                  return changed?updated:previous;
                });
              }
              if(changes.some(change=>change.type==='position'))setFlowNodes({base:doc,nodes:next});
            }}
            onEdgesChange={changes=>{const removed=new Set(changes.filter(change=>change.type==='remove').map(change=>change.id));if(removed.size)publish(board.nodes,board.edges.filter(edge=>!removed.has(edge.id)),'연결을 제거했어요.');}}
            onConnect={connect}
            isValidConnection={connection=>!!connection.source&&!!connection.target&&canConnectRoute(connection.source,connection.target,placeMap,doc.edges)}
            onNodeClick={(_,node)=>{if(node.type==='dayFrame')return;setSelectedId(node.id);setReplaceTargetId('');setDayId(node.data.model.dayId);setSelectedEdgeId('');setDrawerOpen(true);}}
            onEdgeClick={(_,edge)=>{const targetDayId=(edge as FlowEdge).data?.targetDayId;if(edge.type==='dayOrder'&&targetDayId){focusDay(targetDayId);return;}setSelectedEdgeId(edge.id);setSelectedId('');}}
            onPaneClick={()=>{setMenu(null);setSelectedId('');setSelectedEdgeId('');}}
            onPaneContextMenu={event=>context(event)}
            onNodeContextMenu={(event,node)=>{if(node.type==='dayFrame'){event.preventDefault();return;}event.stopPropagation();context(event,node.id);}}
            onEdgeContextMenu={(event,edge)=>{if(edge.type==='dayOrder'){event.preventDefault();const targetDayId=(edge as FlowEdge).data?.targetDayId;if(targetDayId)focusDay(targetDayId);return;}event.stopPropagation();context(event);setSelectedEdgeId(edge.id);}}
            onNodeDragStop={(_,node)=>{if(node.type==='dayFrame')return;const previous=frameLayouts.get(node.data.model.dayId);if(!previous)return;const world={x:node.position.x+previous.position.x,y:node.position.y+previous.position.y};const dropped=resolveCanvasDrop(world,frameLayouts,previous.dayId);if(!dropped)return;const model={...node.data.model,...dropped};const edges=node.data.model.kind==='place'&&dropped.dayId!==node.data.model.dayId?board.edges.filter(edge=>edge.source!==node.id&&edge.target!==node.id):board.edges;const nodes=board.nodes.map(item=>item.id===node.id?{...item,data:{...item.data,model}}:item);setFlowNodes(null);publish(nodes,edges,dropped.dayId!==node.data.model.dayId?'날짜를 옮기고 기존 연결을 함께 제거했어요.':'카드 배치를 저장하고 있어요.');if(dropped.dayId!==node.data.model.dayId)setDayId(dropped.dayId);}}
            onMoveEnd={(_,viewport)=>{viewSnapshot.current={dayId:activeDayId,viewport};writeCanvasView(viewScope,viewSnapshot.current);}}
            minZoom={.01} maxZoom={2} deleteKeyCode={null} defaultEdgeOptions={edgeStyle} selectionOnDrag={false}>
            {restoreViewport && <RestoreCanvasViewport viewport={restoreViewport} onRestored={completeRestore}/>}
            {cardsMeasured && fitTarget && overviewBounds && <FitDayFrames key={fitTarget.key} bounds={overviewBounds} onFitted={completeFit}/>}
            {cardsMeasured && initialFitPending && !fitTarget && !restoreViewport && initialBounds && <FitDayFrames bounds={initialBounds} onFitted={completeInitialFit}/>}
            <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="var(--tw-grid)"/><Controls showInteractive={false}/>
          </ReactFlow></OpenCanvasMenu.Provider></FocusCanvasDay.Provider>}
          {!doc&&<div className="tw-canvas-loading">{sync.status==='error'?'공유 캔버스를 불러오지 못했어요.': '공유 캔버스를 불러오고 있어요.'}<Button variant="secondary" onClick={sync.retry}>다시 불러오기</Button></div>}
          {doc&&doc.nodes.length===0&&<div className="tw-empty-canvas"><strong>아직 일정이 비어 있어요</strong><p>날짜별 영역에 장소를 검색하거나 추천을 받아 첫 카드를 추가해 보세요.</p><Button variant="secondary" onClick={()=>setDrawerOpen(true)}>장소 찾기</Button></div>}
          {menu&&createPortal(<div ref={menuRef} className="tw-context-menu" role="menu" aria-label="캔버스 편집 메뉴" style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-230)),top:Math.max(8,Math.min(menu.y,window.innerHeight-330)),maxHeight:Math.max(96,window.innerHeight-Math.max(8,Math.min(menu.y,window.innerHeight-330))-8)}} onKeyDown={e=>{if(e.key==='Escape'){setMenu(null);menuOpener.current?.focus();return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const items=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const i=items.indexOf(document.activeElement as HTMLButtonElement);items[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}}}>
            {canvasCommands.filter(command=>command.surface==='context'||command.surface==='both').map(command=><button key={command.id} role="menuitem" disabled={command.id==='undo'?!sync.canUndo:command.id==='redo'?!sync.canRedo:command.id==='delete'?!menu.nodeId&&!selectedEdgeId:command.id==='paste'?!hasClipboard:command.id==='disconnect'?selectedModel?.kind!=='place':command.id==='copy'?!menu.nodeId:false} onClick={()=>{runCommand(command.id);setMenu(null);}}>{command.label}</button>)}<label className="tw-context-day">날짜 이동<select className="text-input" value={menu.nodeId?board.nodes.find(n=>n.id===menu.nodeId)?.data.model.dayId??activeDayId:activeDayId} disabled={!menu.nodeId} onChange={e=>{if(menu.nodeId)moveNode(menu.nodeId,e.target.value);setMenu(null);}}>{doc?.days.map((item,index)=><option key={item.id} value={item.id}>{item.date??`${index+1}일차`}</option>)}</select></label><button role="menuitem" disabled={!menu.nodeId} onClick={()=>{setDrawerOpen(true);setMenu(null);}}>선택 정보</button><button role="menuitem" disabled={selectedModel?.kind!=='comment'} onClick={()=>{setDrawerOpen(true);setMenu(null);}}>댓글 편집</button><div className="tw-context-colors" aria-label="카드 색상">{colorOptions.map(([value,label])=><button key={value} disabled={!menu.nodeId} aria-label={`${label} 색상`} title={`${label} 색상`} onClick={()=>{if(menu.nodeId)editNode(menu.nodeId,m=>({...m,color:value}));setMenu(null);}}>●</button>)}</div><button role="menuitem" onClick={()=>setMenu(null)}>닫기</button>
          </div>,document.body)}
        </div><div className="tw-canvas-summary"><strong>전체 일정</strong><span>{doc?.days.length??0}일</span><span>장소 {totalPlaces}</span><span>댓글 {totalComments}</span><span>장소 연결 {totalConnections}</span>{!preview&&routes.routeCount>0&&<span>이동 시간 {routes.routeCount}건</span>}{!preview&&routes.hasIssue&&<><span role="status">일부 이동 시간을 확인하지 못했어요.</span><button type="button" onClick={routes.retry}>다시 확인</button></>}</div>{message && <p className="tw-canvas-help" role="status">{message}</p>}
      </section>
      {drawerOpen&&<aside className="tw-place-drawer" aria-label="장소 및 카드 편집 패널" onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); closeDrawer(); } }}>
        <div className="tw-drawer-heading"><h2>{selectedModel?.kind==='place'?'장소 정보':selectedModel?.kind==='comment'?'공유 댓글':replaceTargetId?'장소 바꾸기':'장소 찾기'}</h2><button type="button" onClick={closeDrawer} aria-label="장소 패널 닫기"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></div>
        {selectedModel?.kind==='place'&&<PlaceInspector node={selectedModel} detail={placeDetails.get(selectedModel.contentid)} places={placeDetails} days={doc?.days??[]} nodes={board.nodes.map(n=>n.data.model)} edges={doc?.edges??[]} onRetryDetail={()=>void retryPlaceDetail(selectedModel.contentid)} onBack={()=>{setSelectedId('');setReplaceTargetId('');setTab('ai');}} onReplace={()=>{setReplaceTargetId(selectedModel.id);setSelectedId('');setTab('search');setSearchMessage('');setDrawerOpen(true);}} onColor={color=>editNode(selectedModel.id,m=>({...m,color}))} onMove={next=>moveNode(selectedModel.id,next)} onConnect={target=>connect({source:selectedModel.id,target})} onDisconnect={()=>publish(board.nodes,board.edges.filter(e=>e.source!==selectedModel.id&&e.target!==selectedModel.id),'이 장소의 연결을 끊었어요.')}/>}
        {selectedModel?.kind==='comment'&&<section className="tw-inspector"><div className="tw-inspector-actions"><Button variant="secondary" onClick={()=>{setSelectedId('');setTab('ai');}}>장소 찾기로 돌아가기</Button></div><CanvasCommentEditor key={selectedModel.id} tripId={tripId} node={selectedModel} onCommit={(text,expectedText,force)=>sync.update(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedModel.id&&node.kind==='comment'&&(force||node.text===expectedText)?{...node,text}:node)}))}/><label htmlFor="tw-comment-day">여행 날짜</label><select id="tw-comment-day" className="text-input" value={selectedModel.dayId} onChange={e=>moveNode(selectedModel.id,e.target.value)}>{doc?.days.map((item,index)=><option key={item.id} value={item.id}>{item.date??`${index+1}일차`}</option>)}</select><ColorPicker value={selectedModel.color} onChange={color=>editNode(selectedModel.id,m=>({...m,color}))}/><Button variant="secondary" onClick={remove}>댓글 삭제</Button></section>}
        {!selectedModel&&<div className="tw-discovery">
          {replaceTargetId&&<p className="tw-replace-target-note" role="status">선택한 장소를 직접 검색 결과로 바꿉니다. 기존 연결은 유지돼요.</p>}
          <div className="tw-discovery-tabs" role="tablist" aria-label="장소 찾기 방식"><button type="button" role="tab" aria-selected={tab==='ai'} onClick={()=>setTab('ai')}>AI 추천</button><button type="button" role="tab" aria-selected={tab==='search'} onClick={()=>setTab('search')}>직접 검색</button></div>
          {tab==='ai'?<>
            <div className="tw-discovery-form"><label htmlFor="tw-place-prompt">{(doc?.days.findIndex(day => day.id === activeDayId) ?? -1) + 1 || 1}일차에 어떤 장소를 추가할까요?</label><textarea id="tw-place-prompt" value={prompt} maxLength={1000} onChange={event=>setPrompt(event.target.value)} placeholder="예: 아이와 쉬어갈 자연 명소"/><Button disabled={busy||!prompt.trim()||!activeDayId} onClick={()=>void askAI()}>{busy?'추천 받는 중…':recommendationPending?'같은 요청으로 다시 확인':'추천 받기'}</Button>{recommendationPending&&!busy&&<Button variant="secondary" onClick={()=>{pendingRecommendation.current=null;setRecommendationPending(false);setMessage('요청을 고친 뒤 새 추천을 받을 수 있어요.');}}>새 요청 작성</Button>}</div>
            {aiPlace&&<article className="tw-search-result is-recommended"><small>추천 장소 · 일정에 후보로 추가됨</small><strong>{aiPlace.title}</strong>{(aiPlace.address||aiPlace.category)&&<small>{[aiPlace.address,aiPlace.category].filter(Boolean).join(' · ')}</small>}</article>}
            {aiAlternatives.length>0&&<section className="tw-search"><h3>다른 후보</h3>{aiAlternatives.map(place=><article className="tw-search-result" key={place.contentid}><strong>{place.title}</strong>{(place.address||place.category)&&<small>{[place.address,place.category].filter(Boolean).join(' · ')}</small>}<div className="tw-discovery-result-actions"><Button variant="secondary" disabled={busy} onClick={()=>addPlace(place)}>후보로 추가</Button></div></article>)}</section>}
          </>:<div className="tw-search">
            <label htmlFor="tw-place-search">장소 이름</label><div className="tw-discovery-form"><input id="tw-place-search" className="text-input" value={query} maxLength={100} onChange={event=>{if(abort.current){abort.current.abort();abort.current=null;setBusy(false);}setQuery(event.target.value);setResults([]);setSearchMessage('');}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void runSearch();}}} placeholder="장소 이름이나 주소"/><Button variant="secondary" disabled={busy||!query.trim()} onClick={()=>void runSearch()}>{busy?'검색 중…':'검색'}</Button></div>
            {searchMessage&&<p className={results.length?'tw-panel-error':'tw-panel-empty'} role="status">{searchMessage}</p>}
            {searchMessage&&!results.length&&query.trim()&&<Button className="tw-panel-retry" variant="secondary" disabled={busy} onClick={()=>void runSearch()}>다시 검색</Button>}
            {results.map(item=><article className="tw-search-result" key={item.contentid}><strong>{item.title}</strong>{(item.address||item.category)&&<small>{[item.address,item.category].filter(Boolean).join(' · ')}</small>}<div className="tw-discovery-result-actions"><Button variant="secondary" disabled={busy} onClick={()=>void selectPlace(item)}>{replaceTargetId?'장소 바꾸기':'일정에 추가'}</Button></div></article>)}
          </div>}
        </div>}
      </aside>}
    </div>
  </section>;
}

function ColorPicker({value,onChange}:{value:CanvasColor;onChange:(color:CanvasColor)=>void}){return <fieldset className="tw-color-picker"><legend>카드 색상</legend>{colorOptions.map(([color,label])=><button type="button" key={color} className={`color-${color} ${value===color?'is-selected':''}`} aria-pressed={value===color} onClick={()=>onChange(color)}>{label}</button>)}</fieldset>;}
function PlaceInspector({node,detail,places,days,nodes,edges,onColor,onMove,onConnect,onDisconnect,onBack,onReplace,onRetryDetail}:{node:CanvasPlaceNode;detail?:CanvasPlaceDetail;places:Map<number,CanvasPlaceDetail>;days:CanvasDocument['days'];nodes:CanvasNode[];edges:CanvasDocument['edges'];onColor:(color:CanvasColor)=>void;onMove:(dayId:string)=>void;onConnect:(id:string)=>void;onDisconnect:()=>void;onBack:()=>void;onReplace:()=>void;onRetryDetail:()=>void}){
  const[target,setTarget]=useState('');
  const nodeDays=new Map(nodes.filter((item):item is CanvasPlaceNode=>item.kind==='place').map(item=>[item.id,item.dayId]));
  const options=nodes.filter((item):item is CanvasPlaceNode=>item.kind==='place'&&canConnectRoute(node.id,item.id,nodeDays,edges));
  const fields:Array<[string,string|null|undefined]>=[['종류',detail?.category],['설명',detail?.overviewText],['메뉴',detail?.menuText],['운영 시간',detail?.openingHoursText],['휴무일',detail?.closedDaysText],['요금',detail?.feeText],['예약',detail?.bookingText],['주차',detail?.parkingText],['전화',detail?.tel]];
  const availableFields=fields.filter(([,value])=>Boolean(value?.trim()));
  return <section className="tw-inspector">
    <div className="tw-inspector-actions"><Button variant="secondary" onClick={onBack}>장소 찾기로 돌아가기</Button><Button variant="secondary" onClick={onReplace}>장소 바꾸기</Button></div>
    <h3>{detail?.title??'장소 정보 확인 중'}</h3>
    {!detail&&<div className="tw-panel-error" role="status"><span>상세 정보를 확인하지 못했어요.</span><Button variant="secondary" onClick={onRetryDetail}>다시 불러오기</Button></div>}
    {(detail?.address||detail?.adminCity)&&<p>{[detail.address,detail.adminCity].filter(Boolean).join(' · ')}</p>}
    {availableFields.length>0&&<dl>{availableFields.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {detail?.homepageUrl&&<a href={detail.homepageUrl} target="_blank" rel="noreferrer">공식 홈페이지</a>}
    {node.schedule?.locked&&<p className="tw-inspector-note">생성한 일정에서 가져온 방문 시간이에요. 장소를 바꾸면 시간 정보가 해제돼요.</p>}
    <label htmlFor="tw-move-day">여행 날짜</label>
    <select id="tw-move-day" className="text-input" value={node.dayId} onChange={e=>onMove(e.target.value)}>{days.map((day,index)=><option key={day.id} value={day.id}>{day.date??`${index+1}일차`}</option>)}</select>
    <label htmlFor="tw-connect-target">다음 방문 장소 연결</label>
    <select id="tw-connect-target" className="text-input" value={target} onChange={e=>setTarget(e.target.value)}><option value="">장소 선택</option>{options.map(item=><option key={item.id} value={item.id}>{places.get(item.contentid)?.title??'장소 정보 확인 중'}</option>)}</select>
    <Button variant="secondary" disabled={!target} onClick={()=>{onConnect(target);setTarget('');}}>연결 추가</Button>
    <ColorPicker value={node.color} onChange={onColor}/>
    <Button variant="secondary" onClick={onDisconnect}>이 장소 연결 끊기</Button>
  </section>;
}
