import test from 'node:test'
import assert from 'node:assert/strict'
import { atomicConditionTags, countValueRepresentedByFrequency, draftChangeInvalidatesAtomicProfile, editAtomicCondition, formatAtomicCondition, isVerbatimEvidence, projectInterpretedWalking, validateUserAtomicCondition } from '../src/features/room/roomData.ts'

const condition = (overrides = {}) => ({
  id: 'ap-1', dimension: 'visit_count', target: '초밥', polarity: 'prefer', priority: 'unspecified', priorityBasis: 'unspecified',
  scope: 'trip', audience: 'personal', frequency: { count: 1, operator: 'exact', period: 'trip' },
  value: 1, unit: '회', approximate: false, evidence: '초밥 한번', origin: 'model', ...overrides,
})

test('frequency operator keeps approximate independent and synchronizes its redundant count value', () => {
  const changed = editAtomicCondition(condition(), { frequency: { count: 2, operator: 'target', period: 'trip' } })
  assert.equal(changed.frequency.count, 2)
  assert.equal(changed.value, 2)
  assert.equal(changed.approximate, false)
  assert.equal(changed.origin, 'user')
  assert.equal(changed.priorityBasis, 'unspecified')
  assert.equal(editAtomicCondition(condition({ unit: '분' }), { frequency: { count: 2 } }).value, 1)
  assert.equal(editAtomicCondition(condition({ value: 4 }), { frequency: { count: 2 } }).value, 4)
})

test('frequency period keeps the established scope projection while approximate stays independent', () => {
  const day = editAtomicCondition(condition(), { frequency: { period: 'day', operator: 'target' } })
  assert.equal(day.scope, 'day')
  assert.equal(day.approximate, false)
  const trip = editAtomicCondition(condition({ scope: 'day', approximate: true }), { frequency: { period: 'trip', operator: 'exact' } })
  assert.equal(trip.scope, 'trip')
  assert.equal(trip.approximate, true)
})

test('condition formatter keeps exact/min/max/target and approximate scope visible in natural Korean', () => {
  assert.equal(formatAtomicCondition(condition({ dimension: 'activity', target: '산', frequency: null, value: null, unit: null })), '산에 가고 싶어요.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'food', target: '초밥', frequency: null, value: null, unit: null })), '초밥을 먹고 싶어요.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'visit_count', target: '방문 장소', scope: 'day', frequency: { count: 3, operator: 'target', period: 'day' }, approximate: true, unit: '곳', value: null })), '하루 방문 장소는 3곳 정도를 원해요.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'meal_plan', target: '아침 점심 저녁', scope: 'day', frequency: { count: 3, operator: 'exact', period: 'day' }, approximate: false, unit: '끼', value: null })), '매일 아침·점심·저녁, 정확히 3끼 식사하고 싶어요.')
  assert.equal((formatAtomicCondition(condition({ frequency: { count: 3, operator: 'target', period: 'day' }, approximate: true, unit: '회' })).match(/정도/gu) ?? []).length, 1)
  assert.equal(formatAtomicCondition(condition({ dimension: 'visit_count', target: '방문 장소', scope: 'segment', polarity: 'prefer', frequency: { count: 3, operator: 'min', period: 'trip' }, approximate: true, unit: '곳', value: null })), '일부 일정에서 방문 장소는 최소 약 3곳을 원해요.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'visit_count', target: '방문 장소', scope: 'day', polarity: 'avoid', frequency: { count: 4, operator: 'max', period: 'day' }, approximate: true, unit: '곳', value: null })), '하루 방문 장소는 최대 약 4곳은 원하지 않아요.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'meal_plan', target: '저녁', polarity: 'avoid', frequency: { count: 1, operator: 'max', period: 'day' }, unit: '끼', value: null })), '매일 저녁, 최대 1끼 식사는 피하고 싶어요.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'meal_plan', target: '아침', polarity: 'limit', frequency: { count: 1, operator: 'max', period: 'day' }, unit: '끼', value: null })), '매일 아침, 최대 1끼로 제한하고 싶어요.')
  assert.deepEqual(atomicConditionTags(condition({ scope: 'unspecified', audience: 'unspecified', priority: 'required' })), ['범위 미정', '대상 미정', '필수'])
})

test('unit-only visit targets and meal counts read correctly in saved review rows', () => {
  const daily = { count: 3, operator: 'target', period: 'day' }
  for (const target of ['곳', '군데']) {
    const visit = condition({ target, frequency: daily, value: null, unit: null, approximate: true })
    assert.equal(formatAtomicCondition(visit), '하루 3곳 정도 방문하고 싶어요.')
  }
  const meals = condition({ dimension: 'meal_plan', target: '아침 점심 저녁', frequency: { ...daily, operator: 'exact' }, value: 3, unit: '번' })
  assert.equal(formatAtomicCondition(meals), '매일 아침·점심·저녁, 정확히 3번 식사하고 싶어요.')
  assert.equal(formatAtomicCondition({ ...meals, polarity: 'limit' }), '매일 아침·점심·저녁, 정확히 3번으로 제한하고 싶어요.')
})

