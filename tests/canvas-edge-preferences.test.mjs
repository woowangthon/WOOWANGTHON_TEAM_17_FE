import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasEdgeOverrideFromFields, canvasEdgePreferenceStorageKey, getCanvasEdgePreference,
  parseCanvasEdgePreferenceStore, readCanvasEdgePreferenceStore, resolveCanvasEdgeTime,
  setCanvasEdgePreference, writeCanvasEdgePreferenceStore,
} from '../src/features/workspace/canvasEdgePreferences.ts';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const doc=()=>({schemaVersion:3,days:[{id:id(1),date:null}],nodes:[
  {id:id(2),kind:'place',dayId:id(1),position:{x:0,y:0},color:'default',contentid:101,intent:'route'},
  {id:id(3),kind:'place',dayId:id(1),position:{x:200,y:0},color:'default',contentid:202,intent:'route'},
],edges:[{id:id(4),source:id(2),target:id(3)}]});
const edge={id:id(4),source:id(2),target:id(3)};
const fakeStorage=(initial=null)=>{let value=initial;return {getItem:()=>value,setItem:(_key,next)=>{value=next;},value:()=>value};};

test('edge preference keys separate rooms and preview from shared workspace',()=>{
  assert.notEqual(canvasEdgePreferenceStorageKey(id(99),false),canvasEdgePreferenceStorageKey(id(99),true));
  assert.notEqual(canvasEdgePreferenceStorageKey(id(99),false),canvasEdgePreferenceStorageKey(id(98),false));
});

test('stored override follows edge and place identity, and clear removes only that edge',()=>{
  const document=doc();const override={modeOverride:'walk',manualMinutes:35};
  const withOverride=setCanvasEdgePreference(edge,document,{},override);assert.ok(withOverride);
  assert.deepEqual(getCanvasEdgePreference(edge,document,withOverride),{edgeId:id(4),source:id(2),target:id(3),sourceContentid:101,targetContentid:202,...override});
  const changedContent=structuredClone(document);changedContent.nodes[1].contentid=303;
  assert.equal(getCanvasEdgePreference(edge,changedContent,withOverride),null,'replacement location does not inherit a prior override');
  assert.equal(getCanvasEdgePreference({...edge,source:id(3),target:id(2)},document,withOverride),null,'reversed route is a different edge');
  assert.deepEqual(setCanvasEdgePreference(edge,document,withOverride,null),{});
});

test('a mode-only difference requires time, but matching common mode can use its route ETA',()=>{
  const preference={edgeId:id(4),source:id(2),target:id(3),sourceContentid:101,targetContentid:202,modeOverride:'walk',manualMinutes:null};
  assert.deepEqual(resolveCanvasEdgeTime(preference,'car'),{mode:'walk',source:'required',minutes:null});
  assert.deepEqual(resolveCanvasEdgeTime(preference,'walk'),{mode:'walk',source:'common',minutes:null});
  assert.deepEqual(resolveCanvasEdgeTime(null,'transit'),{mode:'transit',source:'common',minutes:null});
  assert.deepEqual(resolveCanvasEdgeTime({...preference,manualMinutes:42},'car'),{mode:'walk',source:'manual',minutes:42});
});

test('form values accept optional modes and integer minutes, rejecting decimals and out-of-range values',()=>{
  assert.deepEqual(canvasEdgeOverrideFromFields('walk','35'),{value:{modeOverride:'walk',manualMinutes:35},error:null});
  assert.deepEqual(canvasEdgeOverrideFromFields('','35'),{value:{modeOverride:null,manualMinutes:35},error:null});
  assert.deepEqual(canvasEdgeOverrideFromFields('',''),{value:null,error:null});
  for(const value of ['0','1.5','-2','1441','abc'])assert.ok(canvasEdgeOverrideFromFields('car',value).error,`reject ${value}`);
  assert.ok(canvasEdgeOverrideFromFields('teleport','').error);
});

test('storage reads tolerate invalid saved records and surface denied storage',()=>{
  const docValue=doc();const store=setCanvasEdgePreference(edge,docValue,{}, {modeOverride:'charter',manualMinutes:null});
  const storage=fakeStorage(JSON.stringify({version:1,edges:store}));
  const loaded=readCanvasEdgePreferenceStore(storage,'key');assert.equal(loaded.error,null);assert.deepEqual(loaded.store,store);
  assert.deepEqual(parseCanvasEdgePreferenceStore({version:2,edges:store}),{});
  assert.deepEqual(parseCanvasEdgePreferenceStore({version:1,edges:{[id(4)]:{...store[id(4)],targetContentid:'wrong'}}}),{});
  const denied={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  assert.ok(readCanvasEdgePreferenceStore(denied,'key').error);
  assert.equal(writeCanvasEdgePreferenceStore(denied,'key',store),false);
});
