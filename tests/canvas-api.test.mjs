import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCanvasState, getCanvas, importPlanToCanvas, saveCanvas } from '../src/features/workspace/canvasApi.ts';

const fixture={tripId:'10000000-0000-4000-8000-000000000001',revision:1,document:{schemaVersion:3,days:[{id:'20000000-0000-4000-8000-000000000001',date:'2026-11-11'}],nodes:[{id:'30000000-0000-4000-8000-000000000001',kind:'place',dayId:'20000000-0000-4000-8000-000000000001',position:{x:40,y:80},color:'lime',contentid:101,intent:'candidate'},{id:'30000000-0000-4000-8000-000000000002',kind:'comment',dayId:'20000000-0000-4000-8000-000000000001',position:{x:400,y:80},color:'amber',text:'공유 댓글\n오프라인 테스트'}],edges:[]},places:[{contentid:101,title:'테스트 장소',address:null,adminCity:null,category:null,planningRole:null,coordinate:null,overviewText:null,menuText:null,openingHoursText:null,closedDaysText:null,feeText:null,bookingText:null,parkingText:null,tel:null,homepageUrl:null}],sourcePlan:null,updatedAt:'2026-11-11T00:00:00.000Z'};
test('canvas response parser accepts the shared BE v3 place and comment fixture',()=>{
 const state=parseCanvasState(fixture);assert.ok(state);assert.equal(state.document.nodes[1].kind,'comment');assert.equal(state.document.nodes[0].contentid,101);assert.equal(state.places[0].address,null);
});
test('place stay estimate is optional, bounded, and never treated as a route duration',()=>{
 const updated=structuredClone(fixture);updated.places[0].estimatedStayMinutes=75;assert.equal(parseCanvasState(updated)?.places[0].estimatedStayMinutes,75);
 const legacy=parseCanvasState(fixture);assert.equal(legacy?.places[0].estimatedStayMinutes,undefined);
 for(const invalid of [0,-1,1441,1.5,'60']){const bad=structuredClone(fixture);bad.places[0].estimatedStayMinutes=invalid;assert.equal(parseCanvasState(bad),null);}
});
test('place first image and nullable price label are optional, validated, and HTTP-only',()=>{
 const enriched=structuredClone(fixture);enriched.places[0].firstimage='https://images.example/place.jpg';enriched.places[0].priceLabel='1인 1박 기준';const parsed=parseCanvasState(enriched);assert.equal(parsed?.places[0].imageUrl,'https://images.example/place.jpg');assert.equal(parsed?.places[0].priceLabel,'1인 1박 기준');
 const nullable=structuredClone(fixture);nullable.places[0].imageUrl=null;nullable.places[0].priceLabel=null;assert.equal(parseCanvasState(nullable)?.places[0].priceLabel,null);
 const unsafe=structuredClone(fixture);unsafe.places[0].imageUrl='data:image/png;base64,AAA';assert.equal(parseCanvasState(unsafe)?.places[0].imageUrl,null);
 const invalid=structuredClone(fixture);invalid.places[0].priceLabel=8;assert.equal(parseCanvasState(invalid),null);
 assert.equal(parseCanvasState(fixture)?.places[0].imageUrl,undefined,'older place payloads remain supported');
});
test('canvas response parser rejects cross-room, unknown document fields, invalid date and non-HTTP homepage values',async()=>{
 const wrongRoom=structuredClone(fixture);wrongRoom.tripId='10000000-0000-4000-8000-000000000002';await assert.rejects(getCanvas(fixture.tripId,{fetcher:async()=>new Response(JSON.stringify(wrongRoom),{status:200})}),/캔버스 응답/u);const unknown=structuredClone(fixture);unknown.document.untrusted=true;assert.equal(parseCanvasState(unknown),null);const badDate=structuredClone(fixture);badDate.document.days[0].date='2026-02-31';assert.equal(parseCanvasState(badDate),null);const badUrl=structuredClone(fixture);badUrl.places[0].homepageUrl='javascript:alert(1)';assert.equal(parseCanvasState(badUrl)?.places[0].homepageUrl,null);
});
test('GET canvas uses the shared trip endpoint, credentials and no-store cache',async()=>{
 let call;const fetcher=async(path,init)=>{call={path,init};return new Response(JSON.stringify(fixture),{status:200,headers:{'Content-Type':'application/json'}});};const state=await getCanvas(fixture.tripId,{fetcher});assert.equal(state.revision,1);assert.equal(call.path,`/api/v1/trips/${fixture.tripId}/canvas`);assert.equal(call.init.credentials,'include');assert.equal(call.init.cache,'no-store');assert.equal(call.init.headers.get('X-Canvas-Version'),'4');
});
test('plan import sends version, current revision and stable idempotency key and preserves source metadata',async()=>{
 const planId='40000000-0000-4000-8000-000000000001';const versionId='50000000-0000-4000-8000-000000000001';const key='60000000-0000-4000-8000-000000000001';const result=structuredClone(fixture);result.revision=2;result.sourcePlan={planId,versionId};result.document.nodes[0].source={planId,versionId,nodeId:'70000000-0000-4000-8000-000000000001'};result.document.nodes[0].schedule={startAt:'2026-11-11T09:00:00Z',endAt:null,locked:true};let call;
 const imported=await importPlanToCanvas(fixture.tripId,planId,versionId,1,key,{fetcher:async(path,init)=>{call={path,init};return new Response(JSON.stringify(result),{status:200});}});
 assert.equal(call.path,`/api/v1/trips/${fixture.tripId}/plans/${planId}/canvas`);assert.equal(call.init.method,'POST');assert.equal(call.init.headers.get('Idempotency-Key'),key);assert.equal(call.init.headers.get('Content-Type'),'application/json');assert.equal(call.init.headers.get('X-Canvas-Version'),'4');assert.deepEqual(JSON.parse(call.init.body),{versionId,expectedCanvasRevision:1});assert.deepEqual(imported.document.nodes[0].source,result.document.nodes[0].source);assert.deepEqual(imported.document.nodes[0].schedule,result.document.nodes[0].schedule);
});