test('coarse walking and other targets use literal summaries without invented verbs or units', () => {
  assert.equal(formatAtomicCondition(condition({ dimension: 'walking', target: '카페', frequency: null, value: null, unit: null })), '카페 · 선호.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'walking', target: '카페', polarity: 'avoid', frequency: null, value: null, unit: null })), '카페 · 회피.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'other', target: '1', frequency: null, value: null, unit: null })), '입력한 값 1 · 선호.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'other', target: '1', polarity: 'limit', frequency: null, value: null, unit: null })), '입력한 값 1 · 제한.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'walking', target: '20', value: 20, unit: '분', frequency: null })), '걷기 20분 · 선호.')
  const saved = condition({ dimension: 'other', target: '1', frequency: null, value: null, unit: null })
  const before = structuredClone(saved)
  formatAtomicCondition(saved)
  assert.deepEqual(saved, before)
})

test('neutral summaries preserve atypical units, operators, scopes, values, and complete source sentences', () => {
  assert.equal(formatAtomicCondition(condition({ dimension: 'other', target: '바다', polarity: 'avoid', frequency: null, value: null, unit: null })), '바다 · 회피.')
  assert.equal(formatAtomicCondition(condition({ dimension: 'other', target: '동네', polarity: 'limit', frequency: null, value: null, unit: null })), '동네 · 제한.')
  assert.equal(formatAtomicCondition(condition({
    dimension: 'other', target: '카페', polarity: 'avoid', scope: 'segment',
    frequency: { count: 2, operator: 'max', period: 'day' }, approximate: true, value: 8, unit: 'km',
  })), '카페 · 회피 · 하루 일부 일정에서 최대 약 2회 · 값 약 8 km.')
  assert.equal(formatAtomicCondition(condition({
    dimension: 'walking', target: '20', polarity: 'prefer',
    frequency: { count: 2, operator: 'exact', period: 'day' }, value: 20, unit: '분',
  })), '걷기 20분 · 선호 · 하루 정확히 2회.')
  assert.equal(formatAtomicCondition(condition({
    dimension: 'walking', target: '오래 걷는 코스는 피하고 싶어요', polarity: 'prefer',
    frequency: null, value: null, unit: null,
  })), '조건 문장 · 오래 걷는 코스는 피하고 싶어요 · 선호.')
})

test('evidence must be nonempty, present verbatim in current source, and at most 1000 characters', () => {
  assert.equal(isVerbatimEvidence('아침 점심 저녁을 먹고 싶어요.', '아침 점심'), true)
  assert.equal(isVerbatimEvidence('아침 점심 저녁을 먹고 싶어요.', '점심, 저녁'), false)
  assert.equal(isVerbatimEvidence('원문', ''), false)
  assert.equal(isVerbatimEvidence(`${'가'.repeat(1001)}`, '가'.repeat(1001)), false)
})

test('editor validation rejects blank, decimal, negative, and out-of-range frequency input without clamping', () => {
  const source = '이번 여행에는 초밥을 먹고 싶어요.'
  const base = condition({ dimension: 'food', target: '초밥', evidence: '초밥을 먹고 싶어요', frequency: { count: 0, operator: 'exact', period: 'trip' } })
  for (const input of ['', '1.5', '-1', '366']) assert.match(validateUserAtomicCondition(base, source, true, input) ?? '', /횟수/u)
  assert.equal(validateUserAtomicCondition({ ...base, frequency: { count: 3, operator: 'exact', period: 'trip' } }, source, true, '3'), null)
  assert.match(validateUserAtomicCondition({ ...base, value: '가'.repeat(161) }, source, true, '0') ?? '', /문자 값/u)
  assert.match(validateUserAtomicCondition({ ...base, unit: '가'.repeat(41) }, source, true, '0') ?? '', /단위/u)
})

test('turning frequency off removes only a redundant matching count value and unit', () => {
  const cleared = editAtomicCondition(condition(), { frequency: null })
  assert.equal(cleared.frequency, null)
  assert.equal(cleared.value, null)
  assert.equal(cleared.unit, null)
  const independent = editAtomicCondition(condition({ value: 3, unit: '분' }), { frequency: null })
  assert.equal(independent.value, 3)
  assert.equal(independent.unit, '분')
})

test('frequency summary suppresses only a matching count value with a count unit', () => {
  assert.equal(countValueRepresentedByFrequency(condition()), true)
  assert.equal(countValueRepresentedByFrequency(condition({ unit: '분' })), false)
  assert.equal(countValueRepresentedByFrequency(condition({ value: 3 })), false)
  assert.equal(countValueRepresentedByFrequency(condition({ frequency: null })), false)
})

test('legacy walking is preserved for v1 only; v2 projects only supported atomic buckets', () => {
  assert.equal(projectInterpretedWalking('20', '', false), '20')
  assert.equal(projectInterpretedWalking('20', '40', false), '40')
  assert.equal(projectInterpretedWalking('20', '', true), '20')
  assert.equal(projectInterpretedWalking('20', '', false, { conditions: [] }), '')
  assert.equal(projectInterpretedWalking('20', '20', false, { conditions: [condition({ dimension: 'walking', value: 30, unit: '분' })] }), '')
  assert.equal(projectInterpretedWalking('20', '', false, { conditions: [condition({ dimension: 'walking', value: 20, unit: '분' })] }), '20')
})

test('only original text changes invalidate an atomic source; legacy corrections remain saveable', () => {
  assert.equal(draftChangeInvalidatesAtomicProfile('originalText'), true)
  for (const key of ['likes', 'avoid', 'avoidImportance', 'food', 'foodImportance', 'walking', 'scheduleItems', 'atomicPreferences']) {
    assert.equal(draftChangeInvalidatesAtomicProfile(key), false)
  }
})
