import test from 'node:test'
import assert from 'node:assert/strict'
import { countValueRepresentedByFrequency, draftChangeInvalidatesAtomicProfile, editAtomicCondition, projectInterpretedWalking } from '../src/features/room/roomData.ts'

const condition = (overrides = {}) => ({
  id: 'ap-1', dimension: 'visit_count', target: '초밥', polarity: 'prefer', priority: 'unspecified', priorityBasis: 'unspecified',
  scope: 'trip', audience: 'personal', frequency: { count: 1, operator: 'exact', period: 'trip' },
  value: 1, unit: '회', approximate: false, evidence: '초밥 한번', origin: 'model', ...overrides,
})

test('frequency corrections sync a redundant count only when the old value and unit match', () => {
  const changed = editAtomicCondition(condition(), { frequency: { count: 2, operator: 'target', period: 'trip' } })
  assert.equal(changed.frequency.count, 2)
  assert.equal(changed.value, 2)
  assert.equal(changed.approximate, true)
  assert.equal(changed.origin, 'user')
  assert.equal(changed.priorityBasis, 'unspecified')
  assert.equal(editAtomicCondition(condition({ unit: '분' }), { frequency: { count: 2 } }).value, 1)
  assert.equal(editAtomicCondition(condition({ value: 4 }), { frequency: { count: 2 } }).value, 4)
})

test('frequency period and exactness keep scope and approximation consistent', () => {
  const day = editAtomicCondition(condition(), { frequency: { period: 'day', operator: 'target' } })
  assert.equal(day.scope, 'day')
  assert.equal(day.approximate, true)
  const trip = editAtomicCondition(condition({ scope: 'day', approximate: true }), { frequency: { period: 'trip', operator: 'exact' } })
  assert.equal(trip.scope, 'trip')
  assert.equal(trip.approximate, false)
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
