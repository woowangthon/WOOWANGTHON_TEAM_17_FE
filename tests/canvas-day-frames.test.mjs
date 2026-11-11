import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCanvasDocument } from '../src/features/workspace/canvasModel.ts';
import { canvasDayTone, canvasDocumentPosition, canvasFrameNodePosition, dayLabel, ensureCanvasDateRange, frameForPoint, layoutCanvasDayFrames, materializeProjectedDay, resolveCanvasDrop } from '../src/features/workspace/canvasDayFrames.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const makeDocument = (days, nodes = []) => ({ schemaVersion: 3, days, nodes, edges: [] });

test('a date-less canvas adopts the shared date range and keeps its existing first day ID', () => {
  const document = makeDocument([{ id: id(1), date: null }], [
    { id: id(10), kind: 'place', dayId: id(1), position: { x: 40, y: 80 }, color: 'default', contentid: 10, intent: 'route' },
  ]);
  const dated = ensureCanvasDateRange(document, '2026-11-11', '2026-11-13');
  assert.equal(dated.days[0].id, id(1));
  assert.deepEqual(dated.days.map(day => day.date), ['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.match(dated.days[1].id, /^[0-9a-f-]{36}$/u);
  assert.equal(ensureCanvasDateRange(document, '2026-11-11', '2026-11-13').days[1].id, dated.days[1].id);
  assert.deepEqual(dated.nodes, document.nodes, 'date seeding does not rewrite persisted card positions or ownership');
  assert.equal(document.days[0].date, null);
});

test('imported dates and invalid or oversized ranges are not rewritten', () => {
  const imported = makeDocument([{ id: id(1), date: '2026-11-12' }]);
  assert.equal(ensureCanvasDateRange(imported, '2026-11-11', '2026-11-13', true), imported);
  const empty = makeDocument([{ id: id(2), date: null }]);
  assert.equal(ensureCanvasDateRange(empty, '2026-99-99', '2026-11-13'), empty);
  assert.equal(ensureCanvasDateRange(empty, '2026-01-01', '2026-02-15'), empty);
});

test('date expansion never drops existing undated days or their node ownership', () => {
  const first = id(1); const extra = id(2);
  const document = makeDocument([{ id: first, date: null }, { id: extra, date: null }], [
    { id: id(10), kind: 'comment', dayId: extra, position: { x: 20, y: 100 }, color: 'default', text: 'saved draft' },
  ]);
  const expanded = ensureCanvasDateRange(document, '2026-11-11', '2026-11-11');
  assert.deepEqual(expanded.days, [{ id: first, date: '2026-11-11' }, { id: extra, date: null }]);
  assert.equal(expanded.nodes[0].dayId, extra);
});

test('all day frames remain distinct, wrapped, and preserve bounded node positions', () => {
  const days = Array.from({ length: 7 }, (_, index) => ({ id: id(index + 1), date: null }));
  const nodes = days.map((day, index) => ({ id: id(index + 20), kind: 'place', dayId: day.id, position: { x: index * 5000, y: index * 6000 }, color: 'default', contentid: index, intent: 'route' }));
  const document = makeDocument(days, nodes);
  const frames = layoutCanvasDayFrames(document);
  assert.notDeepEqual(frames.get(id(1)).position, frames.get(id(2)).position);
  assert.ok(frames.get(id(4)).position.y > frames.get(id(1)).position.y);
  for (const node of nodes) {
    const frame = frames.get(node.dayId);
    const displayed = canvasFrameNodePosition(node, frame);
    const restored = canvasDocumentPosition(displayed, frame);
    assert.ok(Math.abs(restored.x - node.position.x) < 0.001);
    assert.ok(Math.abs(restored.y - node.position.y) < 0.001);
    assert.ok(displayed.x >= 0 && displayed.x <= frame.width);
    assert.ok(displayed.y >= 0 && displayed.y <= frame.height);
  }
  const first = nodes[0]; const originalLayout = frames.get(first.dayId);
  const beforeOther = canvasFrameNodePosition(nodes[1], frames.get(nodes[1].dayId));
  const dragged = canvasDocumentPosition({ x: canvasFrameNodePosition(first, originalLayout).x + 90, y: canvasFrameNodePosition(first, originalLayout).y + 20 }, originalLayout);
  const after = { ...first, position: dragged };
  const nextDocument = makeDocument(days, [after, ...nodes.slice(1)]);
  const nextLayout = layoutCanvasDayFrames(nextDocument);
  assert.equal(canvasFrameNodePosition(after, nextLayout.get(after.dayId)).x, canvasFrameNodePosition(first, originalLayout).x + 90);
  assert.deepEqual(canvasFrameNodePosition(nodes[1], nextLayout.get(nodes[1].dayId)), beforeOther);
  const point = frames.get(id(5)).position;
  assert.equal(frameForPoint(frames, point)?.dayId, id(5));
});

test('measured sizes and negative node coordinates stay inside day frame bounds without rewriting document positions', () => {
  const day = id(1);
  const place = { id: id(20), kind: 'place', dayId: day, position: { x: -80, y: -120 }, color: 'default', contentid: 20, intent: 'route' };
  const comment = { id: id(21), kind: 'comment', dayId: day, position: { x: 240, y: 180 }, color: 'default', text: 'a long saved note' };
  const document = makeDocument([{ id: day, date: null }], [place, comment]);
  const before = structuredClone(document);
  const measured = new Map([[place.id, { width: 320, height: 248 }], [comment.id, { width: 400, height: 980 }]]);
  const frame = layoutCanvasDayFrames(document, measured).get(day);

  assert.deepEqual(frame.origin, { x: -102, y: -214 });
  assert.ok(frame.width >= 764);
  assert.ok(frame.height >= 1396);
  for (const [node, size] of [[place, measured.get(place.id)], [comment, measured.get(comment.id)]]) {
    const local = canvasFrameNodePosition(node, frame);
    assert.ok(local.x >= 0 && local.y >= 0);
    assert.ok(local.x + size.width <= frame.width);
    assert.ok(local.y + size.height <= frame.height);
    assert.deepEqual(canvasDocumentPosition(local, frame), node.position);
  }
  assert.deepEqual(document, before, 'layout only measures; it never rewrites saved card coordinates');
});

test('long comments get conservative initial bounds and one-card drags remain visible', () => {
  const day = id(1);
  const comment = { id: id(30), kind: 'comment', dayId: day, position: { x: 120, y: 80 }, color: 'default', text: '여'.repeat(1000) };
  const document = makeDocument([{ id: day, date: null }], [comment]);
  const initial = layoutCanvasDayFrames(document).get(day);
  assert.ok(initial.height > 1200, 'estimate accounts for wrapping a maximum length comment');
  const originalLocal = canvasFrameNodePosition(comment, initial);
  const moved = { ...comment, position: { x: comment.position.x + 100, y: comment.position.y + 60 } };
  const afterDrag = layoutCanvasDayFrames(makeDocument(document.days, [moved])).get(day);
  const movedLocal = canvasFrameNodePosition(moved, afterDrag);
  assert.deepEqual(movedLocal, { x: originalLocal.x + 100, y: originalLocal.y + 60 });
  assert.deepEqual(document.nodes[0].position, { x: 120, y: 80 }, 'dragged copy does not mutate the prior document');
});

test('measured-size changes expand frames without changing the position mapping', () => {
  const day = id(1);
  const node = { id: id(40), kind: 'place', dayId: day, position: { x: 180, y: 140 }, color: 'default', contentid: 40, intent: 'route' };
  const document = makeDocument([{ id: day, date: null }], [node]);
  const compact = layoutCanvasDayFrames(document, new Map([[node.id, { width: 224, height: 160 }]])).get(day);
  const expanded = layoutCanvasDayFrames(document, new Map([[node.id, { width: 360, height: 440 }]])).get(day);
  assert.deepEqual(canvasFrameNodePosition(node, compact), canvasFrameNodePosition(node, expanded));
  assert.ok(expanded.width > compact.width);
  assert.ok(expanded.height > compact.height);
});

test('31 chronological day frames retain order and route connectors through row gutters', () => {
  const days = Array.from({ length: 31 }, (_, index) => ({ id: id(index + 1), date: `2026-11-${String(index + 1).padStart(2, '0')}` }));
  const nodes = days.map((day, index) => ({
    id: id(index + 100), kind: index % 4 === 0 ? 'comment' : 'place', dayId: day.id,
    position: { x: index % 3 === 0 ? -40 : index * 18, y: index % 7 === 0 ? -24 : index * 14 }, color: 'default',
    ...(index % 4 === 0 ? { text: `날짜 ${index + 1} 메모\n${'추가 내용 '.repeat(index % 5 + 1)}` } : { contentid: index + 1, intent: 'route' }),
  }));
  const sizes = new Map(nodes.map((node, index) => [node.id, { width: 220 + index % 4 * 32, height: 144 + index % 6 * 28 }]));
  const frames = layoutCanvasDayFrames(makeDocument(days, nodes), sizes);
  assert.deepEqual([...frames.keys()], days.map(day => day.id));
  assert.equal([...frames.values()].filter(frame => frame.connectorToNext).length, 30);
  assert.ok(frames.get(id(4)).position.y > frames.get(id(1)).position.y);
  for (let index = 0; index < days.length - 1; index += 1) {
    const frame = frames.get(days[index].id);
    const next = frames.get(days[index + 1].id);
    assert.ok(frame.connectorToNext);
    const points = frame.connectorToNext.points;
    if (Math.floor(index / 3) !== Math.floor((index + 1) / 3)) {
      assert.equal(points.length, 4, `day ${index + 1} wraps into the next row`);
      assert.ok(points[1].y > frame.position.y + frame.height);
      assert.ok(points[1].y < next.position.y);
      assert.equal(points[2].x, next.position.x + next.width / 2);
    } else {
      assert.equal(points.length, 2, `day ${index + 1} connects across its column gutter`);
      assert.equal(points[0].x, frame.position.x + frame.width);
      assert.equal(points[1].x, next.position.x);
    }
  }
});

test('a drop into another bounded day frame changes ownership and returns local coordinates', () => {
  const days = [{ id: id(1), date: '2026-11-11' }, { id: id(2), date: '2026-11-12' }];
  const frames = layoutCanvasDayFrames(makeDocument(days));
  const target = frames.get(id(2));
  const dropped = resolveCanvasDrop({ x: target.position.x + 180, y: target.position.y + 190 }, frames, id(1));
  assert.deepEqual(dropped, { dayId: id(2), position: { x: 158, y: 96 } });
  assert.equal(resolveCanvasDrop({ x: -100, y: -100 }, frames, id(1)).dayId, id(1));
});

test('day labels show chronological trip day and concise month/day', () => {
  assert.equal(dayLabel({ id: id(1), date: '2026-11-06' }, 0), '1일차 · 11월 6일');
  assert.equal(dayLabel({ id: id(2), date: null }, 1), '2일차');
});

test('an imported three-place row projects cards to a balanced two over one layout with an inverse',()=>{
  const days=[{id:id(1),date:null}];
  const source={planId:id(70),versionId:id(71),nodeId:id(72)};
  const nodes=[
    {id:id(40),kind:'place',dayId:days[0].id,position:{x:100,y:100},color:'default',contentid:1,intent:'route',source:{...source,nodeId:id(72)},schedule:{startAt:null,endAt:null,locked:true}},
    {id:id(41),kind:'place',dayId:days[0].id,position:{x:370,y:100},color:'default',contentid:2,intent:'route',source:{...source,nodeId:id(73)},schedule:{startAt:null,endAt:null,locked:true}},
    {id:id(42),kind:'place',dayId:days[0].id,position:{x:370,y:285},color:'default',contentid:3,intent:'route',source:{...source,nodeId:id(74)},schedule:{startAt:null,endAt:null,locked:true}},
  ];
  const sizes=new Map([[id(40),{width:300,height:220}],[id(41),{width:380,height:520}],[id(42),{width:560,height:320}]]);
  const frame=layoutCanvasDayFrames(makeDocument(days,nodes),sizes).get(days[0].id);
  const [first,second,third]=nodes.map(node=>canvasFrameNodePosition(node,frame));
  assert.equal(first.y,second.y);assert.ok(third.y>first.y);
  assert.ok(Math.abs((third.x+sizes.get(id(42)).width/2)-((first.x+second.x+sizes.get(id(41)).width)/2))<=1,'bottom place is centered under the top row');
  assert.ok(third.y>=first.y+sizes.get(id(40)).height+28,'bottom row clears the taller top card');
  assert.ok(first.x>=0&&first.y>=72);
  const moved=canvasDocumentPosition({x:third.x+10,y:third.y},frame,nodes[2]);assert.deepEqual(moved,{x:84,y:548},'inverse materializes the bottom card display position plus the 10px drag');
  const original=makeDocument(days,nodes);
  const materialized=materializeProjectedDay(original,days[0].id,sizes,nodes[2].id);
  const dragged={...materialized,nodes:materialized.nodes.map(node=>node.id===nodes[2].id?{...node,position:moved}:node)};
  const saved=parseCanvasDocument(dragged);assert.ok(saved);
  const stableFrame=layoutCanvasDayFrames(saved,sizes).get(days[0].id);
  assert.deepEqual(canvasFrameNodePosition(saved.nodes[0],stableFrame),first,'the left card stays put after save');
  assert.deepEqual(canvasFrameNodePosition(saved.nodes[1],stableFrame),second,'the right card stays put after save');
  assert.deepEqual(canvasFrameNodePosition(saved.nodes[2],stableFrame),{x:third.x+10,y:third.y},'the moved bottom card retains its 10px drag after save');
});

test('explicit frame coordinates remain exact while automatic frames avoid them',()=>{
  const days=[{id:id(1),date:null,position:{x:200,y:100}},{id:id(2),date:null},{id:id(3),date:null}];
  const frames=layoutCanvasDayFrames(makeDocument(days));
  assert.deepEqual(frames.get(id(1)).position,{x:200,y:100});
  const a=frames.get(id(1)),b=frames.get(id(2)),c=frames.get(id(3));
  for(const [left,right] of [[a,b],[a,c],[b,c]])assert.ok(left.position.x+left.width+36<=right.position.x||right.position.x+right.width+36<=left.position.x||left.position.y+left.height+36<=right.position.y||right.position.y+right.height+36<=left.position.y);
});

test('day tones are stable across renders and stay within the six approved accents',()=>{
  const tones=['lime','sky','rose','amber','sage','lavender'];
  assert.ok(tones.includes(canvasDayTone(id(1))));assert.equal(canvasDayTone(id(1)),canvasDayTone(id(1)));
  assert.deepEqual(new Set(Array.from({length:6},(_,index)=>canvasDayTone(id(index+1)))).size,6);
});
