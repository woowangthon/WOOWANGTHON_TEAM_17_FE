import test from 'node:test';
import assert from 'node:assert/strict';
import { canConnectRoute, parseCanvasDocument, mergeCanvasDocuments, getDayLinks, moveDayFrame, connectDayFrames, disconnectDayFrames } from '../src/features/workspace/canvasModel.ts';

const ids = { day:'00000000-0000-0000-0000-000000000001', a:'00000000-0000-0000-0000-000000000002', b:'00000000-0000-0000-0000-000000000003', c:'00000000-0000-0000-0000-000000000004', edge:'00000000-0000-0000-0000-000000000005' };
const document = () => ({ schemaVersion:3, days:[{id:ids.day,date:null}], nodes:['a','b','c'].map((key,index)=>({id:ids[key],kind:'place',dayId:ids.day,position:{x:index*200,y:30},color:'default',contentid:index+1,intent:'candidate'})), edges:[] });
const days = new Map([['a',1],['b',1],['c',1],['candidate',1],['tomorrow',2]]);

test('a free candidate can join either end of the daily route without modifying existing edges',()=>{
  const edges=[{source:'a',target:'b'}]; assert.equal(canConnectRoute('b','candidate',days,edges),true); assert.equal(canConnectRoute('candidate','a',days,edges),true); assert.deepEqual(edges,[{source:'a',target:'b'}]);
});
test('route connection rejects cycles, branches, self connections and cross-day connections',()=>{
  const edges=[{source:'a',target:'b'},{source:'b',target:'c'}]; for(const [source,target] of [['c','a'],['a','candidate'],['candidate','b'],['a','a'],['c','tomorrow'],['missing','candidate']]) assert.equal(canConnectRoute(source,target,days,edges),false,`${source} -> ${target}`);
});
test('v3 parser preserves allowlisted nodes and strict graph constraints',()=>{
  const raw=document();raw.nodes[1].kind='comment';raw.nodes[1].text='회의 장소로도 검토';delete raw.nodes[1].contentid;delete raw.nodes[1].intent;
  raw.edges.push({id:ids.edge,source:ids.a,target:ids.c}); const parsed=parseCanvasDocument(raw);assert.ok(parsed);assert.equal(parsed.nodes[1].kind,'comment');assert.equal(parsed.edges.length,1);
  const unknown=document();unknown.nodes[0].meta='not allowed';assert.equal(parseCanvasDocument(unknown),null);
});
test('v3 parser rejects malformed UUIDs, invalid dates without throwing, duplicate dates, controls and oversized JSON',()=>{
  const invalids=[];let x=document();x.days[0].date='2026-99-99';invalids.push(x);x=document();x.days[0].id='abcdefab-cdef-abcd-efab-cdefabcdefab'.toUpperCase();invalids.push(x);x=document();x.days.push({id:'00000000-0000-0000-0000-000000000006',date:null});x.days[0].date='2026-11-10';x.days[1].date='2026-11-10';invalids.push(x);x=document();x.nodes[0].text='';invalids.push(x);x=document();x.nodes[0].unknown='x'.repeat(200_001);invalids.push(x);
  for(const value of invalids) assert.doesNotThrow(()=>assert.equal(parseCanvasDocument(value),null));
  const comment=document();comment.nodes[0]={id:ids.a,kind:'comment',dayId:ids.day,position:{x:0,y:0},color:'default',text:'탭\t은 금지'};assert.equal(parseCanvasDocument(comment),null);
});
test('three way merge keeps disjoint node field edits and reports overlap',()=>{
  const base=document();const local=structuredClone(base);local.nodes[0].position.x=22;const remote=structuredClone(base);remote.nodes[1].color='lime';const merged=mergeCanvasDocuments(base,local,remote);assert.equal(merged.conflicts.length,0);assert.equal(merged.document.nodes[0].position.x,22);assert.equal(merged.document.nodes[1].color,'lime');
  const overlap=structuredClone(remote);overlap.nodes[0].position.x=33;const conflicted=mergeCanvasDocuments(base,local,overlap);assert.equal(conflicted.document,null);assert.ok(conflicted.conflicts.some(value=>value.includes('.position')));
});

