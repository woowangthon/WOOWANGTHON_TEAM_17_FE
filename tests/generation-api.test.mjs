import test from 'node:test'
import assert from 'node:assert/strict'
import { createJob, getGeneration, normalizeSelf, putSelfReview, savePlan, saveSettings } from '../src/features/generation/generationApi.ts'

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const settings = { activityWindow: { start: '09:00', end: '18:00' }, departureAnchor: null, returnAnchor: null, reviewedCommonFields: [] }

test('GET generation uses the same-origin no-store API and returns public readiness only', async (t) => {
  const state = { conditionsVersion: 2, inputToken: 'opaque', settingsVersion: 0, settings, reviewMembers: [{ id: 'm1', nickname: '나', status: 'reviewNeeded' }], readyForGeneration: false, reasons: [{ code: 'REVIEW_REQUIRED' }], latestJob: null, latestPlan: null }
  let called
  t.mock.method(globalThis, 'fetch', async (path, init) => { called = { path, init }; return json(state) })
  assert.deepEqual(await getGeneration('room-1'), state)
  assert.equal(called.path, '/api/v1/trips/room-1/generation')
  assert.equal(called.init.cache, 'no-store')
  assert.equal(called.init.credentials, 'same-origin')
})

test('self normalization and review use the documented self-only paths and CAS', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, init) => { calls.push({ path, init }); return json({ ok: true }) })
  await normalizeSelf('trip-1', 2, 7)
  await putSelfReview('trip-1', { normalizationId: 'norm', expectedReviewVersion: 0, acceptedTermIds: ['t0'], reviewedFields: [{ field: 'likes', termIds: ['t0'], scope: 'all', fullyReviewed: true }] })
  assert.equal(calls[0].path, '/api/v1/trips/trip-1/generation/preferences/me')
  assert.equal(calls[0].init.method, 'POST')
  assert.match(calls[0].init.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/)
  assert.deepEqual(JSON.parse(calls[0].init.body), { expectedConditionsVersion: 2, expectedPreferenceVersion: 7 })
  assert.equal(calls[1].path, '/api/v1/trips/trip-1/generation/preferences/me/review')
  assert.deepEqual(JSON.parse(calls[1].init.body).acceptedTermIds, ['t0'])
  assert.equal('verifiedTagAbsences' in JSON.parse(calls[1].init.body), false)
})

test('settings CAS and generation idempotency key are passed through unchanged', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, init) => { calls.push({ path, init }); return json({ id: 'job-1', kind: 'GENERATE', status: 'QUEUED', phase: 'queued', planId: null, errorCode: null, createdAt: '', updatedAt: '' }) })
  await saveSettings('trip-1', 5, 4, settings)
  await createJob('trip-1', 'opaque-token', 4, '8a49db54-a036-44d8-aad9-e39bdfd34adc')
  assert.deepEqual(JSON.parse(calls[0].init.body), { expectedConditionsVersion: 5, expectedSettingsVersion: 4, settings })
  assert.equal(calls[1].path, '/api/v1/trips/trip-1/generation/jobs')
  assert.equal(calls[1].init.headers['Idempotency-Key'], '8a49db54-a036-44d8-aad9-e39bdfd34adc')
  assert.deepEqual(JSON.parse(calls[1].init.body), { expectedInputToken: 'opaque-token', expectedSettingsVersion: 4 })
})

test('plan save requires explicit acknowledgement and current lock/version CAS', async (t) => {
  let call
  t.mock.method(globalThis, 'fetch', async (path, init) => { call = { path, init }; return json({ saved: true }) })
  const plan = { planId: 'p1', versionId: 'v1', lockVersion: 3 }
  await savePlan('trip-1', plan, true)
  assert.equal(call.path, '/api/v1/trips/trip-1/plans/p1/save')
  assert.deepEqual(JSON.parse(call.init.body), { versionId: 'v1', expectedLockVersion: 3, acknowledgeUnverified: true })
  assert.match(call.init.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/)
})
