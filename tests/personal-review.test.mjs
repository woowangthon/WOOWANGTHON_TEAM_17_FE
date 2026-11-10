import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyReviewChoices, getReviewIssues, restoreReviewChoices } from '../src/features/generation/personalReviewModel.ts';

function dto(terms, unmapped = [], review = null) {
  return {
    conditionsVersion: 3, preferenceVersion: 5, catalogDigest: 'catalog', reviewVersion: 1,
    stale: false,
    normalization: { id: 'norm', terms, unmapped, walking: { maxMinutes: 20, unlimited: false }, needsReview: true },
    review,
  };
}

test('shows the missing avoid condition from the reported one-person case', () => {
  const data = dto(
    [{ id: 't0', field: 'likes', tag: '자연', polarity: 'prefer', importance: 'preferred', evidence: '자연' }],
    [
      { field: 'likes', text: '좋아하는 자연', importance: 'preferred', reason: 'coverage_unverified' },
      { field: 'avoid', text: '멀리 걷는 것은 싫어요', importance: 'preferred', reason: 'uncovered' },
    ],
  );
  const choices = { ...emptyReviewChoices, likes: { scope: 'all', fully: true } };
  const issues = getReviewIssues(data, ['t0'], choices);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /피하고 싶은 항목에 적용할 수 있는 태그가 없어/);
});

test('requires an accepted tag and full meaning confirmation for every tagged field', () => {
  const data = dto([
    { id: 't0', field: 'likes', tag: '자연', polarity: 'prefer', importance: 'preferred', evidence: '자연' },
    { id: 't1', field: 'food', tag: '채식', polarity: 'prefer', importance: 'preferred', evidence: '채식' },
  ]);
  const choices = { ...emptyReviewChoices, likes: { scope: 'all', fully: true }, food: { scope: 'meal', fully: true } };
  assert.equal(getReviewIssues(data, ['t0'], choices).some((issue) => issue.includes('음식 조건에서 일정에 반영')), true);
  assert.deepEqual(getReviewIssues(data, ['t0', 't1'], choices), []);
});

test('restores saved field scope and full review checkbox after reload', () => {
  const data = dto([], [], {
    acceptedTermIds: ['t0'],
    reviewedFields: [{ field: 'likes', termIds: ['t0'], scope: 'stay', fullyReviewed: true }],
  });
  const restored = restoreReviewChoices(data);
  assert.deepEqual(restored.accepted, ['t0']);
  assert.deepEqual(restored.fields.likes, { scope: 'stay', fully: true });
  assert.deepEqual(restored.fields.food, { scope: 'meal', fully: false });
});

test('a single participant can satisfy personal review; participant count is not part of this check', () => {
  const data = dto([{ id: 't0', field: 'avoid', tag: '짧은 이동', polarity: 'avoid', importance: 'required', evidence: '걷기' }]);
  const choices = { ...emptyReviewChoices, avoid: { scope: 'all', fully: true } };
  assert.deepEqual(getReviewIssues(data, ['t0'], choices), []);
});
