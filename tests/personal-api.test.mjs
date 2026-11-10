import test from 'node:test'
import assert from 'node:assert/strict'
import {
  confirmMyPreferences, fetchMyPreferences, interpretMyPreferences, parseInterpretation, parsePersonalPreferences,
  PersonalApiError, saveMyPreferences,
} from '../src/features/personal/personalApi.ts'
import { emptyPersonalDraft } from '../src/features/room/roomData.ts'

const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const dto = (overrides = {}) => ({
  conditionsVersion: 2, preferenceVersion: 0,
  draft: { originalText: null, likes: null, avoid: null, avoidImportance: 'required', food: null, foodImportance: 'preferred', walking: null },
  confirmation: { status: 'writing', confirmedConditionsVersion: null, confirmedPreferenceVersion: null, confirmedAt: null },
  ...overrides,
})

test('GET validates private preferences and converts nullable draft fields to inputs', async () => {
  let call
  const result = await fetchMyPreferences('trip/a ?#', { fetcher: async (url, init) => { call = { url, init }; return response(dto()) } })
  assert.equal(call.url, '/api/v1/trips/trip%2Fa%20%3F%23/preferences/me')
  assert.equal(call.init.method, 'GET')
  assert.equal(call.init.credentials, 'same-origin')
  assert.equal(call.init.cache, 'no-store')
  assert.deepEqual(result.draft, emptyPersonalDraft)
  assert.equal(result.confirmation.status, 'writing')
})

test('PUT sends all strict fields, nulls blank text, and uses current versions', async () => {
  let call
  await saveMyPreferences('trip-1', 2, 5, { ...emptyPersonalDraft, originalText: '  개인 메모  ', walking: '40' }, {
    fetcher: async (url, init) => { call = { url, init }; return response(dto({ preferenceVersion: 6, draft: { originalText: '개인 메모', likes: null, avoid: null, avoidImportance: 'required', food: null, foodImportance: 'preferred', walking: '40' } })) },
  })
  assert.equal(call.url, '/api/v1/trips/trip-1/preferences/me')
  assert.equal(call.init.method, 'PUT')
  assert.equal(call.init.credentials, 'same-origin')
  const body = JSON.parse(call.init.body)
  assert.deepEqual(Object.keys(body), ['expectedConditionsVersion', 'expectedPreferenceVersion', 'draft'])
  assert.equal(body.expectedConditionsVersion, 2)
  assert.equal(body.expectedPreferenceVersion, 5)
  assert.equal(body.draft.originalText, '개인 메모')
  assert.equal(body.draft.likes, null)
  assert.equal(body.draft.walking, '40')
})

test('confirmation uses the explicit reviewed endpoint with both expected versions and no preference data', async () => {
  let call
  const confirmed = dto({ preferenceVersion: 5, draft: { ...dto().draft, originalText: 'private source', likes: 'nature', walking: '40' }, confirmation: {
    status: 'confirmed', confirmedConditionsVersion: 2, confirmedPreferenceVersion: 5, confirmedAt: '2026-11-10T00:00:00.000Z',
  } })
  const result = await confirmMyPreferences('trip/a', 2, 5, { fetcher: async (url, init) => { call = { url, init }; return response(confirmed) } })
  assert.equal(call.url, '/api/v1/trips/trip%2Fa/preferences/me/confirm')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.credentials, 'same-origin')
  assert.deepEqual(JSON.parse(call.init.body), { expectedConditionsVersion: 2, expectedPreferenceVersion: 5, reviewed: true })
  assert.deepEqual(Object.keys(JSON.parse(call.init.body)).sort(), ['expectedConditionsVersion', 'expectedPreferenceVersion', 'reviewed'].sort())
  assert.equal(result.confirmation.status, 'confirmed')
  assert.equal(result.confirmation.confirmedPreferenceVersion, 5)
})

