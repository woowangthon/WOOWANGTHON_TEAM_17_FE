import test from 'node:test'
import assert from 'node:assert/strict'
import {
  initialConditionsNoticeState,
  transitionConditionsNotice,
} from '../src/features/personal/conditionsChangedNotice.ts'

const observe = (state, conditionsVersion) => transitionConditionsNotice(state, { type: 'observe', conditionsVersion })
const confirm = (state, conditionsVersion) => transitionConditionsNotice(state, { type: 'confirmed', conditionsVersion })

test('the first observation and the first saved version establish a quiet baseline', () => {
  assert.deepEqual(observe(initialConditionsNoticeState, 0), { observedVersion: 0, pendingVersion: null })
  assert.deepEqual(observe({ observedVersion: 0, pendingVersion: null }, 1), { observedVersion: 1, pendingVersion: null })
  assert.deepEqual(observe(initialConditionsNoticeState, 4), { observedVersion: 4, pendingVersion: null })
})

test('repeated and older versions do not create or replace a notice', () => {
  const baseline = { observedVersion: 3, pendingVersion: null }
  assert.equal(observe(baseline, 3), baseline)
  assert.equal(observe(baseline, 2), baseline)
})

test('a version change is retained while the personal GET is still in flight', () => {
  // This tracker receives prop observations separately from the GET lifecycle.
  const duringInitialLoad = observe({ observedVersion: 5, pendingVersion: null }, 6)
  assert.deepEqual(duringInitialLoad, { observedVersion: 6, pendingVersion: 6 })
})

test('a newer change replaces the pending version and an older confirmation cannot clear it', () => {
  const pendingLatest = observe(observe({ observedVersion: 5, pendingVersion: null }, 6), 7)
  assert.deepEqual(pendingLatest, { observedVersion: 7, pendingVersion: 7 })
  assert.deepEqual(confirm(pendingLatest, 6), pendingLatest)
  assert.deepEqual(confirm(pendingLatest, 7), { observedVersion: 7, pendingVersion: null })
})

test('confirmation cannot clear a notice for a version newer than its result', () => {
  const pending = { observedVersion: 9, pendingVersion: 9 }
  assert.deepEqual(confirm(pending, 8), pending)
  assert.deepEqual(confirm(pending, 9), { observedVersion: 9, pendingVersion: null })
})

test('a confirmation for a future version cannot clear the currently observed notice', () => {
  const pending = { observedVersion: 6, pendingVersion: 6 }
  assert.deepEqual(confirm(pending, 7), pending)
})

test('reset clears the trip-specific notice baseline', () => {
  const pending = { observedVersion: 4, pendingVersion: 5 }
  assert.deepEqual(transitionConditionsNotice(pending, { type: 'reset' }), initialConditionsNoticeState)
  assert.deepEqual(observe(initialConditionsNoticeState, 8), { observedVersion: 8, pendingVersion: null })
})
