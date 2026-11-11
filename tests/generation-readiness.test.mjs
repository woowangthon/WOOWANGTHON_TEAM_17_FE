import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePreparationReadiness } from '../src/features/generation/generationReadiness.ts';

test('CTA readiness exposes expected vs active members and confirmed count without mislabeling the cause', () => {
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
  assert.deepEqual(summary.blockers, ['현재 참여 인원과 예정 인원을 맞춰 주세요.', '모든 참여자가 내 취향에서 ‘준비 완료’를 눌러야 해요.']);
  assert.equal(summary.blockers.some(text => text.includes('기본조건')), false);
});

test('conditions are called incomplete only when the API reports that specific reason', () => {
  const summary = summarizePreparationReadiness({ expectedPeople: 2, activeMemberCount: 2,
    members: [{ id: 'a', nickname: 'A', preparationStatus: 'confirmed' }],
    reasons: [{ code: 'CONDITIONS_INCOMPLETE' }], conditionsReady: false });
  assert.deepEqual(summary.blockers, ['여행 날짜와 예산 등 공통 기본조건을 완성해 주세요.']);
});