test('confirmation rejects a mismatched response as uncertain and preserves conflict status', async () => {
  const mismatch = await confirmMyPreferences('trip-1', 2, 5, { fetcher: async () => response(dto({ preferenceVersion: 6, confirmation: {
    status: 'confirmed', confirmedConditionsVersion: 2, confirmedPreferenceVersion: 6, confirmedAt: '2026-11-10T00:00:00.000Z',
  } })) }).catch((error) => error)
  assert.ok(mismatch instanceof PersonalApiError)
  assert.equal(mismatch.code, 'INVALID_CONFIRM_RESPONSE')
  assert.equal(mismatch.uncertain, true)
  const malformed = await confirmMyPreferences('trip-1', 2, 5, { fetcher: async () => new Response('{', { status: 200 }) }).catch((error) => error)
  assert.equal(malformed.code, 'INVALID_RESPONSE')
  assert.equal(malformed.uncertain, true)
  const network = await confirmMyPreferences('trip-1', 2, 5, { fetcher: async () => { throw new Error('private socket detail') } }).catch((error) => error)
  assert.equal(network.uncertain, true)
  assert.equal(network.message.includes('private socket detail'), false)
  const conflict = await confirmMyPreferences('trip-1', 2, 5, { fetcher: async () => response({ error: { code: 'VERSION_CONFLICT', message: 'refresh' } }, 409) }).catch((error) => error)
  assert.equal(conflict.status, 409)
})

test('interpret uses UUID idempotency and validates provenance, suggestions, and walking gap', async () => {
  let call
  const interpreted = { sourceConditionsVersion: 2, sourcePreferenceVersion: 6, suggestions: { likes: '자연', avoid: null, avoidImportance: 'required', food: null, foodImportance: 'preferred', walking: null }, needsWalkingAnswer: true }
  const result = await interpretMyPreferences('trip-1', 2, 6, { fetcher: async (url, init) => { call = { url, init }; return response(interpreted) } })
  assert.equal(call.url, '/api/v1/trips/trip-1/preferences/me/interpret')
  assert.equal(call.init.method, 'POST')
  assert.match(call.init.headers['Idempotency-Key'], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  assert.deepEqual(JSON.parse(call.init.body), { expectedConditionsVersion: 2, expectedPreferenceVersion: 6 })
  assert.equal(result.needsWalkingAnswer, true)
  assert.equal(result.suggestions.walking, '')
  assert.equal('originalText' in result.suggestions, false)
})

test('rejects malformed DTOs, unknown enums, overlong values, and inconsistent confirmation', () => {
  assert.throws(() => parsePersonalPreferences(dto({ preferenceVersion: -1 })), /개인 준비 응답/u)
  assert.throws(() => parsePersonalPreferences(dto({ draft: { ...dto().draft, walking: '60' } })), /개인 준비 응답/u)
  assert.throws(() => parsePersonalPreferences(dto({ draft: { ...dto().draft, likes: '가'.repeat(501) } })), /개인 준비 응답/u)
  assert.throws(() => parsePersonalPreferences(dto({ confirmation: { status: 'confirmed', confirmedConditionsVersion: 2, confirmedPreferenceVersion: 0, confirmedAt: null } })), /개인 준비 응답/u)
  assert.throws(() => parseInterpretation({ sourceConditionsVersion: 2, sourcePreferenceVersion: 1, suggestions: { likes: null, avoid: null, avoidImportance: 'maybe', food: null, foodImportance: 'preferred', walking: null }, needsWalkingAnswer: true }), /개인 준비 응답/u)
})

test('surfaces server version conflicts without exposing arbitrary transport errors', async () => {
  const conflict = await saveMyPreferences('trip-1', 2, 1, emptyPersonalDraft, { fetcher: async () => response({ error: { code: 'VERSION_CONFLICT', message: '최신 상태를 확인해 주세요.', currentConditionsVersion: 3, currentPreferenceVersion: 2, fieldErrors: { 'draft.likes': '선호를 확인해 주세요.', 'private.internal': 'secret' } } }, 409) }).catch((error) => error)
  assert.ok(conflict instanceof PersonalApiError)
  assert.equal(conflict.status, 409)
  assert.equal(conflict.currentPreferenceVersion, 2)
  assert.deepEqual(conflict.fieldErrors, { likes: '선호를 확인해 주세요.' })
  const network = await saveMyPreferences('trip-1', 2, 1, emptyPersonalDraft, { fetcher: async () => { throw new Error('private socket detail') } }).catch((error) => error)
  assert.equal(network.uncertain, true)
  assert.equal(network.message.includes('private socket detail'), false)
})
