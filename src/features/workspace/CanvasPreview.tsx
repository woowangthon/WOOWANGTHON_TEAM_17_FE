import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { addEdge, applyNodeChanges, Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, useNodesInitialized, useReactFlow, type Connection, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Button from '../../components/ui/Button';
import CanvasToolIcon from './CanvasToolIcon';
import CanvasCommentEditor from './CanvasCommentEditor';
import { getPlaceDetail, recommendPlace, searchPlaces, type PlaceSearchResult } from './canvasApi';
import { canConnectRoute, canvasClipboardCopy, copyCanvasNode, mergeCanvasDocuments, type CanvasColor, type CanvasCommentNode, type CanvasDocument, type CanvasNode, type CanvasPlaceDetail, type CanvasPlaceNode } from './canvasModel';
import { canvasCommands, type CanvasCommandId } from './canvasCommands';
import { retainRecommendationRequest, type RecommendationRequest } from './canvasRecommendation.ts';
import { useCanvasSync } from './useCanvasSync';
import { useCanvasRoutes } from './useCanvasRoutes.ts';
import type { CanvasTravelMode } from './canvasRoutes.ts';
import { canvasViewScope, consumeHandoff, firstRouteDay, hasFittedHandoff, markHandoffFitted, readCanvasView, resolveCanvasMountView, writeCanvasView, type CanvasHandoff, type CanvasViewMemory, type CanvasViewport } from './canvasHandoff.ts';
import { canvasDocumentPosition, canvasFrameNodePosition, ensureCanvasDateRange, frameForPoint, layoutCanvasDayFrames, dayLabel, resolveCanvasDrop, type CanvasFrameLayout } from './canvasDayFrames.ts';

type FlowNode = Node<{ model: CanvasNode; title?: string; detail?: CanvasPlaceDetail; visitLabel?: string; dayTitle?: string; placeCount?: number; mealCount?: number; commentCount?: number }, 'place'|'comment'|'dayFrame'>;
type Board = { nodes: FlowNode[]; edges: Edge[] };
const OpenCanvasMenu=createContext<(id:string,element:HTMLElement)=>void>(()=>{});
const FocusCanvasDay=createContext<(dayId:string)=>void>(()=>{});
type DiscoveryMemory={tab:'discover'|'alternatives'|'search';query:string;results:PlaceSearchResult[];prompt:string;aiPlace:CanvasPlaceDetail|null;aiAlternatives:CanvasPlaceDetail[];pending:RecommendationRequest|null};
const discoveryMemory=new Map<string,DiscoveryMemory>();
const colorOptions: Array<[CanvasColor,string]> = [['default','기본'],['lime','연두'],['sky','하늘'],['rose','분홍'],['amber','살구']];
const colorName=(color:CanvasColor)=>colorOptions.find(([value])=>value===color)?.[1]??'기본';
const marker = { type: MarkerType.ArrowClosed, color: 'var(--color-accent-hover)' };
const edgeStyle = { type: 'smoothstep' as const, markerEnd: marker, style: { stroke: 'var(--color-accent-hover)', strokeWidth: 2 } };
function GeneratedHandoffFit({ handoffKey, nodeIds, onFitted }: { handoffKey:string; nodeIds:string[]; onFitted:(viewport:CanvasViewport)=>void }) {
  const flow = useReactFlow<FlowNode>();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized || !flow || !nodeIds.length || hasFittedHandoff(handoffKey)) return;
    const visible = flow.getNodes();
    if (!nodeIds.every(id => visible.some(node => node.id === id))) return;
    let active = true;
    void flow.fitView({ nodes: nodeIds.map(id => ({ id })), padding: .2, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 })
      .then(fitted => { if (active && fitted) { markHandoffFitted(handoffKey); onFitted(flow.getViewport()); } }, () => { /* A disposed viewport does not consume this handoff. */ });
    return () => { active = false; };
  }, [flow, handoffKey, initialized, nodeIds, onFitted]);
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
function InitialCanvasFit({ nodeIds, onFitted }: { nodeIds:string[]; onFitted:(viewport:CanvasViewport)=>void }) {
  const flow = useReactFlow<FlowNode>();
  const initialized = useNodesInitialized();
  useEffect(() => {
    if (!initialized || !nodeIds.length) return;
    const visible = flow.getNodes();
    if (!nodeIds.every(id => visible.some(node => node.id === id))) return;
    let active = true;
    void flow.fitView({ nodes: nodeIds.map(id => ({ id })), padding: .2, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180 })
      .then(fitted => { if (active && fitted) onFitted(flow.getViewport()); }, () => {});
    return () => { active = false; };
  }, [flow, initialized, nodeIds, onFitted]);
  return null;
}
function DayFrame({ data }: NodeProps<FlowNode>) {
  const focusDay=useContext(FocusCanvasDay);
  return <section className="tw-canvas-day-frame" aria-label={`${data.dayTitle} 일정 그룹`}>
    <header><button type="button" className="tw-day-frame-focus nodrag nopan" aria-label={`${data.dayTitle} 영역으로 이동`} onClick={event=>{event.stopPropagation();focusDay(data.model.dayId);}}>{data.dayTitle}</button><span>장소 {data.placeCount}{data.mealCount ? ` · 식사 ${data.mealCount}` : ''} · 댓글 {data.commentCount}</span></header>
  </section>;
}
const roleLabels: Record<string, string> = {
  meal_stop: '식당', sightseeing_stop: '관광', culture_stop: '문화', activity_stop: '체험',
  shopping_stop: '쇼핑', overnight_lodging: '숙소', overnight_camping: '캠핑', date_specific_event: '행사',
};
function PlaceCard({ id,data, selected }: NodeProps<FlowNode>) { const model = data.model as CanvasPlaceNode; const open=useContext(OpenCanvasMenu); return <article className={`tw-place-node ${selected?'is-selected':''} ${model.intent==='candidate'?'is-candidate':''} color-${model.color}`}><button type="button" className="tw-node-menu-button nodrag nopan" aria-label={`${data.title??'장소'} 편집 메뉴`} onClick={event=>{event.stopPropagation();open(id,event.currentTarget);}}>⋯</button><div className="tw-node-meta"><span>{model.intent==='candidate'?'대안':'동선'}</span><span>{model.color==='default'?'':colorName(model.color)}</span></div><strong>{data.title ?? '장소 정보 확인 중'}</strong><small>{data.detail?.address ?? data.detail?.category ?? '주소·상세 정보 미확인'}</small>{data.visitLabel&&<small className="tw-place-schedule">{data.visitLabel}</small>}{Number.isInteger(data.detail?.estimatedStayMinutes)&&<small>체류 {data.detail!.estimatedStayMinutes}분 · 장소 정보</small>}{data.detail?.planningRole && roleLabels[data.detail.planningRole] && <p>{roleLabels[data.detail.planningRole]}</p>}<Handle type="target" position={Position.Left} className="tw-handle" aria-label="앞 장소 연결점" /><Handle type="source" position={Position.Right} className="tw-handle" aria-label="다음 장소 연결점" /></article>; }
function CommentCard({ id,data, selected }: NodeProps<FlowNode>) { const model = data.model as CanvasCommentNode; const open=useContext(OpenCanvasMenu); return <article className={`tw-comment-node color-${model.color} ${selected?'is-selected':''}`}><button type="button" className="tw-node-menu-button nodrag nopan" aria-label="댓글 편집 메뉴" onClick={event=>{event.stopPropagation();open(id,event.currentTarget);}}>⋯</button><span>공유 댓글</span><p>{model.text}</p></article>; }
const nodeTypes = { place: PlaceCard, comment: CommentCard, dayFrame: DayFrame };
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
  const initialDiscovery=discoveryMemory.get(tripId); const [details,setDetails]=useState<Map<number,CanvasPlaceDetail>>(new Map()); const [dayId,setDayId]=useState(savedView?.dayId??''); const [restoreViewport,setRestoreViewport]=useState<CanvasViewport|null>(null); const [initialFitPending,setInitialFitPending]=useState(false); const [drawerOpen,setDrawerOpen]=useState(()=>window.matchMedia('(min-width: 701px)').matches); const [tab,setTab]=useState<DiscoveryMemory['tab']>(initialDiscovery?.tab??'discover'); const [query,setQuery]=useState(initialDiscovery?.query??''); const [results,setResults]=useState<PlaceSearchResult[]>(initialDiscovery?.results??[]); const [prompt,setPrompt]=useState(initialDiscovery?.prompt??''); const [aiPlace,setAiPlace]=useState<CanvasPlaceDetail|null>(initialDiscovery?.aiPlace??null); const [aiAlternatives,setAiAlternatives]=useState<CanvasPlaceDetail[]>(initialDiscovery?.aiAlternatives??[]); const [busy,setBusy]=useState(false); const [recommendationPending,setRecommendationPending]=useState(Boolean(initialDiscovery?.pending)); const [message,setMessage]=useState(''); const [selectedId,setSelectedId]=useState(''); const [selectedEdgeId,setSelectedEdgeId]=useState(''); const [menu,setMenu]=useState<{x:number;y:number;nodeId?:string}|null>(null);  const [hasClipboard,setHasClipboard]=useState(false);
  const [flowNodes,setFlowNodes]=useState<{base:CanvasDocument|null;nodes:FlowNode[]}|null>(null); const [fitFocus,setFitFocus]=useState<'all'|'day'>('all'); const flow=useRef<ReactFlowInstance<FlowNode>|null>(null); const shell=useRef<HTMLDivElement>(null); const menuRef=useRef<HTMLDivElement>(null); const menuOpener=useRef<HTMLElement|null>(null); const clipboard=useRef<CanvasNode|null>(null); const abort=useRef<AbortController|null>(null); const triedDetails=useRef<Set<number>>(new Set()); const pendingRecommendation=useRef<RecommendationRequest|null>(initialDiscovery?.pending??null);
  const viewInitialized=useRef(false); const viewSnapshot=useRef<CanvasViewMemory>({dayId:savedView?.dayId??'',viewport:savedView?.viewport??null});
  const [fitTarget,setFitTarget]=useState<{key:string;nodes:string[]}|null>(null);
  const currentFitKey=useRef<string|null>(null);currentFitKey.current=fitTarget?.key??null;
  const completeFit=useCallback((viewport:CanvasViewport)=>{const key=currentFitKey.current;if(key)setFitTarget(current=>current?.key===key?null:current);setInitialFitPending(false);viewSnapshot.current={...viewSnapshot.current,viewport};writeCanvasView(viewScope,viewSnapshot.current);},[viewScope]);
  const completeRestore=useCallback(()=>setRestoreViewport(null),[]);
  useEffect(()=>{ if(!doc)return;
    const mountView=resolveCanvasMountView(doc,viewScope,handoff?.tripId===tripId?handoff:null);
    if(mountView.kind==='handoff'){
      const {target,key}=mountView;consumeHandoff(viewScope,handoff!.handoffId);viewInitialized.current=true;
      setDayId(target.dayId);viewSnapshot.current={dayId:target.dayId,viewport:null};writeCanvasView(viewScope,viewSnapshot.current);
      setSelectedId('');setSelectedEdgeId('');setMenu(null);setRestoreViewport(null);setInitialFitPending(false);
      setFitTarget(target.nodeIds.length&&!hasFittedHandoff(key)?{key,nodes:target.nodeIds}:null);
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
    setRestoreViewport(mountView.viewport);setInitialFitPending(Boolean(mountView.initialFitNodeIds.length));
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
  const focusDay=useCallback((nextId:string)=>{if(!doc?.days.some(item=>item.id===nextId))return;setDayId(nextId);setSelectedId('');setSelectedEdgeId('');setMenu(null);viewSnapshot.current={dayId:nextId,viewport:null};writeCanvasView(viewScope,viewSnapshot.current);void flow.current?.fitView({nodes:[{id:`day-frame:${nextId}`}],padding:.28,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:180});},[doc,viewScope]);
  const routes=useCanvasRoutes(tripId,conditionsVersion,transport,doc??null,null,preview);
  useEffect(()=>{
    if(!doc)return;
    const dated=ensureCanvasDateRange(doc,startDate,endDate,Boolean(sync.state?.sourcePlan));
    if(dated!==doc)sync.update(dated);
  },[doc,endDate,startDate,sync.state?.sourcePlan,sync.update]);
  const placeDetails=useMemo(()=>{const combined=new Map((sync.state?.places??[]).map(place=>[place.contentid,place]));for(const [id,place] of details)combined.set(id,place);return combined;},[sync.state,details]);
  useEffect(()=>{ if(!doc||preview) return; const missing=[...new Set(doc.nodes.filter((n):n is CanvasPlaceNode=>n.kind==='place').map(n=>n.contentid))].filter(id=>!placeDetails.has(id)&&!triedDetails.current.has(id)); if(!missing.length)return; const attemptedDetails=triedDetails.current;missing.forEach(id=>attemptedDetails.add(id)); const ctrl=new AbortController();let settled=false; void Promise.all(missing.map(id=>getPlaceDetail(tripId,id,ctrl.signal).then(p=>[id,p] as const).catch(()=>null))).then(items=>{settled=true;if(ctrl.signal.aborted)return;const successful=items.filter((item):item is readonly [number,CanvasPlaceDetail]=>item!==null);if(successful.length)setDetails(old=>{const next=new Map(old);for(const [id,place] of successful)next.set(id,place);return next;});}); return ()=>{ctrl.abort();if(!settled)for(const id of missing)attemptedDetails.delete(id);}; },[doc,placeDetails,preview,tripId]);
  const board=useMemo(()=>doc?boardOf(doc,placeDetails):{nodes:[],edges:[]},[doc,placeDetails]);
  const frameLayouts=useMemo(()=>doc?layoutCanvasDayFrames(doc):new Map<string,CanvasFrameLayout>(),[doc]);
  const allFrameNodes=useMemo(()=>{
    if(!doc)return [];
    const frames:FlowNode[]=doc.days.map((item,index)=>{
      const layout=frameLayouts.get(item.id)!;
      const groupNodes=doc.nodes.filter(node=>node.dayId===item.id);
      return {id:`day-frame:${item.id}`,type:'dayFrame',position:layout.position,draggable:false,selectable:false,connectable:false,zIndex:-1,style:{width:layout.width,height:layout.height},data:{model:{id:item.id,kind:'comment',dayId:item.id,position:{x:0,y:0},color:'default',text:''},dayTitle:dayLabel(item,index),placeCount:groupNodes.filter(node=>node.kind==='place').length,mealCount:groupNodes.filter((node):node is CanvasPlaceNode=>node.kind==='place'&&placeDetails.get(node.contentid)?.planningRole==='meal_stop').length,commentCount:groupNodes.filter(node=>node.kind==='comment').length}} as FlowNode;
    });
    const children=board.nodes.map(node=>{
      const layout=frameLayouts.get(node.data.model.dayId)!;
      return {...node,parentId:`day-frame:${layout.dayId}`,position:canvasFrameNodePosition(node.data.model,layout),selected:node.id===selectedId,zIndex:1};
    });
    return [...frames,...children];
  },[board.nodes,doc,frameLayouts,placeDetails,selectedId]);
  const fitNodeIds=useMemo(()=>board.nodes.filter(node=>node.data.model.kind==='place').map(node=>node.id),[board]);
  const activeFitNodeIds=useMemo(()=>{const places=board.nodes.filter(node=>node.data.model.dayId===activeDayId&&node.data.model.kind==='place').map(node=>node.id);return places.length?places:doc?.days.some(item=>item.id===activeDayId)?[`day-frame:${activeDayId}`]:[];},[activeDayId,board,doc]);
  const visibleIds=new Set(board.nodes.map(n=>n.id));
  const visibleEdges=board.edges.map(e=>({...e,selected:e.id===selectedEdgeId,label:preview?'시간 미확인':routes.labels.get(e.id)??'시간 미확인',labelStyle:{fill:'var(--canvas-ink)',fontSize:12},labelBgStyle:{fill:'var(--canvas-surface)',stroke:'var(--canvas-border)'},labelBgPadding:[6,3] as [number,number],labelBgBorderRadius:8,labelShowBg:true}));
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
  const addComment=(position?:{x:number;y:number})=>{if(!doc||doc.nodes.length>=500||!activeDayId)return;const placed=addPosition(position);if(!placed)return;const model:CanvasCommentNode={id:crypto.randomUUID(),kind:'comment',dayId:placed.dayId,position:placed.position,color:'default',text:'댓글을 입력해 주세요'};const newNode:FlowNode={id:model.id,type:'comment',parentId:`day-frame:${model.dayId}`,position:canvasFrameNodePosition(model,frameLayouts.get(model.dayId)!),data:{model}};publish([...allFrameNodes.filter(node=>node.type!=='dayFrame'),newNode],board.edges,'공유 댓글 카드를 추가했어요.');setSelectedId(model.id);setDayId(model.dayId);};
  const copy=()=>{
    if(!selectedModel)return;
    clipboard.current=canvasClipboardCopy(selectedModel);
    setHasClipboard(true);setMessage('카드를 복사했어요.');setMenu(null);
  };
  const paste=()=>{const source=clipboard.current;if(!source||!doc||doc.nodes.length>=500)return;const placed=addPosition(undefined,activeDayId);if(!placed)return;const model=copyCanvasNode(source,crypto.randomUUID(),placed.dayId);model.position=placed.position;const layout=frameLayouts.get(model.dayId)!;publish([...allFrameNodes.filter(node=>node.type!=='dayFrame'),{id:model.id,type:model.kind,parentId:`day-frame:${model.dayId}`,position:canvasFrameNodePosition(model,layout),data:{model,...(model.kind==='place'?{title:placeDetails.get(model.contentid)?.title,detail:placeDetails.get(model.contentid)}:{})}}],board.edges,'복사한 카드를 추가했어요. 연결선은 복사하지 않았어요.');setMenu(null);};
  const undo=()=>sync.undo();
  const redo=()=>sync.redo();
  const runSearch=async()=>{abort.current?.abort();const controller=new AbortController();abort.current=controller;setBusy(true);try{setResults(await searchPlaces(tripId,query,controller.signal));setMessage('');}catch(e){if(!controller.signal.aborted)setMessage(e instanceof Error?e.message:'장소 검색에 실패했어요.');}finally{setBusy(false);}};
  const chooseSummary=async(item:PlaceSearchResult)=>{setBusy(true);try{const full=await getPlaceDetail(tripId,item.contentid);addPlace(full);}catch(e){setMessage(e instanceof Error?e.message:'상세 정보를 불러오지 못했어요.');}finally{setBusy(false);}};
  const askAI=async()=>{if(busy||!prompt.trim()||!activeDayId||!doc)return;const exclude=doc.nodes.filter((n):n is CanvasPlaceNode=>n.kind==='place').map(n=>n.contentid);const hadPending=Boolean(pendingRecommendation.current);pendingRecommendation.current=retainRecommendationRequest(pendingRecommendation.current,prompt.trim(),activeDayId,exclude);if(!hadPending)setRecommendationPending(true);const request=pendingRecommendation.current;setBusy(true);try{const result=await recommendPlace(tripId,request.prompt,request.dayId,request.exclude,request.key);pendingRecommendation.current=null;setRecommendationPending(false);setAiPlace(result.place);setAiAlternatives(result.alternatives);setTab('alternatives');addPlace(result.place,undefined,request.dayId);setMessage('AI 추천 장소 한 곳을 검토용 후보로 추가했어요. 대안도 확인할 수 있어요.');}catch(e){setMessage(e instanceof Error?e.message:'추천 요청을 처리하지 못했어요. 같은 요청으로 다시 결과를 확인할 수 있어요.');}finally{setBusy(false);}};
  useEffect(()=>()=>abort.current?.abort(),[]);
  useEffect(()=>{discoveryMemory.set(tripId,{tab,query,results,prompt,aiPlace,aiAlternatives,pending:pendingRecommendation.current});},[tripId,tab,query,results,prompt,aiPlace,aiAlternatives,recommendationPending]);
  useEffect(()=>{if(!menu)return;const focusTimer=window.setTimeout(()=>menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(),0);const outside=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as globalThis.Node))setMenu(null);};const escape=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){setMenu(null);menuOpener.current?.focus();}};window.addEventListener('pointerdown',outside);window.addEventListener('keydown',escape);return()=>{window.clearTimeout(focusTimer);window.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape);};},[menu]);
  const keydown=(event:ReactKeyboardEvent<HTMLElement>)=>{if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]'))return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redo();else undo();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();redo();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'){event.preventDefault();copy();}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v'){event.preventDefault();paste();}else if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();remove();}else if((event.key==='F10'&&event.shiftKey)||event.key==='ContextMenu'){event.preventDefault();const target=(event.target as HTMLElement).closest<HTMLElement>('.react-flow__node');const nodeId=target?.getAttribute('data-id')??selectedId;const rect=target?.getBoundingClientRect()??shell.current?.getBoundingClientRect();context({preventDefault:()=>event.preventDefault(),clientX:rect?rect.left+24:100,clientY:rect?rect.top+24:100},nodeId||undefined);}};
  const context=(event:{preventDefault:()=>void;clientX:number;clientY:number},nodeId?:string)=>{event.preventDefault();menuOpener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;if(nodeId){const target=board.nodes.find(node=>node.id===nodeId);if(!target)return;setDayId(target.data.model.dayId);setSelectedId(nodeId);setSelectedEdgeId('');}else{setSelectedId('');setSelectedEdgeId('');}setMenu({x:event.clientX,y:event.clientY,nodeId});};
  const openCardMenu=(nodeId:string,element:HTMLElement)=>{const rect=element.getBoundingClientRect();context({preventDefault:()=>{},clientX:rect.right,clientY:rect.bottom},nodeId);};
  const changeDay=(nextId:string)=>{setDayId(nextId);setFitFocus('day');viewSnapshot.current={dayId:nextId,viewport:null};writeCanvasView(viewScope,viewSnapshot.current);setRestoreViewport(null);setInitialFitPending(Boolean(doc?.days.some(item=>item.id===nextId)));setFitTarget(null);setSelectedId('');setSelectedEdgeId('');setMenu(null);};
  const runCommand=(command:CanvasCommandId)=>{if(command==='undo')undo();else if(command==='redo')redo();else if(command==='add-comment')addComment();else if(command==='fit')flow.current?.fitView({padding:.2,duration:window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:180});else if(command==='toggle-drawer')setDrawerOpen(open=>!open);else if(command==='copy')copy();else if(command==='paste')paste();else if(command==='disconnect'){if(selectedModel?.kind==='place')publish(board.nodes,board.edges.filter(e=>e.source!==selectedModel.id&&e.target!==selectedModel.id),'이 장소의 기존 연결을 끊었어요.');}else if(command==='delete')remove();};

  return <section className={`tw-canvas-embedded ${preview?'is-preview':''}`} aria-label="공동 일정 캔버스" onKeyDown={keydown} tabIndex={-1}>
    <header className="tw-canvas-header"><div><h1>일정 캔버스</h1><p>카드는 자유롭게 배치하고, 방문 순서는 연결선으로 정해요.</p></div><div className="tw-canvas-toolbar" role="toolbar" aria-label="캔버스 도구">{canvasCommands.filter(item=>item.surface==='toolbar'||item.surface==='both').map(command=><button key={command.id} title={command.id==='toggle-drawer'?(drawerOpen?'장소 패널 닫기':'장소 패널 열기'):command.label} aria-label={command.id==='toggle-drawer'?(drawerOpen?'장소 패널 닫기':'장소 패널 열기'):command.label} aria-expanded={command.id==='toggle-drawer'?drawerOpen:undefined} disabled={command.id==='undo'?!sync.canUndo:command.id==='redo'?!sync.canRedo:false} onClick={()=>runCommand(command.id)}><CanvasToolIcon command={command.id} /></button>)}</div></header>
    {preview&&<p className="tw-preview-banner">예시 미리보기 · 이 화면의 변경은 실제 여행방과 공유되지 않아요.</p>}
    {!preview&&<div className={`tw-sync-status status-${sync.status}`} role="status">{sync.status==='saved'?'공유 초안 저장됨':sync.status==='saving'?'저장 중':sync.status==='offline'?'저장 대기 · 연결 확인 필요':sync.status==='conflict'?'함께 수정한 내용 확인 필요':sync.status==='loading'?'공유 캔버스 불러오는 중':''}{sync.message&&<span>{sync.message}</span>}{sync.status==='offline'&&<Button variant="secondary" onClick={sync.retry}>재시도</Button>}{sync.status==='conflict'&&<><Button variant="secondary" onClick={()=>sync.resolve('local')}>내 변경 유지</Button><Button variant="secondary" onClick={()=>sync.resolve('remote')}>최신 내용 사용</Button></>}</div>}
    {handoffWarningLabels.length>0&&<aside className="tw-canvas-plan-notes" aria-label="생성 일정 참고 사항" role="status">{handoffWarningLabels.map(label=><span key={label}>{label}</span>)}</aside>}
    <div className={`tw-canvas-shell ${drawerOpen?'':'is-drawer-closed'}`}>
      <section className="tw-flow-area" aria-label="캔버스 작업 영역"><div className="tw-canvas-topline"><strong>전체 일정</strong><span>{tripRangeLabel}</span></div>
        <div className="tw-flow-canvas" ref={shell} onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();const raw=e.dataTransfer.getData('application/canvas-contentid');const id=Number(raw);const detail=placeDetails.get(id);if(detail&&flow.current)addPlace(detail,flow.current.screenToFlowPosition({x:e.clientX,y:e.clientY}));}}>
          {doc&&<FocusCanvasDay.Provider value={focusDay}><OpenCanvasMenu.Provider value={openCardMenu}><ReactFlow<FlowNode> nodes={flowNodes?.base===doc?flowNodes.nodes:allFrameNodes} edges={visibleEdges} nodeTypes={nodeTypes} onInit={instance=>{flow.current=instance;}} onNodesChange={changes=>{const current=flowNodes?.base===doc?flowNodes.nodes:allFrameNodes;const next=applyNodeChanges(changes,current);if(changes.some(c=>c.type==='position'))setFlowNodes({base:doc,nodes:next});}} onEdgesChange={changes=>{const removed=new Set(changes.filter(x=>x.type==='remove').map(x=>x.id));if(removed.size)publish(board.nodes,board.edges.filter(e=>!removed.has(e.id)),'연결을 제거했어요.');}} onConnect={connect} isValidConnection={c=>!!c.source&&!!c.target&&canConnectRoute(c.source,c.target,placeMap,doc.edges)} onNodeClick={(_,n)=>{if(n.type==='dayFrame')return;setSelectedId(n.id);setDayId(n.data.model.dayId);setSelectedEdgeId('');setDrawerOpen(true);}} onEdgeClick={(_,e)=>{setSelectedEdgeId(e.id);setSelectedId('');}} onPaneClick={()=>{setMenu(null);setSelectedId('');setSelectedEdgeId('');}} onPaneContextMenu={e=>context(e)} onNodeContextMenu={(e,n)=>{if(n.type==='dayFrame'){e.preventDefault();return;}e.stopPropagation();context(e,n.id);}} onEdgeContextMenu={(e,edge)=>{e.stopPropagation();context(e);setSelectedEdgeId(edge.id);}} onNodeDragStop={(_,node)=>{if(node.type==='dayFrame')return;const previous=frameLayouts.get(node.data.model.dayId);if(!previous)return;const world={x:node.position.x+previous.position.x,y:node.position.y+previous.position.y};const dropped=resolveCanvasDrop(world,frameLayouts,previous.dayId);if(!dropped)return;const model={...node.data.model,...dropped};const edges=node.data.model.kind==='place'&&dropped.dayId!==node.data.model.dayId?board.edges.filter(edge=>edge.source!==node.id&&edge.target!==node.id):board.edges;const nodes=board.nodes.map(item=>item.id===node.id?{...item,data:{...item.data,model}}:item);setFlowNodes(null);publish(nodes,edges,dropped.dayId!==node.data.model.dayId?'날짜를 옮기고 기존 연결을 함께 제거했어요.':'카드 배치를 저장하고 있어요.');if(dropped.dayId!==node.data.model.dayId)setDayId(dropped.dayId);}} onMoveEnd={(_,viewport)=>{viewSnapshot.current={dayId:activeDayId,viewport};writeCanvasView(viewScope,viewSnapshot.current);}} minZoom={.01} maxZoom={2} deleteKeyCode={null} defaultEdgeOptions={edgeStyle} selectionOnDrag={false}>{fitTarget&&<GeneratedHandoffFit handoffKey={fitTarget.key} nodeIds={fitTarget.nodes} onFitted={completeFit}/>}{restoreViewport&&<RestoreCanvasViewport viewport={restoreViewport} onRestored={completeRestore}/>}{initialFitPending&&!fitTarget&&!restoreViewport&&<InitialCanvasFit nodeIds={fitFocus==='day'?activeFitNodeIds:fitNodeIds} onFitted={completeInitialFit}/>}<Background variant={BackgroundVariant.Dots} gap={28} size={1} color="var(--tw-grid)"/><Controls showInteractive={false}/></ReactFlow></OpenCanvasMenu.Provider></FocusCanvasDay.Provider>}
          {!doc&&<div className="tw-canvas-loading">{sync.status==='error'?'공유 캔버스를 불러오지 못했어요.': '공유 캔버스를 불러오고 있어요.'}<Button variant="secondary" onClick={sync.retry}>다시 불러오기</Button></div>}
          {doc&&doc.nodes.length===0&&<div className="tw-empty-canvas"><strong>아직 일정이 비어 있어요</strong><p>날짜별 영역에 장소를 검색하거나 추천을 받아 첫 카드를 추가해 보세요.</p><Button variant="secondary" onClick={()=>setDrawerOpen(true)}>장소 찾기</Button></div>}
          {menu&&createPortal(<div ref={menuRef} className="tw-context-menu" role="menu" aria-label="캔버스 편집 메뉴" style={{left:Math.max(8,Math.min(menu.x,window.innerWidth-230)),top:Math.max(8,Math.min(menu.y,window.innerHeight-330)),maxHeight:Math.max(96,window.innerHeight-Math.max(8,Math.min(menu.y,window.innerHeight-330))-8)}} onKeyDown={e=>{if(e.key==='Escape'){setMenu(null);menuOpener.current?.focus();return;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const items=[...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];const i=items.indexOf(document.activeElement as HTMLButtonElement);items[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();}}}>
            {canvasCommands.filter(command=>command.surface==='context'||command.surface==='both').map(command=><button key={command.id} role="menuitem" disabled={command.id==='undo'?!sync.canUndo:command.id==='redo'?!sync.canRedo:command.id==='delete'?!menu.nodeId&&!selectedEdgeId:command.id==='paste'?!hasClipboard:command.id==='disconnect'?selectedModel?.kind!=='place':command.id==='copy'?!menu.nodeId:false} onClick={()=>{runCommand(command.id);setMenu(null);}}>{command.label}</button>)}<label className="tw-context-day">날짜 이동<select className="text-input" value={menu.nodeId?board.nodes.find(n=>n.id===menu.nodeId)?.data.model.dayId??activeDayId:activeDayId} disabled={!menu.nodeId} onChange={e=>{if(menu.nodeId)moveNode(menu.nodeId,e.target.value);setMenu(null);}}>{doc?.days.map((item,index)=><option key={item.id} value={item.id}>{item.date??`${index+1}일차`}</option>)}</select></label><button role="menuitem" disabled={!menu.nodeId} onClick={()=>{setDrawerOpen(true);setMenu(null);}}>선택 정보</button><button role="menuitem" disabled={selectedModel?.kind!=='comment'} onClick={()=>{setDrawerOpen(true);setMenu(null);}}>댓글 편집</button><div className="tw-context-colors" aria-label="카드 색상">{colorOptions.map(([value,label])=><button key={value} disabled={!menu.nodeId} aria-label={`${label} 색상`} title={`${label} 색상`} onClick={()=>{if(menu.nodeId)editNode(menu.nodeId,m=>({...m,color:value}));setMenu(null);}}>●</button>)}</div><button role="menuitem" onClick={()=>setMenu(null)}>닫기</button>
          </div>,document.body)}
        </div><div className="tw-canvas-summary"><span>장소 {doc?.nodes.filter(n=>n.dayId===activeDayId&&n.kind==='place').length??0}</span><span>댓글 {doc?.nodes.filter(n=>n.dayId===activeDayId&&n.kind==='comment').length??0}</span><span>연결 {doc?.edges.filter(e=>visibleIds.has(e.source)).length??0}</span><span>경로 시간은 저장된 공통 조건으로 확인해요.</span>{!preview&&routes.routeCount>0&&<button type="button" onClick={routes.retry}>경로 다시 확인</button>}{!preview&&routes.hasIssue&&<span role="status">경로를 확인하지 못했어요. 다시 확인해 주세요.</span>}</div><p className="tw-canvas-help" role="status">{message||'카드를 선택하거나 우클릭해 편집하세요. 키보드에서는 Shift+F10 또는 메뉴 키를 사용할 수 있어요.'}</p>
      </section>
      {drawerOpen&&<aside className="tw-place-drawer" aria-label="장소 및 카드 편집 패널">
        <div className="tw-drawer-heading"><h2>{selectedModel?.kind==='place'?'장소 정보':selectedModel?.kind==='comment'?'공유 댓글':'장소 찾기'}</h2><button onClick={()=>setDrawerOpen(false)} aria-label="장소 패널 닫기">×</button></div>
        {!selectedModel&&<><div className="tw-discovery-prompt"><h3>장소를 함께 찾아볼까요?</h3><p>AI 추천은 실제 장소를 제안해요. 추가 전에 내용을 확인할 수 있어요.</p><textarea value={prompt} maxLength={1000} onChange={e=>setPrompt(e.target.value)} placeholder="예: 아이와 함께 쉬기 좋은 자연 명소" aria-label="AI 장소 추천 요청"/><Button disabled={busy||!prompt.trim()||!activeDayId} onClick={()=>void askAI()}>{busy?'찾는 중…':recommendationPending?'추천 결과 다시 확인':'AI 추천 받기'}</Button>{recommendationPending&&!busy&&<Button variant="secondary" onClick={()=>{pendingRecommendation.current=null;setRecommendationPending(false);setMessage('새 내용으로 추천을 요청할 수 있어요.');}}>새 추천 요청 시작</Button>}<small>요청 문구는 저장되거나 참여자에게 공유되지 않아요.</small></div>
        <div className="tw-discovery-tabs" role="tablist" aria-label="장소 찾기 방식"><button role="tab" aria-selected={tab==='alternatives'} onClick={()=>setTab('alternatives')}>추천 대안</button><button role="tab" aria-selected={tab==='search'} onClick={()=>setTab('search')}>장소 검색</button></div>
        {tab==='search'?<div className="tw-search"><label htmlFor="tw-place-search">장소 이름</label><div><input id="tw-place-search" className="text-input" value={query} maxLength={100} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void runSearch();}} placeholder="장소 이름이나 주소"/><Button variant="secondary" disabled={busy} onClick={()=>void runSearch()}>검색</Button></div>{results.map(item=><article className="tw-search-result" key={item.contentid}><strong>{item.title}</strong><small>{item.address??item.category??'상세 정보 없음'}</small><Button variant="secondary" disabled={busy} onClick={()=>void chooseSummary(item)}>일정에 추가</Button></article>)}</div>:<div className="tw-search">{aiPlace&&<article className="tw-search-result is-recommended"><small>AI 추천 · 검토 후 추가</small><strong>{aiPlace.title}</strong><small>{aiPlace.address??aiPlace.category??'상세 미확인'}</small></article>}{aiAlternatives.map(place=><article className="tw-search-result" key={place.contentid}><small>대체 후보</small><strong>{place.title}</strong><small>{place.address??place.category??'상세 미확인'}</small><Button variant="secondary" onClick={()=>addPlace(place)}>일정에 추가</Button></article>)}{!aiPlace&&!aiAlternatives.length&&<p>추천 결과가 여기에 표시돼요.</p>}</div>}
        </>}
        {selectedModel?.kind==='place'&&<PlaceInspector node={selectedModel} detail={placeDetails.get(selectedModel.contentid)} places={placeDetails} days={doc?.days??[]} nodes={board.nodes.map(n=>n.data.model)} edges={doc?.edges??[]} onColor={color=>editNode(selectedModel.id,m=>({...m,color}))} onMove={next=>moveNode(selectedModel.id,next)} onConnect={target=>connect({source:selectedModel.id,target})} onDisconnect={()=>publish(board.nodes,board.edges.filter(e=>e.source!==selectedModel.id&&e.target!==selectedModel.id),'이 장소의 연결을 끊었어요.')}/>}
        {selectedModel?.kind==='comment'&&<section className="tw-inspector"><CanvasCommentEditor key={selectedModel.id} tripId={tripId} node={selectedModel} onCommit={(text,expectedText,force)=>sync.update(current=>({...current,nodes:current.nodes.map(node=>node.id===selectedModel.id&&node.kind==='comment'&&(force||node.text===expectedText)?{...node,text}:node)}))}/><label htmlFor="tw-comment-day">여행 날짜</label><select id="tw-comment-day" className="text-input" value={selectedModel.dayId} onChange={e=>moveNode(selectedModel.id,e.target.value)}>{doc?.days.map((item,index)=><option key={item.id} value={item.id}>{item.date??`${index+1}일차`}</option>)}</select><ColorPicker value={selectedModel.color} onChange={color=>editNode(selectedModel.id,m=>({...m,color}))}/><Button variant="secondary" onClick={remove}>댓글 삭제</Button></section>}
      </aside>}
    </div>
  </section>;
}

