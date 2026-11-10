import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCanvasSave, reserveCanvasSave, resolveCanvasConflict } from '../src/features/workspace/canvasSyncModel.ts';
import { mergeCanvasDocuments } from '../src/features/workspace/canvasModel.ts';

const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const doc=()=>({schemaVersion:3,days:[{id:id(1),date:null}],nodes:[2,3].map((n,i)=>({id:id(n),kind:'place',dayId:id(1),position:{x:100*i,y:0},color:'default',contentid:n,intent:'candidate'})),edges:[]});
const state=document=>({tripId:id(99),revision:2,document,places:[],sourcePlan:null,updatedAt:'2026-11-11T00:00:00Z'});

test('pending idempotency request retains identical body, revision and key after unknown outcome',()=>{
 const base=doc(),body=structuredClone(base);body.nodes[0].position.x=12;const request=reserveCanvasSave(null,body,1,base);const retry=reserveCanvasSave(request,doc(),9,doc());assert.equal(retry,request);assert.equal(retry.key,request.key);assert.equal(retry.revision,1);assert.deepEqual(retry.body,body);
});
test('an edit made while save is in flight survives the acknowledgement for the sent snapshot',()=>{
 const base=doc(),sent=structuredClone(base);sent.nodes[0].position.x=15;const request={body:sent,revision:1,key:id(77),base};const saved=state(sent);const afterSend=structuredClone(sent);afterSend.nodes[1].color='sky';const merged=reconcileCanvasSave(request,afterSend,saved);assert.equal(merged.conflicts.length,0);assert.equal(merged.document.nodes[0].position.x,15);assert.equal(merged.document.nodes[1].color,'sky');
});
test('explicit local conflict choice preserves disjoint remote edits',()=>{
 const base=doc(),local=structuredClone(base),remote=structuredClone(base);local.nodes[0].position.x=30;remote.nodes[1].color='rose';remote.nodes[0].position.x=45;const merged=resolveCanvasConflict(base,local,remote,'local');assert.equal(merged.conflicts.length,0);assert.equal(merged.document.nodes[0].position.x,30);assert.equal(merged.document.nodes[1].color,'rose');
});
test('undoing an acknowledged move preserves another participant edit to a different node',()=>{
 const before=doc(),after=structuredClone(before),remote=structuredClone(before);after.nodes[0].position.x=44;remote.nodes[1].color='lime';const undo=resolveCanvasConflict(after,before,remote,'local');assert.equal(undo.conflicts.length,0);assert.equal(undo.document.nodes[0].position.x,before.nodes[0].position.x);assert.equal(undo.document.nodes[1].color,'lime');
});
test('undo is blocked when another participant changed the same moved position',()=>{
 const before=doc(),after=structuredClone(before),remote=structuredClone(before);after.nodes[0].position.x=44;remote.nodes[0].position.x=55;const safeUndo=mergeCanvasDocuments(after,before,remote);assert.equal(safeUndo.document,null);assert.ok(safeUndo.conflicts.some(path=>path.includes('position')));
});
