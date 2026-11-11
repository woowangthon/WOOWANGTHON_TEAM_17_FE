import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { addEdge, applyNodeChanges, Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, MarkerType, Position, ReactFlow, useStore, useReactFlow, useUpdateNodeInternals, type Connection, type Edge, type EdgeProps, type Node, type NodeProps, type ReactFlowInstance, type Rect } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Button from '../../components/ui/Button';
import CanvasToolIcon from './CanvasToolIcon';
import CanvasCommentEditor from './CanvasCommentEditor';
import { getPlaceDetail, recommendPlace, searchPlaces, type PlaceSearchResult } from './canvasApi';
import { canConnectRoute, canvasClipboardCopy, connectDayFrames, copyCanvasNode, disconnectDayFrames, getDayLinks, mergeCanvasDocuments, moveDayFrame, replaceCanvasPlace, type CanvasColor, type CanvasCommentNode, type CanvasDocument, type CanvasNode, type CanvasPlaceDetail, type CanvasPlaceNode } from './canvasModel';
import { canvasCommands, type CanvasCommandId } from './canvasCommands';
import { retainRecommendationRequest, type RecommendationRequest } from './canvasRecommendation.ts';
import { useCanvasSync } from './useCanvasSync';
import { useCanvasRoutes } from './useCanvasRoutes.ts';
import type { CanvasTravelMode } from './canvasRoutes.ts';
import { canvasViewScope, consumeHandoff, firstRouteDay, hasFittedHandoff, markHandoffFitted, readCanvasView, resolveCanvasMountView, writeCanvasView, type CanvasHandoff, type CanvasViewMemory, type CanvasViewport } from './canvasHandoff.ts';
import { canvasDayTone, canvasDocumentPosition, canvasFrameNodePosition, ensureCanvasDateRange, frameForPoint, layoutCanvasDayFrames, materializeProjectedDay, dayLabel, resolveCanvasDrop, type CanvasFrameLayout } from './canvasDayFrames.ts';
import { CanvasPlaceCardContent, CanvasPlaceCandidate, CanvasPlaceMenuSummary, CanvasPlaceOverview } from './CanvasPlacePresentation';
import { CanvasEdgeEditor } from './CanvasEdgeEditor.tsx';
import { modeLabel, resolveCanvasEdgeTime } from './canvasEdgePreferences.ts';
import { useCanvasEdgePreferences } from './useCanvasEdgePreferences.ts';

type FlowNode = Node<{ model: CanvasNode; title?: string; detail?: CanvasPlaceDetail; visitLabel?: string; dayTitle?: string; isActive?:boolean; tone?: string; placeCount?: number; mealCount?: number; commentCount?: number; connectionCandidate?:boolean; connectionStart?:boolean; sourceSide?:Position; targetSide?:Position }, 'place'|'comment'|'dayFrame'>;
type Board = { nodes: FlowNode[]; edges: Edge[] };
type FlowEdge = Edge<{ worldPoints?: Array<{x:number;y:number}>; dayLinkId?:string }>;
const OpenCanvasMenu=createContext<(id:string,element:HTMLElement)=>void>(()=>{});
const SelectRouteEdge=createContext<(id:string)=>void>(()=>{});
type DiscoveryMemory={tab:'ai'|'search';query:string;results:PlaceSearchResult[];prompt:string;aiPlace:CanvasPlaceDetail|null;aiAlternatives:CanvasPlaceDetail[];pending:RecommendationRequest|null;context:{dayId:string;replaceTargetId:string}};
const discoveryMemory=new Map<string,DiscoveryMemory>();
const colorOptions: Array<[CanvasColor,string]> = [['default','기본'],['lime','연두'],['sky','하늘'],['rose','분홍'],['amber','살구']];
const marker = { type: MarkerType.ArrowClosed, color: 'var(--color-accent-hover)' };
const edgeStyle = { type: 'default' as const, markerEnd: marker, style: { stroke: 'var(--color-accent-hover)', strokeWidth: 2 } };
function sidesToward(from:{x:number;y:number},to:{x:number;y:number}):[Position,Position]{
  const dx=to.x-from.x;const dy=to.y-from.y;
  if(Math.abs(dx)>=Math.abs(dy))return dx>=0?[Position.Right,Position.Left]:[Position.Left,Position.Right];
  return dy>=0?[Position.Bottom,Position.Top]:[Position.Top,Position.Bottom];
}
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
function DayFrame({ id,data }: NodeProps<FlowNode>) {
  const updateNodeInternals=useUpdateNodeInternals();
  useEffect(()=>{updateNodeInternals(id);},[id,data.sourceSide,data.targetSide,updateNodeInternals]);
  const open=useContext(OpenCanvasMenu);
  return <section className={`tw-canvas-day-frame ${data.isActive?'is-active':''}`} data-tone={data.tone} aria-label={`${data.dayTitle} 일정 그룹`}>
    <Handle type="target" id="day-link-in" position={data.targetSide??Position.Left} isConnectable className="tw-daylink-handle" />
    <Handle type="source" id="day-link-out" position={data.sourceSide??Position.Right} isConnectable className="tw-daylink-handle" />
    <header className="tw-day-frame-grip"><strong>{data.dayTitle}</strong><span>{data.placeCount}곳{data.mealCount ? ` · 식사 ${data.mealCount}` : ''} · 댓글 {data.commentCount}</span><button type="button" className="tw-node-menu-button nodrag nopan" aria-label={`${data.dayTitle} 편집 메뉴`} onClick={event=>{event.stopPropagation();open(`day-frame:${data.model.dayId}`,event.currentTarget);}}>⋯</button></header>
  </section>;
}
function DayOrderEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected }: EdgeProps<FlowEdge>) {
  const dx=targetX-sourceX;const dy=targetY-sourceY;const distance=Math.max(1,Math.hypot(dx,dy));const insetX=(dx/distance)*10;const insetY=(dy/distance)*10;
  const [path]=getBezierPath({sourceX:sourceX+insetX,sourceY:sourceY+insetY,targetX:targetX-insetX,targetY:targetY-insetY,sourcePosition,targetPosition,curvature:.22});
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={18} style={{ stroke: selected?'var(--color-accent-hover)':'var(--canvas-muted)', strokeWidth: selected?3:2, strokeDasharray: '5 4' }} />;
}
function RouteEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, selected, label }: EdgeProps<FlowEdge>) {
  const select = useContext(SelectRouteEdge);
  const [path, x, y] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: .2 });
  const labelY = Math.hypot(targetX - sourceX, targetY - sourceY) < 100 ? y - 26 : y;
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} interactionWidth={18}
      style={{ stroke: selected ? 'var(--color-accent-hover)' : 'var(--canvas-muted)', strokeWidth: selected ? 3 : 2 }} />
    {label && <EdgeLabelRenderer>
      <button type="button" className="tw-route-edge-label nodrag nopan"
        style={{ transform: `translate(-50%, -50%) translate(${x}px, ${labelY}px)` }}
        aria-label={`이동 구간 편집: ${String(label)}`} onClick={() => select(id)}>
        {label}
      </button>
    </EdgeLabelRenderer>}
  </>;
}
function PlaceCard({ id,data, selected }: NodeProps<FlowNode>) {
  const model=data.model as CanvasPlaceNode;const open=useContext(OpenCanvasMenu);const updateNodeInternals=useUpdateNodeInternals();
  useEffect(()=>{updateNodeInternals(id);},[data.sourceSide,data.targetSide,id,updateNodeInternals]);
  return <article className={`tw-place-node ${selected?'is-selected':''} ${data.connectionCandidate?'is-link-target':''} ${data.connectionStart?'is-link-start':''} ${model.intent==='candidate'?'is-candidate':''} color-${model.color}`}>
    <button type="button" className="tw-node-menu-button nodrag nopan" aria-label={`${data.title??'장소'} 편집 메뉴`} onClick={event=>{event.stopPropagation();open(id,event.currentTarget);}}>⋯</button>
    <CanvasPlaceCardContent place={data.detail} visitLabel={data.visitLabel} candidate={model.intent==='candidate'} schedule={model.schedule}/>
    <Handle type="target" position={data.targetSide??Position.Left} className="tw-handle" aria-label="앞 장소 연결점" />
    <Handle type="source" position={data.sourceSide??Position.Right} className="tw-handle" aria-label="다음 장소 연결점" />
  </article>;
}
function CommentCard({ id,data, selected }: NodeProps<FlowNode>) { const model = data.model as CanvasCommentNode; const open=useContext(OpenCanvasMenu); return <article className={`tw-comment-node color-${model.color} ${selected?'is-selected':''}`}><button type="button" className="tw-node-menu-button nodrag nopan" aria-label="댓글 편집 메뉴" onClick={event=>{event.stopPropagation();open(id,event.currentTarget);}}>⋯</button><span>공유 댓글</span><p>{model.text}</p></article>; }
const nodeTypes = { place: PlaceCard, comment: CommentCard, dayFrame: DayFrame };
const edgeTypes = { dayOrder: DayOrderEdge, default: RouteEdge };
function plannedKst(schedule: CanvasPlaceNode['schedule']): string | undefined {
  if (!schedule || (!schedule.startAt && !schedule.endAt)) return undefined;
  const format = (value: string | null) => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value)) : null;
  const start = format(schedule.startAt); const end = format(schedule.endAt);
  return start && end ? `예상 시각 ${start}–${end} KST` : `예상 시각 ${start ?? end} KST`;
}
function boardOf(doc: CanvasDocument, details: Map<number,CanvasPlaceDetail>): Board { return { nodes: doc.nodes.map((model) => ({ id:model.id,type:model.kind,position:{...model.position},data:{model,...(model.kind==='place'?{title:details.get(model.contentid)?.title,detail:details.get(model.contentid),visitLabel:plannedKst(model.schedule)}:{})} })), edges:doc.edges.map((edge)=>({...edge,...edgeStyle})) }; }
function docOf(nodes: FlowNode[], edges: Edge[], base: CanvasDocument): CanvasDocument { return { ...base, nodes:nodes.filter(n=>n.type!=='dayFrame').map((n)=>n.data.model), edges:edges.filter(edge=>edge.type!=='dayOrder').map(({id,source,target})=>({id,source,target})) }; }


