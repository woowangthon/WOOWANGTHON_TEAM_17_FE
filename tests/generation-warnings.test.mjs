import test from 'node:test';
import assert from 'node:assert/strict';
import { generationNoticeLabels, generationWarningLabel, handoffWarningsForSource, readGenerationPlanWarningCodes } from '../src/features/generation/generationWarnings.ts';

const source = { planId: 'plan-1', versionId: 'version-2' };
const codes = ['REQUESTED_ACTIVITY_UNFULFILLED', 'REQUESTED_FOOD_UNFULFILLED', 'MEAL_SLOT_UNFILLED', 'TRANSFER_TIME_ESTIMATED', 'STAY_TIME_ESTIMATED'];

test('only allowlisted generation warnings survive handoff parsing and notices summarize missed requests', () => {
  const allowed = readGenerationPlanWarningCodes([...codes, 'UNKNOWN', 'MEAL_SLOT_UNFILLED']);
  assert.deepEqual(allowed, codes);
  assert.deepEqual(generationNoticeLabels(allowed), [
    '요청한 활동 일부를 담지 못했어요.',
    '원한 음식을 먹을 곳을 일정에 충분히 담지 못했어요.',
    '일부 식사 시간대에 식당을 배치하지 못했어요.',
  ]);
  assert.equal(generationWarningLabel('TRANSFER_TIME_ESTIMATED'), '일부 이동 시간은 예상값이에요.');
  assert.deepEqual(generationNoticeLabels(['TRANSFER_TIME_ESTIMATED', 'STAY_TIME_ESTIMATED']), []);
});

test('handoff warnings apply only to the matching trip, plan, and shared source version', () => {
  const handoff = { tripId: 'trip-1', ...source, warningCodes: ['REQUESTED_FOOD_UNFULFILLED'] };
  assert.deepEqual(handoffWarningsForSource('trip-1', source, handoff), ['REQUESTED_FOOD_UNFULFILLED']);
  assert.equal(handoffWarningsForSource('trip-2', source, handoff), null);
  assert.equal(handoffWarningsForSource('trip-1', { ...source, versionId: 'version-3' }, handoff), null);
  assert.equal(handoffWarningsForSource('trip-1', source, { ...handoff, warningCodes: undefined }), null);
});
