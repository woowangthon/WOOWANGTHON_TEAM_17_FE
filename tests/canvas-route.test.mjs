import test from 'node:test';
import assert from 'node:assert/strict';
import { canConnectRoute, parseCanvasDocument, mergeCanvasDocuments } from '../src/features/workspace/canvasModel.ts';

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
