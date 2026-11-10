import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCanvasState, getCanvas, importPlanToCanvas } from '../src/features/workspace/canvasApi.ts';

const fixture={tripId:'10000000-0000-4000-8000-000000000001',revision:1,document:{schemaVersion:3,days:[{id:'20000000-0000-4000-8000-000000000001',date:'2026-11-11'}],nodes:[{id:'30000000-0000-4000-8000-000000000001',kind:'place',dayId:'20000000-0000-4000-8000-000000000001',position:{x:40,y:80},color:'lime',contentid:101,intent:'candidate'},{id:'30000000-0000-4000-8000-000000000002',kind:'comment',dayId:'20000000-0000-4000-8000-000000000001',position:{x:400,y:80},color:'amber',text:'공유 댓글\n오프라인 테스트'}],edges:[]},places:[{contentid:101,title:'테스트 장소',address:null,adminCity:null,category:null,planningRole:null,coordinate:null,overviewText:null,menuText:null,openingHoursText:null,closedDaysText:null,feeText:null,bookingText:null,parkingText:null,tel:null,homepageUrl:null}],sourcePlan:null,updatedAt:'2026-11-11T00:00:00.000Z'};
test('canvas response parser accepts the shared BE v3 place and comment fixture',()=>{
 const state=parseCanvasState(fixture);assert.ok(state);assert.equal(state.document.nodes[1].kind,'comment');assert.equal(state.document.nodes[0].contentid,101);assert.equal(state.places[0].address,null);
});
test('canvas response parser rejects cross-room, unknown document fields, invalid date and non-HTTP homepage values',async()=>{
 const wrongRoom=structuredClone(fixture);wrongRoom.tripId='10000000-0000-4000-8000-000000000002';await assert.rejects(getCanvas(fixture.tripId,{fetcher:async()=>new Response(JSON.stringify(wrongRoom),{status:200})}),/캔버스 응답/u);const unknown=structuredClone(fixture);unknown.document.untrusted=true;assert.equal(parseCanvasState(unknown),null);const badDate=structuredClone(fixture);badDate.document.days[0].date='2026-02-31';assert.equal(parseCanvasState(badDate),null);const badUrl=structuredClone(fixture);badUrl.places[0].homepageUrl='javascript:alert(1)';assert.equal(parseCanvasState(badUrl)?.places[0].homepageUrl,null);
});
test('GET canvas uses the shared trip endpoint, credentials and no-store cache',async()=>{
 let call;const fetcher=async(path,init)=>{call={path,init};return new Response(JSON.stringify(fixture),{status:200,headers:{'Content-Type':'application/json'}});};const state=await getCanvas(fixture.tripId,{fetcher});assert.equal(state.revision,1);assert.equal(call.path,`/api/v1/trips/${fixture.tripId}/canvas`);assert.equal(call.init.credentials,'include');assert.equal(call.init.cache,'no-store');
});
test('plan import sends version, current revision and stable idempotency key and preserves source metadata',async()=>{
 const planId='40000000-0000-4000-8000-000000000001';const versionId='50000000-0000-4000-8000-000000000001';const key='60000000-0000-4000-8000-000000000001';const result=structuredClone(fixture);result.revision=2;result.sourcePlan={planId,versionId};result.document.nodes[0].source={planId,versionId,nodeId:'70000000-0000-4000-8000-000000000001'};result.document.nodes[0].schedule={startAt:'2026-11-11T09:00:00Z',endAt:null,locked:true};let call;
 const imported=await importPlanToCanvas(fixture.tripId,planId,versionId,1,key,{fetcher:async(path,init)=>{call={path,init};return new Response(JSON.stringify(result),{status:200});}});
 assert.equal(call.path,`/api/v1/trips/${fixture.tripId}/plans/${planId}/canvas`);assert.equal(call.init.method,'POST');assert.equal(call.init.headers['Idempotency-Key'],key);assert.deepEqual(JSON.parse(call.init.body),{versionId,expectedCanvasRevision:1});assert.deepEqual(imported.document.nodes[0].source,result.document.nodes[0].source);assert.deepEqual(imported.document.nodes[0].schedule,result.document.nodes[0].schedule);
});
