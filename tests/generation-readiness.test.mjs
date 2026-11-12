import test from 'node:test';
import assert from 'node:assert/strict';
import { readinessMessage, summarizePreparationReadiness } from '../src/features/generation/generationReadiness.ts';

test('readiness counts are informational and do not gate on member mismatch or other members confirmation', () => {
  const summary = summarizePreparationReadiness({
    expectedPeople: 2,
    activeMemberCount: 3,
    members: [
      { id: 'a', nickname: 'A', preparationStatus: 'confirmed' },
      { id: 'b', nickname: 'B', preparationStatus: 'writing' },
      { id: 'c', nickname: 'C', preparationStatus: 'writing' },
    ],
    reasons: [{ code: 'MEMBER_COUNT_MISMATCH' }, { code: 'PREFERENCES_UNCONFIRMED' }],
    conditionsReady: false,
  });
  assert.equal(summary.memberCountLabel, '현재 참여 3명 / 예정 2명');
  assert.equal(summary.confirmedCountLabel, '준비 완료 1/3명');
  assert.deepEqual(summary.blockers, []);
  assert.equal(summary.blockers.some(text => text.includes('기본조건')), false);
});

test('unconfirmed roster entries never become an all-members-ready hook message', () => {
  const summary = summarizePreparationReadiness({ expectedPeople: 4, activeMemberCount: 3,
    members: [{ preparationStatus: 'confirmed' }, { preparationStatus: 'writing' }, { preparationStatus: 'writing' }],
    reasons: [{ code: 'PREFERENCES_UNCONFIRMED' }, { code: 'MEMBER_COUNT_MISMATCH' }], conditionsReady: true });
  assert.deepEqual(summary.blockers, []);
  assert.equal(summary.confirmedCountLabel, '준비 완료 1/3명');
});

test('conditions are called incomplete only when the API reports that specific reason', () => {
  const summary = summarizePreparationReadiness({ expectedPeople: 2, activeMemberCount: 2,
    members: [{ id: 'a', nickname: 'A', preparationStatus: 'confirmed' }],
    reasons: [{ code: 'CONDITIONS_INCOMPLETE' }], conditionsReady: false });
  assert.deepEqual(summary.blockers, ['여행 날짜와 예산 등 공통 기본조건을 완성해 주세요.']);
});

test('generation messages never ask every participant to confirm and explain fixed-window infeasibility', () => {
  const state = { reasons: [{ code: 'PREFERENCES_UNCONFIRMED' }, { code: 'MEMBER_COUNT_MISMATCH' }] };
  const message = readinessMessage(state);
  assert.equal(message.includes('모든 참여자'), false);
  assert.equal(message.includes('예정 인원'), false);
  assert.match(readinessMessage({ reasons: [{ code: 'SCHEDULE_WINDOW_INFEASIBLE' }] }), /활동 종료 시각/);
});