function ColorPicker({value,onChange}:{value:CanvasColor;onChange:(color:CanvasColor)=>void}){return <fieldset className="tw-color-picker"><legend>카드 색상</legend>{colorOptions.map(([color,label])=><button type="button" key={color} className={`color-${color} ${value===color?'is-selected':''}`} aria-pressed={value===color} onClick={()=>onChange(color)}>{label}</button>)}</fieldset>;}
function PlaceInspector({node,detail,places,days,nodes,edges,onColor,onMove,onConnect,onDisconnect}:{node:CanvasPlaceNode;detail?:CanvasPlaceDetail;places:Map<number,CanvasPlaceDetail>;days:CanvasDocument['days'];nodes:CanvasNode[];edges:CanvasDocument['edges'];onColor:(color:CanvasColor)=>void;onMove:(dayId:string)=>void;onConnect:(id:string)=>void;onDisconnect:()=>void}){const[target,setTarget]=useState('');const nodeDays=new Map(nodes.filter((item):item is CanvasPlaceNode=>item.kind==='place').map(item=>[item.id,item.dayId]));const options=nodes.filter((item):item is CanvasPlaceNode=>item.kind==='place'&&canConnectRoute(node.id,item.id,nodeDays,edges));return <section className="tw-inspector"><h3>{detail?.title??'장소 정보 확인 중'}</h3><p>{detail?.address??detail?.adminCity??'주소 미확인'}</p><dl>{([['종류',detail?.category],['설명',detail?.overviewText],['메뉴',detail?.menuText],['운영 시간',detail?.openingHoursText],['휴무일',detail?.closedDaysText],['요금',detail?.feeText],['예약',detail?.bookingText],['주차',detail?.parkingText],['전화',detail?.tel]] as Array<[string,string|null|undefined]>).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'정보 없음'}</dd></div>)}</dl>{detail?.homepageUrl&&<a href={detail.homepageUrl} target="_blank" rel="noreferrer">공식 홈페이지</a>}<label htmlFor="tw-move-day">여행 날짜</label><select id="tw-move-day" className="text-input" value={node.dayId} onChange={e=>onMove(e.target.value)}>{days.map((day,index)=><option key={day.id} value={day.id}>{day.date??`${index+1}일차`}</option>)}</select><label htmlFor="tw-connect-target">다음 방문 장소 연결</label><select id="tw-connect-target" className="text-input" value={target} onChange={e=>setTarget(e.target.value)}><option value="">장소 선택</option>{options.map(item=><option key={item.id} value={item.id}>{item.kind==='place'?places.get(item.contentid)?.title??'장소 정보 확인 중':'장소'}</option>)}</select><Button variant="secondary" disabled={!target} onClick={()=>{onConnect(target);setTarget('');}}>연결 추가</Button><ColorPicker value={node.color} onChange={onColor}/><Button variant="secondary" onClick={onDisconnect}>이 장소 연결 끊기</Button></section>;}