export default function CanvasPreview({ tripId, preview = false, startDate, endDate, conditionsVersion = null, transport = null, handoff }: { tripId:string; preview?:boolean; startDate?:string|null; endDate?:string|null; conditionsVersion?:number|null; transport?:CanvasTravelMode; handoff?:CanvasHandoff|null }) {
  const sync = useCanvasSync(tripId, preview); const doc = sync.document;
  const viewScope=canvasViewScope(tripId,preview); const savedView=readCanvasView(viewScope);
  const drawerTrigger = useRef<HTMLButtonElement>(null);
  const closeDrawer = () => { setDrawerOpen(false); drawerTrigger.current?.focus(); };
  const initialDiscovery=discoveryMemory.get(tripId); const [details,setDetails]=useState<Map<number,CanvasPlaceDetail>>(new Map()); const [dayId,setDayId]=useState(savedView?.dayId??''); const [addTargetDayId,setAddTargetDayId]=useState(savedView?.dayId??''); const [restoreViewport,setRestoreViewport]=useState<CanvasViewport|null>(null); const [initialFitPending,setInitialFitPending]=useState(false); const [drawerOpen,setDrawerOpen]=useState(()=>window.matchMedia('(min-width: 701px)').matches); const [tab,setTab]=useState<DiscoveryMemory['tab']>(initialDiscovery?.tab??'ai'); const [query,setQuery]=useState(initialDiscovery?.query??''); const [results,setResults]=useState<PlaceSearchResult[]>(initialDiscovery?.results??[]); const [prompt,setPrompt]=useState(initialDiscovery?.prompt??''); const [aiPlace,setAiPlace]=useState<CanvasPlaceDetail|null>(initialDiscovery?.aiPlace??null); const [aiAlternatives,setAiAlternatives]=useState<CanvasPlaceDetail[]>(initialDiscovery?.aiAlternatives??[]); const [busy,setBusy]=useState(false); const [recommendationPending,setRecommendationPending]=useState(Boolean(initialDiscovery?.pending)); const [message,setMessage]=useState(''); const [searchMessage,setSearchMessage]=useState(''); const [selectedId,setSelectedId]=useState(''); const [selectedEdgeId,setSelectedEdgeId]=useState(''); const [selectedDayLinkId,setSelectedDayLinkId]=useState(''); const [replaceTargetId,setReplaceTargetId]=useState(''); const [dayLinksOn,setDayLinksOn]=useState(true); const [placeConnectionMode,setPlaceConnectionMode]=useState(false); const [placeConnectionStartId,setPlaceConnectionStartId]=useState(''); const [reconnectEdgeId,setReconnectEdgeId]=useState(''); const [measuredSizes,setMeasuredSizes]=useState<Map<string,{width:number;height:number}>>(new Map()); const [menu,setMenu]=useState<{x:number;y:number;nodeId?:string;dayId?:string;dayLinkId?:string;edgeId?:string}|null>(null); const [menuPosition,setMenuPosition]=useState({left:8,top:8}); const [hasClipboard,setHasClipboard]=useState(false);
  const [flowNodes,setFlowNodes]=useState<{base:CanvasDocument|null;nodes:FlowNode[]}|null>(null); const [fitFocus,setFitFocus]=useState<'all'|'day'>('all'); const flow=useRef<ReactFlowInstance<FlowNode>|null>(null); const shell=useRef<HTMLDivElement>(null); const menuRef=useRef<HTMLDivElement>(null); const menuOpener=useRef<HTMLElement|null>(null); const clipboard=useRef<CanvasNode|null>(null); const abort=useRef<AbortController|null>(null); const triedDetails=useRef<Set<number>>(new Set()); const pendingRecommendation=useRef<RecommendationRequest|null>(initialDiscovery?.pending??null); const recommendationContext=useRef<{dayId:string;replaceTargetId:string}>(initialDiscovery?.context??{dayId:initialDiscovery?.pending?.dayId??savedView?.dayId??'',replaceTargetId:''}); const placeChoiceSequence=useRef(0);
  const viewInitialized=useRef(false); const viewSnapshot=useRef<CanvasViewMemory>({dayId:savedView?.dayId??'',viewport:savedView?.viewport??null});
  const [fitTarget,setFitTarget]=useState<{key:string;nodes:string[]}|null>(null);
  const currentFitKey=useRef<string|null>(null);currentFitKey.current=fitTarget?.key??null;
  const completeFit=useCallback((viewport:CanvasViewport)=>{const key=currentFitKey.current;if(key){markHandoffFitted(key);setFitTarget(current=>current?.key===key?null:current);}setInitialFitPending(false);viewSnapshot.current={...viewSnapshot.current,viewport};writeCanvasView(viewScope,viewSnapshot.current);},[viewScope]);
  const completeRestore=useCallback(()=>setRestoreViewport(null),[]);
  useEffect(()=>{ if(!doc)return;
    const mountView=resolveCanvasMountView(doc,viewScope,handoff?.tripId===tripId?handoff:null);
    if(mountView.kind==='handoff'){
      const {target,key}=mountView;consumeHandoff(viewScope,handoff!.handoffId);viewInitialized.current=true;
      setDayId(target.dayId);setAddTargetDayId(target.dayId);viewSnapshot.current={dayId:target.dayId,viewport:null};writeCanvasView(viewScope,viewSnapshot.current);
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
    viewInitialized.current=true;setDayId(targetDay);setAddTargetDayId(targetDay);viewSnapshot.current={dayId:targetDay,viewport:mountView.viewport};
    setRestoreViewport(mountView.viewport);setInitialFitPending(!mountView.viewport && Boolean(doc.days.length));
    if(targetDay)writeCanvasView(viewScope,viewSnapshot.current);
  },[dayId,doc,handoff,tripId,viewScope]);
  useEffect(()=>()=>writeCanvasView(viewScope,viewSnapshot.current),[viewScope]);
  const pendingMountView=doc?resolveCanvasMountView(doc,viewScope,handoff?.tripId===tripId?handoff:null):null;
  const pendingHandoffTarget=pendingMountView?.kind==='handoff'?pendingMountView.target:null;
  const activeDayId=pendingHandoffTarget?.dayId||(doc?.days.some(item=>item.id===dayId)?dayId:doc?firstRouteDay(doc):'');
  const discoveryDayId=doc?.days.some(item=>item.id===addTargetDayId)?addTargetDayId:activeDayId;
  const currentTargetRef=useRef({dayId:discoveryDayId,replaceTargetId});currentTargetRef.current={dayId:discoveryDayId,replaceTargetId};
  const recommendationContextMatches=recommendationContext.current.dayId===discoveryDayId&&recommendationContext.current.replaceTargetId===replaceTargetId;
  const completeInitialFit=useCallback((viewport:CanvasViewport)=>{setInitialFitPending(false);setFitFocus('all');viewSnapshot.current={...viewSnapshot.current,dayId:activeDayId,viewport};writeCanvasView(viewScope,viewSnapshot.current);},[activeDayId,viewScope]);
  const knownDates=doc?.days.flatMap(item=>item.date?[item.date]:[])??[];
  const formatTripDate=(date:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'}).format(new Date(`${date}T12:00:00Z`));
  const tripRangeLabel=knownDates.length?`${formatTripDate(knownDates[0])}${knownDates.length>1&&knownDates.at(-1)!==knownDates[0]?`–${formatTripDate(knownDates.at(-1)!)}`:''} · ${doc?.days.length??0}일`:`여행 일정 · ${doc?.days.length??0}일`;
  const draggedEdgeId = useRef<string | null>(null);
  const edgePrefs=useCanvasEdgePreferences(tripId,preview);
  const effectiveModeForEdge=(edgeId:string):CanvasTravelMode=>{
    const edge=doc?.edges.find(item=>item.id===edgeId);
    return edge&&doc?edgePrefs.get(edge,doc)?.modeOverride??transport:transport;
  };
  const routes=useCanvasRoutes(tripId,conditionsVersion,transport,doc??null,null,preview,effectiveModeForEdge);
  useEffect(()=>{if((aiPlace||aiAlternatives.length)&&!recommendationContextMatches){setAiPlace(null);setAiAlternatives([]);}},[aiAlternatives.length,aiPlace,recommendationContextMatches]);
  useEffect(()=>{
    if(!doc)return;
    const dated=ensureCanvasDateRange(doc,startDate,endDate,Boolean(sync.state?.sourcePlan));
    if(dated!==doc)sync.update(dated);
  },[doc,endDate,startDate,sync.state?.sourcePlan,sync.update]);
  const placeDetails=useMemo(()=>{const combined=new Map((sync.state?.places??[]).map(place=>[place.contentid,place]));for(const [id,place] of details)combined.set(id,place);return combined;},[sync.state,details]);
  useEffect(()=>{ if(!doc||preview) return; const missing=[...new Set(doc.nodes.filter((n):n is CanvasPlaceNode=>n.kind==='place').map(n=>n.contentid))].filter(id=>!placeDetails.has(id)&&!triedDetails.current.has(id)); if(!missing.length)return; const attemptedDetails=triedDetails.current;missing.forEach(id=>attemptedDetails.add(id)); const ctrl=new AbortController();let settled=false; void Promise.all(missing.map(id=>getPlaceDetail(tripId,id,ctrl.signal).then(p=>[id,p] as const).catch(()=>null))).then(items=>{settled=true;if(ctrl.signal.aborted)return;const successful=items.filter((item):item is readonly [number,CanvasPlaceDetail]=>item!==null);if(successful.length)setDetails(old=>{const next=new Map(old);for(const [id,place] of successful)next.set(id,place);return next;});}); return ()=>{ctrl.abort();if(!settled)for(const id of missing)attemptedDetails.delete(id);}; },[doc,placeDetails,preview,tripId]);
  const board=useMemo(()=>doc?boardOf(doc,placeDetails):{nodes:[],edges:[]},[doc,placeDetails]);
  const frameLayouts=useMemo(()=>doc?layoutCanvasDayFrames(doc,measuredSizes):new Map<string,CanvasFrameLayout>(),[doc,measuredSizes]);
  const dayLinks=useMemo(()=>doc?getDayLinks(doc):[],[doc]);
  const placeMap=useMemo(()=>new Map(board.nodes.filter(n=>n.data.model.kind==='place').map(n=>[n.id,n.data.model.dayId])),[board.nodes]);
  const allFrameNodes=useMemo(()=>{
    if(!doc)return [];
    const placeWorldPositions=new Map<string,{x:number;y:number}>();
    for(const node of board.nodes){
      const layout=frameLayouts.get(node.data.model.dayId);
      if(!layout)continue;
      const local=canvasFrameNodePosition(node.data.model,layout);
      const size=measuredSizes.get(node.id)??{width:250,height:180};
      placeWorldPositions.set(node.id,{x:layout.position.x+local.x+size.width/2,y:layout.position.y+local.y+size.height/2});
    }
    const placeSides=new Map<string,{sourceSide?:Position;targetSide?:Position}>();
    for(const edge of doc.edges){
      const source=placeWorldPositions.get(edge.source);const target=placeWorldPositions.get(edge.target);
      if(!source||!target)continue;
      const [sourceSide,targetSide]=sidesToward(source,target);
      placeSides.set(edge.source,{...placeSides.get(edge.source),sourceSide});
      placeSides.set(edge.target,{...placeSides.get(edge.target),targetSide});
    }
    const frameSides=new Map<string,{sourceSide?:Position;targetSide?:Position}>();
    for(const link of dayLinks){
      const source=frameLayouts.get(link.source);const target=frameLayouts.get(link.target);
      if(!source||!target)continue;
      const [sourceSide,targetSide]=sidesToward({x:source.position.x+source.width/2,y:source.position.y+source.height/2},{x:target.position.x+target.width/2,y:target.position.y+target.height/2});
      frameSides.set(link.source,{...frameSides.get(link.source),sourceSide});
      frameSides.set(link.target,{...frameSides.get(link.target),targetSide});
    }
    const frames:FlowNode[]=doc.days.map((item,index)=>{
      const layout=frameLayouts.get(item.id)!;
      const groupNodes=doc.nodes.filter(node=>node.dayId===item.id);
      const id=`day-frame:${item.id}`;
      return {id,type:'dayFrame',position:layout.position,draggable:true,dragHandle:'.tw-day-frame-grip',selectable:false,connectable:true,zIndex:-1,measured:measuredSizes.get(id),style:{width:layout.width,height:layout.height},data:{model:{id:item.id,kind:'comment',dayId:item.id,position:{x:0,y:0},color:'default',text:''},dayTitle:dayLabel(item,index),tone:canvasDayTone(item.id),isActive:item.id===activeDayId,placeCount:groupNodes.filter(node=>node.kind==='place').length,mealCount:groupNodes.filter((node):node is CanvasPlaceNode=>node.kind==='place'&&placeDetails.get(node.contentid)?.planningRole==='meal_stop').length,commentCount:groupNodes.filter(node=>node.kind==='comment').length,...frameSides.get(item.id)}} as FlowNode;
    });
    const children=board.nodes.map(node=>{
      const layout=frameLayouts.get(node.data.model.dayId)!;
      const placeNode=node.data.model.kind==='place';
      const availableEdges=doc.edges.filter(edge=>!placeConnectionMode||edge.id!==reconnectEdgeId);
      const connectionCandidate=Boolean(placeConnectionMode&&placeNode&&(placeConnectionStartId?canConnectRoute(placeConnectionStartId,node.id,placeMap,availableEdges):!availableEdges.some(edge=>edge.source===node.id)));
      return {...node,parentId:`day-frame:${layout.dayId}`,position:canvasFrameNodePosition(node.data.model,layout),selected:node.id===selectedId,zIndex:1,...(measuredSizes.has(node.id)?{measured:measuredSizes.get(node.id)}:{}),data:{...node.data,...placeSides.get(node.id),connectionCandidate,connectionStart:node.id===placeConnectionStartId}};
    });
    return [...frames,...children];
  },[activeDayId,board.nodes,dayLinks,doc,frameLayouts,measuredSizes,placeDetails,placeMap,selectedId,placeConnectionMode,placeConnectionStartId,reconnectEdgeId]);
  const overviewBounds = frameBounds([...frameLayouts.values()]);
  const activeFrame = frameLayouts.get(activeDayId);
  const initialBounds = fitFocus === 'day' && activeFrame ? frameBounds([activeFrame]) : overviewBounds;
  const cardsMeasured = doc?.nodes.every(node => measuredSizes.has(node.id));
  const visibleRouteLabel=(edge:CanvasDocument['edges'][number])=>{
    if(!doc)return '시간 미확인';
    const preference=edgePrefs.get(edge,doc);
    const resolution=resolveCanvasEdgeTime(preference,transport);
    if(resolution.source==='manual')return `${modeLabel(resolution.mode)} ${resolution.minutes}분 · 직접 입력`;
    const routeLabel=preview?'시간 미확인':routes.labels.get(edge.id)??'시간 미확인';
    if(routeLabel!=='시간 미확인')return routeLabel;
    return resolution.source==='required'?'시간 입력 필요':'시간 미확인';
  };
  const visibleEdges:FlowEdge[]=[
    ...board.edges.map(e=>({...e,...edgeStyle,selected:e.id===selectedEdgeId,label:visibleRouteLabel(e)})),
    ...(dayLinksOn?dayLinks.flatMap(link=>{
      const source=frameLayouts.get(link.source); const target=frameLayouts.get(link.target);
      if(!source||!target)return [];
      return [{id:`day-link:${link.id}`,source:`day-frame:${link.source}`,sourceHandle:'day-link-out',target:`day-frame:${link.target}`,targetHandle:'day-link-in',type:'dayOrder',reconnectable:false,selectable:true,deletable:false,focusable:true,selected:link.id===selectedDayLinkId,markerEnd:{...marker,color:'var(--canvas-muted)'},data:{dayLinkId:link.id}}];
    }):[]),
  ];
  const selected=board.nodes.find(n=>n.id===selectedId); const selectedModel=selected?.data.model;
  const selectedRouteEdge=doc?.edges.find(edge=>edge.id===selectedEdgeId);
  const selectedEdgePreference=selectedRouteEdge&&doc?edgePrefs.get(selectedRouteEdge,doc):null;
  const selectedEdgeSource=selectedRouteEdge?board.nodes.find(node=>node.id===selectedRouteEdge.source)?.data.model:null;
  const selectedEdgeTarget=selectedRouteEdge?board.nodes.find(node=>node.id===selectedRouteEdge.target)?.data.model:null;
  const selectedEdgeName=(model:CanvasNode|null|undefined)=>model?.kind==='place'?placeDetails.get(model.contentid)?.title??'장소 정보 확인 중':'장소';
  const selectedEdgeKey=selectedRouteEdge?`${selectedRouteEdge.id}:${selectedEdgeSource?.kind==='place'?selectedEdgeSource.contentid:''}:${selectedEdgeTarget?.kind==='place'?selectedEdgeTarget.contentid:''}`:'no-edge';
  const replaceNode=doc?.nodes.find((node):node is CanvasPlaceNode=>node.kind==='place'&&node.id===replaceTargetId);
  const replaceName=replaceNode?placeDetails.get(replaceNode.contentid)?.title??'장소 정보 확인 중':'';
  const contextNode=menu?.nodeId?doc?.nodes.find(node=>node.id===menu.nodeId):undefined;
  const contextPlace=contextNode?.kind==='place'?placeDetails.get(contextNode.contentid):undefined;
  const contextNodeEdges=contextNode?doc?.edges.filter(edge=>edge.source===contextNode.id||edge.target===contextNode.id)??[]:[];
  const contextRouteEdge=menu?.edgeId?doc?.edges.find(edge=>edge.id===menu.edgeId):undefined;
  const publish=(nextNodes:FlowNode[],nextEdges:Edge[],note:string):boolean=>{if(!doc)return false;const materialized=doc.days.reduce((current,day)=>materializeProjectedDay(current,day.id,measuredSizes),doc);const normalizedNodes=nextNodes.filter(node=>node.type!=='dayFrame').map(node=>{const original=doc.nodes.find(item=>item.id===node.id);const normalized=materialized.nodes.find(item=>item.id===node.id);const unchangedPosition=original&&node.data.model.dayId===original.dayId&&JSON.stringify(node.data.model.position)===JSON.stringify(original.position);return unchangedPosition&&normalized?{...node,data:{...node.data,model:{...node.data.model,position:normalized.position}}}:node;});const proposed=docOf(normalizedNodes,nextEdges,materialized);let conflictPaths:string[]=[];const updated=sync.update(current=>{const merged=mergeCanvasDocuments(doc,proposed,current);conflictPaths=merged.conflicts;return merged.document??current;});if(!updated&&conflictPaths.length){setMessage(`다른 참여자의 변경과 겹쳐 이 편집을 보류했어요: ${conflictPaths.slice(0,3).join(', ')}`);return false;}if(updated)setMessage(note);return updated;};
  const editNode=(id:string,update:(model:CanvasNode)=>CanvasNode,note='변경 사항을 저장하고 있어요.')=>{const nodes=board.nodes.map(n=>n.id===id?{...n,data:{...n.data,model:update(n.data.model)}}:n);publish(nodes,board.edges,note);};
  const moveNode=(nodeId:string,nextDay:string)=>{if(!doc)return;const model=board.nodes.find(n=>n.id===nodeId)?.data.model;if(!model||model.dayId===nextDay)return;const from=frameLayouts.get(model.dayId);const to=frameLayouts.get(nextDay);if(!to)return;const local=from?canvasFrameNodePosition(model,from):model.position;const position=canvasDocumentPosition(local,to);const edges=model.kind==='place'?board.edges.filter(e=>e.source!==nodeId&&e.target!==nodeId):board.edges;const nodes=board.nodes.map(n=>n.id===nodeId?{...n,data:{...n.data,model:{...model,dayId:nextDay,position}}}:n);publish(nodes,edges,model.kind==='place'?'날짜를 옮기고 기존 연결을 함께 제거했어요.':'댓글 날짜를 옮겼어요.');changeDay(nextDay);};
  const connect=(connection:Pick<Connection,'source'|'target'>):boolean=>{
    if(!connection.source||!connection.target||!doc)return false;
    const sourceDay=connection.source.startsWith('day-frame:')?connection.source.slice('day-frame:'.length):'';
    const targetDay=connection.target.startsWith('day-frame:')?connection.target.slice('day-frame:'.length):'';
    if(sourceDay||targetDay){
      if(!sourceDay||!targetDay||sourceDay===targetDay){setMessage('서로 다른 날짜 그룹끼리만 연결할 수 있어요.');return false;}
      let changed=false;
      const updated=sync.update(current=>{const next=connectDayFrames(current,sourceDay,targetDay);if(!next)return current;changed=JSON.stringify(getDayLinks(next))!==JSON.stringify(getDayLinks(current));return next;});
      if(updated&&changed){setMessage('날짜 그룹을 연결했어요. 장소 동선과는 별도로 저장돼요.');setSelectedDayLinkId('');return true;}
      setMessage('이 날짜 연결을 추가하지 못했어요.');return false;
    }
    const activeReconnectEdgeId=placeConnectionMode?reconnectEdgeId:'';
    const remainingEdges=doc.edges.filter(edge=>edge.id!==activeReconnectEdgeId);
    if(!canConnectRoute(connection.source,connection.target,placeMap,remainingEdges)){setMessage('같은 날짜의 장소끼리 앞뒤 한 곳씩 연결할 수 있어요. 순환 연결은 만들 수 없어요.');return false;}
    const nodes=board.nodes.map(node=>node.id===connection.source||node.id===connection.target?{...node,data:{...node.data,model:node.data.model.kind==='place'?{...node.data.model,intent:'route' as const}:node.data.model}}:node);
    const nextEdges=activeReconnectEdgeId&&doc.edges.some(edge=>edge.id===activeReconnectEdgeId)?board.edges.map(edge=>edge.id===activeReconnectEdgeId?{...edge,source:connection.source!,target:connection.target!}:edge):addEdge({...connection,id:crypto.randomUUID(),...edgeStyle},board.edges);
    const saved=publish(nodes,nextEdges,activeReconnectEdgeId?'장소 연결을 바꿨어요.':'장소를 연결했어요. 다른 카드는 자동으로 연결하지 않아요.');
    if(saved&&activeReconnectEdgeId)setReconnectEdgeId('');
    return saved;
  };
  const reconnectRouteEdge=(edge:Edge,connection:Pick<Connection,'source'|'target'>)=>{
    if(!doc||!connection.source||!connection.target||edge.type==='dayOrder'){setMessage('장소 연결만 바꿀 수 있어요.');return;}
    const remaining=doc.edges.filter(item=>item.id!==edge.id);
    if(!canConnectRoute(connection.source,connection.target,placeMap,remaining)){setMessage('같은 날짜의 앞뒤 장소 순서에 맞지 않아 연결을 바꾸지 않았어요. 기존 연결은 그대로예요.');return;}
    publish(board.nodes,board.edges.map(item=>item.id===edge.id?{...item,source:connection.source!,target:connection.target!}:item),'장소 연결을 바꿨어요.');
  };
  const remove=()=>{if(!doc)return;const dayLinkId=menu?.dayLinkId??selectedDayLinkId;if(dayLinkId){let removed=false;sync.update(current=>{const next=disconnectDayFrames(current,dayLinkId);if(!next)return current;removed=true;return next;});if(removed)setMessage('날짜 연결을 삭제했어요. 장소 동선은 그대로 유지돼요.');setSelectedDayLinkId('');setMenu(null);return;}const nodeId=board.nodes.find(node=>node.id===(menu?.nodeId??selectedId))?.id;if(nodeId){const ids=new Set([nodeId]);publish(board.nodes.filter(n=>!ids.has(n.id)),board.edges.filter(e=>!ids.has(e.source)&&!ids.has(e.target)),'선택한 카드를 삭제하고 연결선을 함께 제거했어요.');setSelectedId('');setMenu(null);return;}const edgeId=menu?.edgeId??selectedEdgeId;if(edgeId&&board.edges.some(e=>e.id===edgeId)){publish(board.nodes,board.edges.filter(e=>e.id!==edgeId),'장소 연결을 삭제했어요.');setSelectedEdgeId('');setMenu(null);}};
  const addPosition=(point?:{x:number;y:number},targetDay=activeDayId)=>{
    const layout=frameLayouts.get(targetDay);if(!layout)return null;
    if(point){const dropped=resolveCanvasDrop(point,frameLayouts,targetDay);if(dropped&&frameForPoint(frameLayouts,point))return dropped;}
    const existing=doc?.nodes.filter(node=>node.dayId===targetDay).length??0;
    if(layout.projectedNodePositions){const displayed=doc?.nodes.filter(node=>node.dayId===targetDay).map(node=>{const position=layout.projectedNodePositions?.get(node.id);const size=measuredSizes.get(node.id);return position?position.y+(size?.height??220):0;})??[];const local={x:22,y:Math.max(94,...displayed)+28};return {dayId:targetDay,position:canvasDocumentPosition(local,layout)};}
    const local={x:44+(existing%2)*270,y:105+Math.floor(existing/2)*168};
    return {dayId:targetDay,position:canvasDocumentPosition(local,layout)};
  };
  function selectCard(id: string) {
    setSelectedId(id);
    setSelectedEdgeId('');
    setSelectedDayLinkId('');
    setReplaceTargetId('');
    setMenu(null);
  }
  const addPlace=(place:CanvasPlaceDetail,position?:{x:number;y:number},targetDay=activeDayId)=>{if(!doc)return;const placed=addPosition(position,targetDay);if(!placed)return;const model:CanvasPlaceNode={id:crypto.randomUUID(),kind:'place',dayId:placed.dayId,position:placed.position,color:'default',contentid:place.contentid,intent:'candidate'};const updated=sync.update(current=>{if(current.nodes.length>=500||!current.days.some(item=>item.id===placed.dayId))return current;const normalized=materializeProjectedDay(current,placed.dayId,measuredSizes);return {...normalized,nodes:[...normalized.nodes,model]};});if(!updated){setMessage('날짜가 바뀌었거나 캔버스가 가득 차 장소를 추가하지 못했어요.');return;}setDetails(m=>new Map(m).set(place.contentid,place));setMessage(`${place.title}을 검토용 후보로 추가했어요.`);selectCard(model.id);setDayId(model.dayId);setAddTargetDayId(model.dayId);};
  const choosePlace=async(contentid:number,targetDay:string,targetNodeId:string)=>{
    if(targetDay!==discoveryDayId||targetNodeId!==replaceTargetId){setSearchMessage('날짜나 교체 대상이 바뀌었어요. 현재 선택에 맞는 후보를 다시 확인해 주세요.');return;}
    const sequence=++placeChoiceSequence.current;
    const controller=new AbortController();abort.current?.abort();abort.current=controller;
    setBusy(true);setSearchMessage('');
    try{
      const full=await getPlaceDetail(tripId,contentid,controller.signal);
      if(controller.signal.aborted||sequence!==placeChoiceSequence.current)return;
      if(currentTargetRef.current.dayId!==targetDay||currentTargetRef.current.replaceTargetId!==targetNodeId){setSearchMessage('날짜나 교체 대상이 바뀌어 선택을 취소했어요.');return;}
      if(targetNodeId){
        let replaced=false;let vanished=false;
        const updated=sync.update(current=>{
          const target=current.nodes.find(node=>node.id===targetNodeId);
          if(!target||target.kind!=='place'){vanished=true;return current;}
          if(target.contentid===full.contentid){replaced=true;return current;}
          replaced=true;
          const normalized=materializeProjectedDay(current,target.dayId,measuredSizes);
          return {...normalized,nodes:normalized.nodes.map(node=>node.id===targetNodeId&&node.kind==='place'?replaceCanvasPlace(node,full.contentid):node)};
        });
        if(!updated||!replaced){setSearchMessage(vanished?'바꿀 장소가 일정에서 사라졌어요.':'장소를 바꾸지 못했어요. 최신 공유 상태를 확인해 주세요.');return;}
        setDetails(previous=>new Map(previous).set(full.contentid,full));setReplaceTargetId('');selectCard(targetNodeId);setDayId(targetDay);setTab('ai');setMessage(`${full.title}로 장소를 바꿨어요. 기존 연결은 유지돼요.`);
      }else{
        if(!doc?.days.some(day=>day.id===targetDay)){setSearchMessage('선택한 날짜가 더 이상 없어요. 날짜 그룹을 다시 선택해 주세요.');return;}
        addPlace(full,undefined,targetDay);
      }
    }catch(error){if(!controller.signal.aborted&&sequence===placeChoiceSequence.current)setSearchMessage(error instanceof Error?error.message:'장소 정보를 불러오지 못했어요.');}
    finally{if(sequence===placeChoiceSequence.current){setBusy(false);if(abort.current===controller)abort.current=null;}}
  };
  const retryPlaceDetail=async(contentid:number)=>{
    triedDetails.current.delete(contentid);
    try{
      const detail=await getPlaceDetail(tripId,contentid);
      setDetails(previous=>new Map(previous).set(contentid,detail));
      setMessage('장소 상세 정보를 다시 불러왔어요.');
    }catch(error){setMessage(error instanceof Error?error.message:'장소 상세 정보를 불러오지 못했어요.');}
  };
  const addComment=(position?:{x:number;y:number},targetDay=discoveryDayId)=>{if(!doc||doc.nodes.length>=500||!targetDay)return;const placed=addPosition(position,targetDay);if(!placed)return;const model:CanvasCommentNode={id:crypto.randomUUID(),kind:'comment',dayId:placed.dayId,position:placed.position,color:'default',text:'댓글을 입력해 주세요'};const newNode:FlowNode={id:model.id,type:'comment',parentId:`day-frame:${model.dayId}`,position:canvasFrameNodePosition(model,frameLayouts.get(model.dayId)!),data:{model}};publish([...allFrameNodes.filter(node=>node.type!=='dayFrame'),newNode],board.edges,'공유 댓글 카드를 추가했어요.');selectCard(model.id);setDayId(model.dayId);setAddTargetDayId(model.dayId);};
  const copy=()=>{
    if(!selectedModel)return;
    clipboard.current=canvasClipboardCopy(selectedModel);
    setHasClipboard(true);setMessage('카드를 복사했어요.');setMenu(null);
  };
  const paste=()=>{const source=clipboard.current;if(!source||!doc||doc.nodes.length>=500)return;const placed=addPosition(undefined,discoveryDayId);if(!placed)return;const model=copyCanvasNode(source,crypto.randomUUID(),placed.dayId);model.position=placed.position;const layout=frameLayouts.get(model.dayId)!;publish([...allFrameNodes.filter(node=>node.type!=='dayFrame'),{id:model.id,type:model.kind,parentId:`day-frame:${model.dayId}`,position:canvasFrameNodePosition(model,layout),data:{model,...(model.kind==='place'?{title:placeDetails.get(model.contentid)?.title,detail:placeDetails.get(model.contentid)}:{})}}],board.edges,'복사한 카드를 추가했어요. 연결선은 복사하지 않았어요.');selectCard(model.id);};
  const clearSelectionAfterHistory=()=>{if(selectedId||selectedEdgeId)setDrawerOpen(false);setSelectedId('');setSelectedEdgeId('');setSelectedDayLinkId('');setReplaceTargetId('');setPlaceConnectionMode(false);setPlaceConnectionStartId('');setReconnectEdgeId('');setMenu(null);if(!['offline','conflict','error'].includes(sync.status))setMessage('');};
  const undo=()=>{if(sync.undo())clearSelectionAfterHistory();};
  const redo=()=>{if(sync.redo())clearSelectionAfterHistory();};
  const cancelPlaceConnection=(note='장소 연결을 취소했어요.')=>{setPlaceConnectionMode(false);setPlaceConnectionStartId('');setReconnectEdgeId('');setSelectedId('');setFlowNodes(null);setMessage(note);};
  const startPlaceConnection=(sourceId='',replacingEdgeId='')=>{
    const remainingEdges=doc?.edges.filter(edge=>edge.id!==replacingEdgeId)??[];
    if(sourceId){const source=board.nodes.find(node=>node.id===sourceId)?.data.model;if(!source||source.kind!=='place'||remainingEdges.some(edge=>edge.source===sourceId)){setReconnectEdgeId('');setPlaceConnectionMode(false);setPlaceConnectionStartId('');setMessage('이미 다음 장소가 연결된 카드는 시작점으로 선택할 수 없어요.');return;}}
    setReconnectEdgeId(replacingEdgeId);
    setPlaceConnectionMode(true);setPlaceConnectionStartId(sourceId);setSelectedId(sourceId);setSelectedEdgeId('');setSelectedDayLinkId('');setReplaceTargetId('');setMenu(null);setFlowNodes(null);setDrawerOpen(false);
    const title=sourceId?board.nodes.find(node=>node.id===sourceId)?.data.title:'첫 장소';
    setMessage(sourceId?`${title??'선택한 장소'}에서 이어질 장소를 클릭해 주세요.`:'먼저 연결을 시작할 장소를 클릭해 주세요.');
  };
  const choosePlaceConnectionNode=(nodeId:string)=>{
    const model=board.nodes.find(node=>node.id===nodeId)?.data.model;
    if(!model||model.kind!=='place'){setMessage('장소 카드만 연결할 수 있어요.');return;}
    if(!placeConnectionStartId){startPlaceConnection(nodeId);return;}
    if(placeConnectionStartId===nodeId){setPlaceConnectionStartId('');setSelectedId('');setMessage('첫 장소를 다시 선택해 주세요.');return;}
    if(connect({source:placeConnectionStartId,target:nodeId})){setPlaceConnectionMode(false);setPlaceConnectionStartId('');setSelectedId('');setFlowNodes(null);setDrawerOpen(false);}
  };
  useEffect(()=>{
    if(!placeConnectionMode||!placeConnectionStartId)return;
    const sourceExists=doc?.nodes.some(node=>node.id===placeConnectionStartId&&node.kind==='place');
    const alreadyContinues=doc?.edges.some(edge=>edge.id!==reconnectEdgeId&&edge.source===placeConnectionStartId);
    const reconnectStillExists=!reconnectEdgeId||doc?.edges.some(edge=>edge.id===reconnectEdgeId);
    if(!sourceExists||alreadyContinues||!reconnectStillExists){
      setPlaceConnectionMode(false);setPlaceConnectionStartId('');setReconnectEdgeId('');setSelectedId('');setFlowNodes(null);
      setMessage('시작 장소가 바뀌어 장소 연결을 취소했어요.');
    }
  },[doc,placeConnectionMode,placeConnectionStartId,reconnectEdgeId]);
  const runSearch=async()=>{abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);setSearchMessage('');setResults([]);try{const found=await searchPlaces(tripId,query,controller.signal);if(controller.signal.aborted)return;setResults(found);setSearchMessage(found.length?'':`“${query.trim()}” 검색 결과가 없어요.`);}catch(error){if(!controller.signal.aborted)setSearchMessage(error instanceof Error?error.message:'장소 검색에 실패했어요.');}finally{if(abort.current===controller){abort.current=null;setBusy(false);}}};
  const askAI=async()=>{if(busy||!prompt.trim()||!discoveryDayId||!doc||(pendingRecommendation.current&&!recommendationContextMatches))return;const exclude=doc.nodes.filter((n):n is CanvasPlaceNode=>n.kind==='place').map(n=>n.contentid);const hadPending=Boolean(pendingRecommendation.current);if(!hadPending){recommendationContext.current={dayId:discoveryDayId,replaceTargetId};setAiPlace(null);setAiAlternatives([]);}pendingRecommendation.current=retainRecommendationRequest(pendingRecommendation.current,prompt.trim(),discoveryDayId,exclude);if(!hadPending)setRecommendationPending(true);const request=pendingRecommendation.current;const requestContext={...recommendationContext.current};const controller=new AbortController();abort.current?.abort();abort.current=controller;setBusy(true);try{const result=await recommendPlace(tripId,request.prompt,request.dayId,request.exclude,request.key,controller.signal);if(controller.signal.aborted)return;pendingRecommendation.current=null;setRecommendationPending(false);if(requestContext.dayId===currentTargetRef.current.dayId&&requestContext.replaceTargetId===currentTargetRef.current.replaceTargetId){setAiPlace(result.place);setAiAlternatives(result.alternatives);setTab('ai');setMessage('추천 장소를 확인했어요. 추가할 장소를 선택해 주세요.');}else{setAiPlace(null);setAiAlternatives([]);setMessage('요청한 날짜나 교체 대상이 바뀌어 추천을 표시하지 않았어요. 현재 선택에 맞게 다시 요청해 주세요.');}}catch(error){if(!controller.signal.aborted)setMessage(error instanceof Error?error.message:'추천 요청을 처리하지 못했어요. 같은 요청으로 다시 결과를 확인할 수 있어요.');}finally{if(abort.current===controller){abort.current=null;setBusy(false);}}};
  useEffect(()=>()=>abort.current?.abort(),[]);
  useEffect(()=>{if(!message)return;const timeout=window.setTimeout(()=>setMessage(''),4200);return()=>window.clearTimeout(timeout);},[message]);
  useEffect(()=>{discoveryMemory.set(tripId,{tab,query,results,prompt,aiPlace,aiAlternatives,pending:pendingRecommendation.current,context:recommendationContext.current});},[tripId,tab,query,results,prompt,aiPlace,aiAlternatives,recommendationPending]);
  useEffect(()=>{if(!menu)return;const focusTimer=window.setTimeout(()=>menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),0);const outside=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as globalThis.Node))setMenu(null);};const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){setMenu(null);menuOpener.current?.focus();}};window.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);return()=>{window.clearTimeout(focusTimer);window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);};},[menu]);
  useLayoutEffect(()=>{
    if(!menu)return;
    const place=()=>{const rect=menuRef.current?.getBoundingClientRect();if(!rect)return;setMenuPosition({left:Math.max(8,Math.min(menu.x,window.innerWidth-rect.width-8)),top:Math.max(8,Math.min(menu.y,window.innerHeight-rect.height-8))});};
    const frame=window.requestAnimationFrame(place);window.addEventListener('resize',place);
    return()=>{window.cancelAnimationFrame(frame);window.removeEventListener('resize',place);};
  },[menu]);
  const keydown=(event:ReactKeyboardEvent<HTMLElement>)=>{
    if(event.key==='Escape'&&placeConnectionMode){event.preventDefault();cancelPlaceConnection();return;}
    if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'){event.preventDefault();copy();}
    else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v'){event.preventDefault();paste();}
    else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove();}
    else if((event.key==='F10'&&event.shiftKey)||event.key==='ContextMenu'){event.preventDefault();const target=(event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');const nodeId=target?.getAttribute('data-id')??selectedId;const rect=target?.getBoundingClientRect()??shell.current?.getBoundingClientRect();context({preventDefault:()=>event.preventDefault(),clientX:rect?rect.left+24:100,clientY:rect?rect.top+24:100},nodeId||undefined);}
  };
  const context=(event:{preventDefault:()=>void;clientX:number;clientY:number},nodeId?:string,dayLinkId?:string,edgeId?:string,dayTarget?:string)=>{event.preventDefault();setPlaceConnectionMode(false);setPlaceConnectionStartId('');setReconnectEdgeId('');menuOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;let dayIdForMenu=dayTarget;if(nodeId?.startsWith('day-frame:')){dayIdForMenu=nodeId.slice('day-frame:'.length);nodeId=undefined;}if(nodeId){const target=board.nodes.find(node=>node.id===nodeId);if(!target)return;setDayId(target.data.model.dayId);setAddTargetDayId(target.data.model.dayId);setSelectedId(nodeId);setReplaceTargetId('');setSelectedEdgeId('');setSelectedDayLinkId('');}else if(dayLinkId){setSelectedId('');setSelectedEdgeId('');setSelectedDayLinkId(dayLinkId);}else if(edgeId){setSelectedId('');setSelectedEdgeId(edgeId);setSelectedDayLinkId('');}else{setSelectedId('');setSelectedEdgeId('');setSelectedDayLinkId('');}if(dayIdForMenu){if(dayIdForMenu!==discoveryDayId)setReplaceTargetId('');setAddTargetDayId(dayIdForMenu);setDayId(dayIdForMenu);}setMenu({x:event.clientX,y:event.clientY,nodeId,dayId:dayIdForMenu,dayLinkId,edgeId});};
  const openCardMenu=(nodeId:string,element:HTMLElement)=>{const rect=element.getBoundingClientRect();context({preventDefault:()=>{},clientX:rect.right,clientY:rect.bottom},nodeId);};
  const openToolbarMenu=(element:HTMLElement)=>{const rect=element.getBoundingClientRect();menuOpener.current=element;setMenu({x:rect.left,y:rect.bottom,nodeId:selectedId||undefined,dayId:undefined,dayLinkId:selectedDayLinkId||undefined,edgeId:selectedEdgeId||undefined});};
  const changeDay=(nextId:string)=>{setDayId(nextId);setAddTargetDayId(nextId);setReplaceTargetId('');viewSnapshot.current={dayId:nextId,viewport:viewSnapshot.current.viewport};writeCanvasView(viewScope,viewSnapshot.current);setSelectedId('');setSelectedEdgeId('');setSelectedDayLinkId('');setPlaceConnectionMode(false);setPlaceConnectionStartId('');setReconnectEdgeId('');setMenu(null);};
  const startEdgeReconnect=(edgeId:string)=>{const edge=doc?.edges.find(item=>item.id===edgeId);if(!edge)return;startPlaceConnection(edge.source,edge.id);};
  const runCommand=(command:CanvasCommandId)=>{if(command==='undo')undo();else if(command==='redo')redo();else if(command==='add-comment')addComment(undefined,menu?.dayId??discoveryDayId);else if(command==='fit'&&overviewBounds)void flow.current?.fitBounds(overviewBounds,{padding:.14,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:180});else if(command==='toggle-drawer')setDrawerOpen(open=>!open);else if(command==='toggle-day-links')setDayLinksOn(value=>!value);else if(command==='connect-places'){if(selectedRouteEdge)startEdgeReconnect(selectedRouteEdge.id);else startPlaceConnection(selectedModel?.kind==='place'?selectedModel.id:'');}else if(command==='copy')copy();else if(command==='paste')paste();else if(command==='disconnect'){if(menu?.dayLinkId||selectedDayLinkId)remove();else if(selectedModel?.kind==='place')publish(board.nodes,board.edges.filter(e=>e.source!==selectedModel.id&&e.target!==selectedModel.id),'이 장소의 기존 연결을 끊었어요.');}else if(command==='delete')remove();};
  const syncLabel=preview?'예시 미리보기':sync.status==='saved'?'공유 초안 저장됨':sync.status==='saving'?'저장 중':sync.status==='offline'?'저장 대기':sync.status==='conflict'?'변경 확인 필요':sync.status==='error'?'저장 오류':'공유 일정 불러오는 중';

  return <section className={`tw-canvas-embedded ${preview?'is-preview':''}`} aria-label="공동 일정 캔버스" onKeyDown={keydown} tabIndex={-1}>
    <header className="tw-canvas-header">
      <div className="tw-canvas-heading"><h1>일정 캔버스</h1><span>{tripRangeLabel}</span><span className={`tw-canvas-save-state status-${preview?'preview':sync.status}`} role="status">{syncLabel}</span></div>
      <button ref={drawerTrigger} className="tw-canvas-panel-toggle" title={drawerOpen?'장소 패널 닫기':'장소 패널 열기'} aria-label={drawerOpen?'장소 패널 닫기':'장소 패널 열기'} aria-expanded={drawerOpen} onClick={()=>runCommand('toggle-drawer')}><CanvasToolIcon command="toggle-drawer" /><span>{drawerOpen?'패널 닫기':'장소 찾기'}</span></button>
    </header>
    {placeConnectionMode&&<div className="tw-place-link-mode" role="status"><span>{placeConnectionStartId?`${board.nodes.find(node=>node.id===placeConnectionStartId)?.data.title??'선택한 장소'}에서 이어질 장소를 선택해 주세요.`:'연결을 시작할 장소를 선택해 주세요.'}</span><Button variant="secondary" onClick={()=>cancelPlaceConnection()}>취소</Button><small>Esc로 취소할 수 있어요.</small></div>}
    {preview&&<p className="tw-preview-banner">예시 미리보기 · 이 화면의 변경은 실제 여행방과 공유되지 않아요.</p>}
    {!preview&&['offline','conflict','error'].includes(sync.status)&&<div className={`tw-sync-status status-${sync.status}`} role="alert"><span>{sync.message||'캔버스 상태를 확인해 주세요.'}</span>{['offline','error'].includes(sync.status)&&sync.state&&<Button variant="secondary" onClick={sync.retry}>다시 저장</Button>}{sync.status==='conflict'&&<><Button variant="secondary" onClick={()=>sync.resolve('local')}>내 변경 유지</Button><Button variant="secondary" onClick={()=>sync.resolve('remote')}>최신 내용 사용</Button></>}</div>}
    <div className={`tw-canvas-shell ${drawerOpen?'':'is-drawer-closed'}`} onKeyDownCapture={event=>{
      if(!placeConnectionMode||(event.key!=='Enter'&&event.key!==' '&&event.key!=='Spacebar'))return;
      const target=event.target as HTMLElement;
      if(target.closest('button,input,textarea,select,a,[contenteditable="true"]'))return;
      const flowNode=target.closest<HTMLElement>('.react-flow__node');
      const nodeId=flowNode?.getAttribute('data-id');
      if(!nodeId)return;
      event.preventDefault();event.stopPropagation();choosePlaceConnectionNode(nodeId);
    }}>
      <section className="tw-flow-area" aria-label="캔버스 작업 영역">
        <div className="tw-flow-canvas" ref={shell} onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();const raw=e.dataTransfer.getData('application/canvas-contentid');const id=Number(raw);const detail=placeDetails.get(id);if(detail&&flow.current)addPlace(detail,flow.current.screenToFlowPosition({x:e.clientX,y:e.clientY}));}}>
          <div className="tw-canvas-tool-dock" role="toolbar" aria-label="캔버스 도구">
            <div className="tw-canvas-dock-group" role="group" aria-label="실행 기록">{canvasCommands.filter(command=>command.id==='undo'||command.id==='redo').map(command=><button key={command.id} title={command.label} aria-label={command.label} disabled={command.id==='undo'?!sync.canUndo:!sync.canRedo} onClick={()=>runCommand(command.id)}><CanvasToolIcon command={command.id}/></button>)}</div>
            <div className="tw-canvas-dock-group" role="group" aria-label="일정 편집">{canvasCommands.filter(command=>command.id==='add-comment'||command.id==='connect-places').map(command=><button key={command.id} title={command.label} aria-label={command.label} aria-pressed={command.id==='connect-places'?placeConnectionMode:undefined} className={command.id==='connect-places'&&placeConnectionMode?'is-active':''} onClick={()=>runCommand(command.id)}><CanvasToolIcon command={command.id}/></button>)}</div>
            <div className="tw-canvas-dock-group" role="group" aria-label="보기와 더보기">{canvasCommands.filter(command=>command.id==='fit'||command.id==='edit-menu').map(command=><button key={command.id} className={command.id==='edit-menu'?'tw-canvas-options-button':''} title={command.label} aria-label={command.label} aria-haspopup={command.id==='edit-menu'?'menu':undefined} aria-expanded={command.id==='edit-menu'?Boolean(menu):undefined} onClick={event=>command.id==='edit-menu'?openToolbarMenu(event.currentTarget):runCommand(command.id)}><CanvasToolIcon command={command.id}/></button>)}</div>
          </div>
          {doc&&<SelectRouteEdge.Provider value={id=>{setSelectedEdgeId(id);setSelectedDayLinkId('');setSelectedId('');setReplaceTargetId('');setPlaceConnectionMode(false);setPlaceConnectionStartId('');setDrawerOpen(true);}}><OpenCanvasMenu.Provider value={openCardMenu}><ReactFlow<FlowNode>
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
            isValidConnection={({ source, target }) => {
              if (!source || !target) return false;
              const prefix = 'day-frame:';
              if (source.startsWith(prefix) || target.startsWith(prefix)) {
                if (!source.startsWith(prefix) || !target.startsWith(prefix) || source === target) return false;
                return !dayLinks.some(link => link.source === source.slice(prefix.length) && link.target === target.slice(prefix.length));
              }
              const replaced = draggedEdgeId.current ?? (placeConnectionMode ? reconnectEdgeId : null);
              return canConnectRoute(source, target, placeMap, replaced ? doc.edges.filter(edge => edge.id !== replaced) : doc.edges);
            }}
            onNodeClick={(_,node)=>{if(node.type==='dayFrame')return;if(placeConnectionMode){choosePlaceConnectionNode(node.id);return;}setSelectedId(node.id);setReplaceTargetId('');setDayId(node.data.model.dayId);setAddTargetDayId(node.data.model.dayId);setSelectedEdgeId('');setSelectedDayLinkId('');setDrawerOpen(true);}}
            onEdgeClick={(_,edge)=>{const dayLinkId=(edge as FlowEdge).data?.dayLinkId;if(edge.type==='dayOrder'&&dayLinkId){setSelectedDayLinkId(dayLinkId);setSelectedEdgeId('');setSelectedId('');setPlaceConnectionMode(false);setPlaceConnectionStartId('');setReconnectEdgeId('');return;}setSelectedEdgeId(edge.id);setSelectedDayLinkId('');setSelectedId('');setReplaceTargetId('');setPlaceConnectionMode(false);setPlaceConnectionStartId('');setReconnectEdgeId('');setDrawerOpen(true);}}
            onReconnectStart={(_, edge) => { draggedEdgeId.current = edge.id; }}
            onReconnect={reconnectRouteEdge}
            onReconnectEnd={() => { draggedEdgeId.current = null; }}
            onPaneClick={()=>{setMenu(null);setSelectedId('');setSelectedEdgeId('');setSelectedDayLinkId('');setPlaceConnectionMode(false);setPlaceConnectionStartId('');setReconnectEdgeId('');}}
            onPaneContextMenu={event=>context(event)}
            onNodeContextMenu={(event,node)=>{event.stopPropagation();context(event,node.id);}}
            onEdgeContextMenu={(event,edge)=>{event.stopPropagation();const flowEdge=edge as FlowEdge;if(flowEdge.type==='dayOrder'&&flowEdge.data?.dayLinkId){context(event,undefined,flowEdge.data.dayLinkId);return;}context(event,undefined,undefined,edge.id);}}
            onNodeDragStop={(_,node)=>{setFlowNodes(null);if(node.type==='dayFrame'){const frameId=node.id.slice('day-frame:'.length);let moved=false;const updated=sync.update(current=>{const next=moveDayFrame(current,frameId,node.position);moved=Boolean(next&&JSON.stringify(next.days.find(day=>day.id===frameId)?.position)!==JSON.stringify(current.days.find(day=>day.id===frameId)?.position));return next??current;});if(updated&&moved)setMessage('날짜 그룹 위치를 저장했어요. 안의 카드와 연결도 함께 이동했어요.');return;}const previous=frameLayouts.get(node.data.model.dayId);if(!previous)return;const world={x:node.position.x+previous.position.x,y:node.position.y+previous.position.y};const dropped=resolveCanvasDrop(world,frameLayouts,previous.dayId,node.data.model);if(!dropped)return;if(dropped.dayId===previous.dayId&&previous.projectedNodePositions)dropped.position=canvasDocumentPosition(node.position,previous);let moved=false;const updated=sync.update(current=>{const existing=current.nodes.find(item=>item.id===node.id);if(!existing)return current;let prepared=materializeProjectedDay(current,existing.dayId,measuredSizes,node.id);if(dropped.dayId!==existing.dayId)prepared=materializeProjectedDay(prepared,dropped.dayId,measuredSizes);const latest=prepared.nodes.find(item=>item.id===node.id);if(!latest)return current;const model={...latest,...dropped};moved=latest.dayId!==model.dayId||latest.position.x!==model.position.x||latest.position.y!==model.position.y;return {...prepared,nodes:prepared.nodes.map(item=>item.id===node.id?model:item),edges:latest.kind==='place'&&dropped.dayId!==latest.dayId?prepared.edges.filter(edge=>edge.source!==node.id&&edge.target!==node.id):prepared.edges};});if(updated&&moved)setMessage(dropped.dayId!==node.data.model.dayId?'날짜를 옮기고 기존 연결을 함께 제거했어요.':'카드 배치를 저장했어요.');if(dropped.dayId!==node.data.model.dayId){setDayId(dropped.dayId);setAddTargetDayId(dropped.dayId);}}}
            onMoveEnd={(_,viewport)=>{viewSnapshot.current={dayId:activeDayId,viewport};writeCanvasView(viewScope,viewSnapshot.current);}}
            minZoom={.01} maxZoom={2} deleteKeyCode={null} defaultEdgeOptions={edgeStyle} selectionOnDrag={false}>
            {restoreViewport && <RestoreCanvasViewport viewport={restoreViewport} onRestored={completeRestore}/>}
            {cardsMeasured && fitTarget && overviewBounds && <FitDayFrames key={fitTarget.key} bounds={overviewBounds} onFitted={completeFit}/>}
            {cardsMeasured && initialFitPending && !fitTarget && !restoreViewport && initialBounds && <FitDayFrames bounds={initialBounds} onFitted={completeInitialFit}/>}
            <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="var(--tw-grid)"/><Controls showInteractive={false}/>
          </ReactFlow></OpenCanvasMenu.Provider></SelectRouteEdge.Provider>}
          {!doc&&<div className="tw-canvas-loading">{sync.status==='error'?'공유 캔버스를 불러오지 못했어요.': '공유 캔버스를 불러오고 있어요.'}<Button variant="secondary" onClick={sync.retry}>다시 불러오기</Button></div>}
          {doc&&doc.nodes.length===0&&<div className="tw-empty-canvas"><strong>아직 일정이 비어 있어요</strong><p>날짜별 영역에 장소를 검색하거나 추천을 받아 첫 카드를 추가해 보세요.</p><Button variant="secondary" onClick={()=>setDrawerOpen(true)}>장소 찾기</Button></div>}
          {menu&&createPortal(<div ref={menuRef} className="tw-context-menu" role="menu" aria-label="편집 메뉴" style={{position:'fixed',left:menuPosition.left,top:menuPosition.top,maxHeight:'calc(100vh - 16px)',overflowY:'auto'}} onKeyDown={event=>{
            if(event.key==='Escape'){setMenu(null);menuOpener.current?.focus();return;}
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !(event.target instanceof HTMLSelectElement)) {
              event.preventDefault();
              const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select,summary')]
                .filter(item => item.tagName === 'SUMMARY' || !item.closest('details:not([open])'));
              const index = items.indexOf(document.activeElement as HTMLElement);
              const offset = event.key === 'ArrowDown' ? 1 : -1;
              items[(index + offset + items.length) % items.length]?.focus();
            }
          }}>
            {contextPlace&&<CanvasPlaceMenuSummary place={contextPlace}/>}
            {menu.dayId&&<button role="menuitem" onClick={()=>{setAddTargetDayId(menu.dayId!);setDayId(menu.dayId!);setSelectedId('');setReplaceTargetId('');setTab('ai');setDrawerOpen(true);setMenu(null);}}>이 날짜에 장소 추가</button>}
            {contextRouteEdge&&<>
              <button role="menuitem" onClick={()=>{setSelectedEdgeId(contextRouteEdge.id);setSelectedDayLinkId('');setSelectedId('');setReplaceTargetId('');setDrawerOpen(true);setMenu(null);}}>이동 시간 편집</button>
              <button role="menuitem" onClick={()=>{setSelectedEdgeId(contextRouteEdge.id);startEdgeReconnect(contextRouteEdge.id);setMenu(null);}}>도착 장소 바꾸기</button>
              <button role="menuitem" className="tw-menu-danger" onClick={()=>{remove();setMenu(null);}}>연결 삭제</button>
            </>}
            {menu.dayLinkId&&<button role="menuitem" className="tw-menu-danger" onClick={()=>{remove();setMenu(null);}}>날짜 연결 삭제</button>}
            {contextNode&&<>
              {contextNode.kind==='place'&&<button role="menuitem" onClick={()=>{setDrawerOpen(true);setMenu(null);}}>장소 정보</button>}
              {contextNode.kind==='comment'&&<button role="menuitem" onClick={()=>{setDrawerOpen(true);setMenu(null);}}>댓글 편집</button>}
              <button role="menuitem" onClick={()=>{copy();setMenu(null);}}>복사</button>
              {hasClipboard&&<button role="menuitem" onClick={()=>{paste();setMenu(null);}}>붙여넣기</button>}
              {contextNode.kind==='place'&&!contextNodeEdges.some(edge=>edge.source===contextNode.id)&&<button role="menuitem" onClick={()=>{startPlaceConnection(contextNode.id);setMenu(null);}}>여기서 장소 연결</button>}
              {contextNode.kind==='place'&&contextNodeEdges.some(edge=>edge.source===contextNode.id)&&<button role="menuitem" onClick={()=>{const edge=contextNodeEdges.find(item=>item.source===contextNode.id);if(edge)startEdgeReconnect(edge.id);setMenu(null);}}>연결 바꾸기</button>}
              {contextNode.kind==='place'&&contextNodeEdges.length>0&&<button role="menuitem" className="tw-menu-danger" onClick={()=>{publish(board.nodes,board.edges.filter(edge=>edge.source!==contextNode.id&&edge.target!==contextNode.id),'이 장소의 연결을 끊었어요.');setMenu(null);}}>장소 연결 끊기</button>}
              <button role="menuitem" className="tw-menu-danger" onClick={()=>{remove();setMenu(null);}}>삭제</button>
              <details className="tw-context-secondary"><summary>날짜와 색상</summary><label className="tw-context-day">여행 날짜<select className="text-input" value={contextNode.dayId} onChange={event=>{moveNode(contextNode.id,event.target.value);setMenu(null);}}>{doc?.days.map((item,index)=><option key={item.id} value={item.id}>{item.date??`${index+1}일차`}</option>)}</select></label><div className="tw-context-colors" aria-label="카드 색상">{colorOptions.map(([value,label])=><button type="button" key={value} aria-label={`${label} 색상`} title={`${label} 색상`} onClick={()=>{editNode(contextNode.id,model=>({...model,color:value}));setMenu(null);}}>●</button>)}</div></details>
            </>}
            {menu.dayId&&!contextNode&&<button role="menuitem" onClick={()=>runCommand('toggle-day-links')}>{dayLinksOn?'날짜 흐름선 숨기기':'날짜 흐름선 표시'}</button>}
            {!contextNode&&!contextRouteEdge&&!menu.dayLinkId&&!menu.dayId&&<>
              <button role="menuitem" onClick={()=>{addComment(undefined,discoveryDayId);setMenu(null);}}>댓글 추가</button>
              {hasClipboard&&<button role="menuitem" onClick={()=>{paste();setMenu(null);}}>붙여넣기</button>}
              <button role="menuitem" onClick={()=>runCommand('toggle-day-links')}>{dayLinksOn?'날짜 흐름선 숨기기':'날짜 흐름선 표시'}</button>
            </>}
            {sync.state&&['offline','error'].includes(sync.status)&&<button role="menuitem" onClick={()=>{sync.retry();setMenu(null);}}>저장 다시 시도</button>}
            {!preview&&routes.hasIssue&&<button role="menuitem" onClick={()=>{routes.retry();setMenu(null);}}>이동 시간 다시 확인</button>}
            {(sync.canUndo||sync.canRedo)&&<details className="tw-context-secondary"><summary>실행 기록</summary>{sync.canUndo&&<button role="menuitem" onClick={()=>{undo();setMenu(null);}}>실행 취소</button>}{sync.canRedo&&<button role="menuitem" onClick={()=>{redo();setMenu(null);}}>다시 실행</button>}</details>}
          </div>,document.body)}
        </div>{message&&<p className="tw-canvas-feedback" role="status">{message}</p>}
      </section>
      {drawerOpen&&<aside className="tw-place-drawer" aria-label="장소 및 카드 편집 패널" onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); closeDrawer(); } }}>
        <div className="tw-drawer-heading"><h2>{selectedModel?.kind==='place'?'장소 정보':selectedModel?.kind==='comment'?'공유 댓글':selectedRouteEdge?'이동 구간':replaceTargetId?'장소 바꾸기':'장소 찾기'}</h2><button type="button" onClick={closeDrawer} aria-label="장소 패널 닫기"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button></div>
        {selectedModel?.kind==='place'&&<PlaceInspector node={selectedModel} detail={placeDetails.get(selectedModel.contentid)} days={doc?.days??[]} onRetryDetail={()=>void retryPlaceDetail(selectedModel.contentid)} onBack={()=>{setSelectedId('');setReplaceTargetId('');setTab('ai');}} onReplace={()=>{setReplaceTargetId(selectedModel.id);setSelectedId('');setTab('search');setSearchMessage('');setDrawerOpen(true);}} onStartConnect={()=>startPlaceConnection(selectedModel.id)} onColor={color=>editNode(selectedModel.id,m=>({...m,color}))} onMove={next=>moveNode(selectedModel.id,next)} onDisconnect={()=>publish(board.nodes,board.edges.filter(e=>e.source!==selectedModel.id&&e.target!==selectedModel.id),'이 장소의 연결을 끊었어요.')}/>}
        {selectedModel?.kind==='comment'&&<section className="tw-inspector"><div className="tw-inspector-actions"><Button variant="secondary" onClick={()=>{setSelectedId('');setTab('ai');}}>장소 찾기로 돌아가기</Button></div><CanvasCommentEditor key={selectedModel.id} tripId={tripId} node={selectedModel} onCommit={(text,expectedText,force)=>sync.update(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedModel.id&&node.kind==='comment'&&(force||node.text===expectedText)?{...node,text}:node)}))}/><label htmlFor="tw-comment-day">여행 날짜</label><select id="tw-comment-day" className="text-input" value={selectedModel.dayId} onChange={e=>moveNode(selectedModel.id,e.target.value)}>{doc?.days.map((item,index)=><option key={item.id} value={item.id}>{item.date??`${index+1}일차`}</option>)}</select><ColorPicker value={selectedModel.color} onChange={color=>editNode(selectedModel.id,m=>({...m,color}))}/><Button variant="secondary" onClick={remove}>댓글 삭제</Button></section>}
        {!selectedModel&&selectedRouteEdge&&doc&&selectedEdgeSource?.kind==='place'&&selectedEdgeTarget?.kind==='place'&&<>
          <div className="tw-inspector-actions"><Button variant="secondary" onClick={()=>startEdgeReconnect(selectedRouteEdge.id)}>도착 장소 바꾸기</Button></div>
          <CanvasEdgeEditor key={selectedEdgeKey} tripId={tripId} conditionsVersion={conditionsVersion} sourceContentid={selectedEdgeSource.contentid} targetContentid={selectedEdgeTarget.contentid} preview={preview} commonMode={transport} preference={selectedEdgePreference} onSave={override=>edgePrefs.set(selectedRouteEdge,doc,override)} storageError={edgePrefs.storageError} fromName={selectedEdgeName(selectedEdgeSource)} toName={selectedEdgeName(selectedEdgeTarget)} automaticLabel={routes.labels.get(selectedRouteEdge.id)??'시간 미확인'}/>
          {!preview&&routes.hasIssue&&<Button variant="secondary" onClick={routes.retry}>이동 시간 다시 확인</Button>}
        </>}
        {!selectedModel&&!selectedRouteEdge&&<div className="tw-discovery">
          {replaceTargetId&&<p className="tw-replace-target-note" role="status">현재 장소 · {replaceName}</p>}
          <div className="tw-discovery-tabs" role="tablist" aria-label="장소 찾기 방식"><button type="button" role="tab" aria-selected={tab==='ai'} onClick={()=>setTab('ai')}>AI 추천</button><button type="button" role="tab" aria-selected={tab==='search'} onClick={()=>setTab('search')}>직접 검색</button></div>
          {tab==='ai'?<>
            <div className="tw-discovery-form"><label htmlFor="tw-place-prompt">{(doc?.days.findIndex(day => day.id === discoveryDayId) ?? -1) + 1 || 1}일차 장소 추천</label><textarea id="tw-place-prompt" value={recommendationPending?pendingRecommendation.current?.prompt??prompt:prompt} maxLength={1000} disabled={recommendationPending} onChange={event=>setPrompt(event.target.value)} placeholder="예: 아이와 쉬어갈 자연 명소"/><Button disabled={busy||!prompt.trim()||!discoveryDayId||(recommendationPending&&!recommendationContextMatches)} onClick={()=>void askAI()}>{busy?'추천 받는 중…':recommendationPending?'같은 요청으로 다시 확인':'추천 받기'}</Button></div>
            {recommendationPending&&!recommendationContextMatches&&<div className="tw-panel-empty" role="status"><span>대기 중인 추천은 {recommendationContext.current.dayId ? `${(doc?.days.findIndex(day=>day.id===recommendationContext.current.dayId)??-1)+1}일차` : '이전 날짜'} 요청이에요.</span><Button variant="secondary" onClick={()=>{setAddTargetDayId(recommendationContext.current.dayId);setDayId(recommendationContext.current.dayId);setReplaceTargetId(recommendationContext.current.replaceTargetId);setMessage('요청 당시의 날짜와 교체 대상을 복원했어요.');}}>요청 맥락으로 돌아가기</Button></div>}
            {(recommendationContextMatches&&(aiPlace||aiAlternatives.length>0))&&<section className="tw-search" aria-label="추천 장소"><h3>추천 장소</h3>{[...(aiPlace?[aiPlace]:[]),...aiAlternatives].map(place=><CanvasPlaceCandidate key={place.contentid} place={place} onChoose={()=>void choosePlace(place.contentid,recommendationContext.current.dayId,recommendationContext.current.replaceTargetId)} actionLabel={recommendationContext.current.replaceTargetId?'이 장소로 교체':'이 날짜에 추가'} disabled={busy}/>)}</section>}
          </>:<div className="tw-search">
            <label htmlFor="tw-place-search">장소 이름</label><div className="tw-discovery-form"><input id="tw-place-search" className="text-input" value={query} maxLength={100} onChange={event=>{if(abort.current){abort.current.abort();abort.current=null;setBusy(false);}setQuery(event.target.value);setResults([]);setSearchMessage('');}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void runSearch();}}} placeholder="장소 이름이나 주소"/><Button variant="secondary" disabled={busy||!query.trim()} onClick={()=>void runSearch()}>{busy?'검색 중…':'검색'}</Button></div>
            {searchMessage&&<p className={results.length?'tw-panel-error':'tw-panel-empty'} role="status">{searchMessage}</p>}
            {searchMessage&&!results.length&&query.trim()&&<Button className="tw-panel-retry" variant="secondary" disabled={busy} onClick={()=>void runSearch()}>다시 검색</Button>}
            {results.map(item=><CanvasPlaceCandidate key={item.contentid} place={{title:item.title,address:item.address,category:item.category}} onChoose={()=>void choosePlace(item.contentid,discoveryDayId,replaceTargetId)} actionLabel={replaceTargetId?'이 장소로 교체':'이 날짜에 추가'} disabled={busy}/>)}
          </div>}
        </div>}
      </aside>}
    </div>
  </section>;
}

