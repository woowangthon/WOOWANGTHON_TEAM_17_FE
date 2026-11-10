import test from 'node:test';
import assert from 'node:assert/strict';
import { retainRecommendationRequest } from '../src/features/workspace/canvasRecommendation.ts';

test('unknown recommendation outcome retries the same normalized prompt, day, exclusions and idempotency key',()=>{
 const first=retainRecommendationRequest(null,'아이와 갈 곳','00000000-0000-0000-0000-000000000001',[8,2,8]);const retry=retainRecommendationRequest(first,'다른 프롬프트','00000000-0000-0000-0000-000000000002',[5]);assert.equal(retry,first);assert.deepEqual(retry,{prompt:'아이와 갈 곳',dayId:'00000000-0000-0000-0000-000000000001',exclude:[2,8],key:first.key});
});
test('new recommendation request excludes unique existing signed database ids',()=>{
 const value=retainRecommendationRequest(null,'걷기 편한 장소','00000000-0000-0000-0000-000000000001',[-3,0,-3]);assert.deepEqual(value.exclude,[-3,0]);assert.equal(value.prompt,'걷기 편한 장소');
});