test('canvas save advertises v4 while retaining the idempotency key',async()=>{
 const body=structuredClone(fixture);body.revision=2;let call;
 await saveCanvas(fixture.tripId,1,fixture.document,'60000000-0000-4000-8000-000000000001',{fetcher:async(path,init)=>{call={path,init};return new Response(JSON.stringify(body),{status:200});}});
 assert.equal(call.init.headers.get('X-Canvas-Version'),'4');assert.equal(call.init.headers.get('Idempotency-Key'),'60000000-0000-4000-8000-000000000001');assert.equal(call.init.headers.get('Content-Type'),'application/json');
});

test('schema readiness and legacy downgrade errors have specific actionable messages',async()=>{
 for(const [status,code,phrase] of [[503,'SCHEMA_MIGRATION_REQUIRED','업데이트(005)'],[409,'SCHEMA_VERSION_CONFLICT','새로고침']]){
  await assert.rejects(getCanvas(fixture.tripId,{fetcher:async()=>new Response(JSON.stringify({error:{code}}),{status})}),error=>error.code===code&&error.message.includes(phrase));
 }
});

test('only a rejected v4 canvas write receives the stale local backend repair hint',async()=>{
 const key='60000000-0000-4000-8000-000000000001';
 const v4=structuredClone(fixture.document);v4.schemaVersion=4;v4.dayLinks=[];
 await assert.rejects(saveCanvas(fixture.tripId,1,v4,key,{fetcher:async()=>new Response(JSON.stringify({error:{code:'VALIDATION_ERROR'}}),{status:400})}),error=>error.code==='VALIDATION_ERROR'&&error.message.includes('run.py')&&error.message.includes('보관 중'));
 await assert.rejects(saveCanvas(fixture.tripId,1,fixture.document,key,{fetcher:async()=>new Response(JSON.stringify({error:{code:'VALIDATION_ERROR'}}),{status:400})}),error=>error.code==='VALIDATION_ERROR'&&!error.message.includes('run.py'));
});