function ColorPicker({value,onChange}:{value:CanvasColor;onChange:(color:CanvasColor)=>void}){return <fieldset className="tw-color-picker"><legend>카드 색상</legend>{colorOptions.map(([color,label])=><button type="button" key={color} className={`color-${color} ${value===color?'is-selected':''}`} aria-pressed={value===color} onClick={()=>onChange(color)}>{label}</button>)}</fieldset>;}
function PlaceInspector({node,detail,days,onColor,onMove,onDisconnect,onBack,onReplace,onStartConnect,onRetryDetail}:{node:CanvasPlaceNode;detail?:CanvasPlaceDetail;days:CanvasDocument['days'];onColor:(color:CanvasColor)=>void;onMove:(dayId:string)=>void;onDisconnect:()=>void;onBack:()=>void;onReplace:()=>void;onStartConnect:()=>void;onRetryDetail:()=>void}){
  return <section className="tw-inspector">
    <CanvasPlaceOverview place={detail}/>
    <div className="tw-inspector-actions"><Button variant="secondary" onClick={onBack}>장소 찾기</Button><Button variant="secondary" onClick={onReplace}>장소 바꾸기</Button><Button variant="secondary" className="tw-connect-mode-button" onClick={onStartConnect}>장소 연결</Button></div>
    {!detail&&<div className="tw-panel-error" role="status"><span>상세 정보를 확인하지 못했어요.</span><Button variant="secondary" onClick={onRetryDetail}>다시 불러오기</Button></div>}
    {node.schedule?.locked&&<p className="tw-inspector-note">생성한 일정에서 가져온 방문 시간이에요. 장소를 바꾸면 시간 정보가 해제돼요.</p>}
    <details className="tw-place-edit-controls"><summary>일정 편집</summary><div>
      <label htmlFor="tw-move-day">여행 날짜</label>
      <select id="tw-move-day" className="text-input" value={node.dayId} onChange={e=>onMove(e.target.value)}>{days.map((day,index)=><option key={day.id} value={day.id}>{day.date??`${index+1}일차`}</option>)}</select>
      <ColorPicker value={node.color} onChange={onColor}/>
      <Button variant="secondary" onClick={onDisconnect}>이 장소 연결 끊기</Button>
    </div></details>
  </section>;
}