test('day frame edits upgrade v3 to v4 and preserve explicit empty day links',()=>{
  const base=document();const defaults=getDayLinks(base);assert.deepEqual(defaults,[]);
  const moved=moveDayFrame(base,ids.day,{x:-120,y:48});assert.equal(moved.schemaVersion,4);assert.deepEqual(moved.days[0].position,{x:-120,y:48});assert.deepEqual(moved.dayLinks,[]);
  const second='00000000-0000-0000-0000-000000000006';const expanded={...base,days:[...base.days,{id:second,date:null}]};
  const promoted=moveDayFrame(expanded,ids.day,{x:8,y:8});const linked=connectDayFrames(promoted,second,ids.day);assert.equal(linked.schemaVersion,4);assert.equal(linked.dayLinks.length,2);assert.match(linked.dayLinks[1].id,/^[0-9a-f-]{36}$/u);
  assert.equal(connectDayFrames(linked,second,ids.day),null);assert.equal(connectDayFrames(linked,second,second),null);
  const removed=disconnectDayFrames(linked,linked.dayLinks[0].id);assert.equal(removed.dayLinks.length,1);
  const removedLast=disconnectDayFrames(removed,removed.dayLinks[0].id);assert.deepEqual(removedLast.dayLinks,[]);assert.deepEqual(getDayLinks(removedLast),[]);
  assert.deepEqual(base.days[0],{id:ids.day,date:null},'an edit does not mutate the prior v3 document');
});

test('v4 parser validates day positions and directed links strictly',()=>{
  const raw={...document(),schemaVersion:4,dayLinks:[]};raw.days[0].position={x:-100,y:240};assert.ok(parseCanvasDocument(raw));
  const invalid=[];let value=structuredClone(raw);value.days[0].position={x:Infinity,y:0};invalid.push(value);
  value=structuredClone(raw);value.dayLinks=[{id:ids.edge,source:ids.day,target:ids.day}];invalid.push(value);
  value=structuredClone(raw);value.days.push({id:'00000000-0000-0000-0000-000000000006',date:null});value.dayLinks=[{id:ids.edge,source:ids.day,target:value.days[1].id},{id:'00000000-0000-0000-0000-000000000007',source:ids.day,target:value.days[1].id}];invalid.push(value);
  for(const item of invalid)assert.equal(parseCanvasDocument(item),null);
});

test('v4 link lists follow the shared 500-link limit',()=>{
  const source='00000000-0000-0000-0000-000000000008';const target='00000000-0000-0000-0000-000000000009';
  const saturated={...document(),schemaVersion:4,days:[{id:source,date:null},{id:target,date:null}],dayLinks:Array.from({length:500},(_,index)=>({id:`00000000-0000-4000-8000-${String(index+100).padStart(12,'0')}`,source,target:`00000000-0000-0000-0000-${String(index+1000).padStart(12,'0')}`}))};
  assert.equal(connectDayFrames(saturated,source,target),null);
  const oversized={...saturated,dayLinks:[...saturated.dayLinks,{id:'00000000-0000-4000-8000-000000000999',source,target}]};assert.equal(parseCanvasDocument(oversized),null);
});

test('v3 to v4 merge preserves local frame movement and remote link deletion',()=>{
  const base={...document(),days:[...document().days,{id:'00000000-0000-0000-0000-000000000006',date:null}]};
  const local=moveDayFrame(base,ids.day,{x:80,y:-24});
  const remote={schemaVersion:4,days:base.days,nodes:base.nodes,edges:base.edges,dayLinks:[]};
  const merged=mergeCanvasDocuments(base,local,remote);assert.equal(merged.conflicts.length,0);assert.equal(merged.document.schemaVersion,4);assert.deepEqual(merged.document.days[0].position,{x:80,y:-24});assert.deepEqual(merged.document.dayLinks,[]);
  const deleted=remote;const staleCardEdit=structuredClone(base);staleCardEdit.nodes[0].position.x=120;
  const concurrent=mergeCanvasDocuments(base,staleCardEdit,deleted);assert.equal(concurrent.conflicts.length,0);assert.deepEqual(concurrent.document.dayLinks,[]);assert.equal(concurrent.document.nodes[0].position.x,120);
});

test('v4 days without position merge normally and optional node metadata can be removed cleanly',()=>{
  const raw={...document(),schemaVersion:4,dayLinks:[]};
  raw.nodes[0].source={planId:'00000000-0000-0000-0000-000000000010',versionId:'00000000-0000-0000-0000-000000000011',nodeId:'00000000-0000-0000-0000-000000000012'};
  raw.nodes[0].schedule={startAt:null,endAt:null,locked:true};
  assert.equal(Object.hasOwn(raw.days[0],'position'),false);
  const base=parseCanvasDocument(raw);assert.ok(base);assert.equal(Object.hasOwn(base.days[0],'position'),false);
  const local=structuredClone(base);local.nodes[0].color='sky';delete local.nodes[0].source;delete local.nodes[0].schedule;
  const merged=mergeCanvasDocuments(base,local,base);assert.equal(merged.conflicts.length,0);assert.ok(merged.document);
  assert.equal(Object.hasOwn(merged.document.days[0],'position'),false);
  assert.equal(Object.hasOwn(merged.document.nodes[0],'source'),false);
  assert.equal(Object.hasOwn(merged.document.nodes[0],'schedule'),false);
  assert.equal(merged.document.nodes[0].color,'sky');
});
