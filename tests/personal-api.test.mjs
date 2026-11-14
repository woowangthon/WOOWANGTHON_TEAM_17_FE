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
  assert.deepEqual(result.clarifications, [])
  assert.equal(result.confirmation.status, 'writing')
})

test('legacy preference draft stays readable and extracted schedule items round trip', async () => {
  const id = '10000000-0000-4000-8000-000000000011'
  const old = parsePersonalPreferences(dto())
  assert.deepEqual(old.draft.scheduleItems, [])
  const item = { id, kind: 'lodging', scope: null, placeQuery: '단양 숙소', contentid: null, date: '2027-06-10', time: '15:00', endDate: '2027-06-11', endTime: null }
  let call
  const result = await saveMyPreferences('trip-1', 2, 0, { ...emptyPersonalDraft, originalText: '숙소는 예약했어요', scheduleItems: [item] }, {
    fetcher: async (url, init) => { call = { url, init }; return response(dto({ preferenceVersion: 1, draft: { ...dto().draft, originalText: '숙소는 예약했어요', scheduleItems: [item] }, clarifications: [{ itemId: id, fields: ['contentid'], code: 'PLACE_UNRESOLVED', candidates: [{ contentid: 10, title: '단양 숙소', address: null }] }] })) },
  })
  assert.deepEqual(JSON.parse(call.init.body).draft.scheduleItems, [item])
  assert.equal(result.draft.scheduleItems[0].contentid, null)
  assert.deepEqual(result.clarifications[0].candidates, [{ contentid: 10, title: '단양 숙소', address: null }])
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

test('source-only PUT omits profile and review metadata before parsing and leaves the caller draft untouched', async () => {
  const sourceDraft = { ...emptyPersonalDraft, originalText: '  새 원문  ', scheduleItems: [], atomicPreferences: { intentionally: 'invalid stale DTO' } }
  const before = structuredClone(sourceDraft)
  let call
  await saveMyPreferences('trip-1', 2, 7, sourceDraft, {
    sourceOnly: true,
    // Runtime callers cannot smuggle analysis metadata into a source write.
    analysisReceipt: '12345678-1234-4234-8234-123456789abc',
    unresolvedAcknowledgements: { sourceDigest: 'a'.repeat(64), items: [] },
    fetcher: async (url, init) => {
      call = { url, init }
      return response(dto({ preferenceVersion: 8, draft: { ...dto().draft, originalText: '새 원문' } }))
    },
  })
  const body = JSON.parse(call.init.body)
  assert.deepEqual(Object.keys(body).sort(), ['draft', 'expectedConditionsVersion', 'expectedPreferenceVersion'].sort())
  assert.equal(body.draft.originalText, '새 원문')
  assert.equal('atomicPreferences' in body.draft, false)
  assert.deepEqual(sourceDraft, before)
})

test('ordinary PUT preserves explicit null profile while omission stays omitted', async () => {
  const bodies = []
  const fetcher = async (_url, init) => { bodies.push(JSON.parse(init.body)); return response(dto()) }
  await saveMyPreferences('trip-1', 2, 0, { ...emptyPersonalDraft, atomicPreferences: null }, { fetcher })
  await saveMyPreferences('trip-1', 2, 0, emptyPersonalDraft, { fetcher })
  assert.equal(bodies[0].draft.atomicPreferences, null)
  assert.equal('atomicPreferences' in bodies[1].draft, false)
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

test('interpret accepts extracted schedule items and validates canonical identity', () => {
  const item = { id: 'a0000000-0000-4000-8000-000000000012', kind: 'appointment', scope: null, placeQuery: '단양역', contentid: null, date: null, time: '18:00', endDate: null, endTime: null }
  const result = parseInterpretation({ sourceConditionsVersion: 2, sourcePreferenceVersion: 1, suggestions: { likes: null, avoid: null, avoidImportance: 'required', food: null, foodImportance: 'preferred', walking: '20', scheduleItems: [item] }, needsWalkingAnswer: false, clarifications: [{ itemId: item.id, fields: ['scope'], code: 'SCOPE_REQUIRED', candidates: [] }] })
  assert.deepEqual(result.suggestions.scheduleItems, [item])
  assert.equal(result.clarifications[0].code, 'SCOPE_REQUIRED')
  assert.throws(() => parseInterpretation({ sourceConditionsVersion: 2, sourcePreferenceVersion: 1, suggestions: { likes: null, avoid: null, avoidImportance: 'required', food: null, foodImportance: 'preferred', walking: '20', scheduleItems: [{ ...item, id: item.id.toUpperCase() }] }, needsWalkingAnswer: false }), /개인 준비 응답/u)
})

test('v2 atomic profile preserves unresolved and permits absent walking; final save echoes receipt', async () => {
  const profile = { schemaVersion: 2, sourceDigest: 'a'.repeat(64), status: 'current', conditions: [{
    id: 'ap-a-001', dimension: 'food', target: '초밥', polarity: 'prefer', priority: 'unspecified', priorityBasis: 'unspecified',
    scope: 'trip', audience: 'personal', frequency: { count: 1, operator: 'exact', period: 'trip' }, value: null, unit: null,
    approximate: false, evidence: '여행 중 초밥 한번', origin: 'model',
  }], unresolved: [{ code: 'AMBIGUOUS_WALKING', evidence: '오래 걷기는 어려워요', message: '걷기 조건의 기준은 아직 정하지 않았어요.' }] }
  const requestId = '12345678-1234-4234-8234-123456789abc'
  const parsed = parseInterpretation({ sourceConditionsVersion: 2, sourcePreferenceVersion: 6,
    suggestions: { likes: null, avoid: null, avoidImportance: 'required', food: '초밥', foodImportance: 'preferred', walking: null, atomicPreferences: profile },
    needsWalkingAnswer: false, analysisMeta: { requestId } })
  assert.equal(parsed.needsWalkingAnswer, false)
  assert.deepEqual(parsed.suggestions.atomicPreferences.unresolved, profile.unresolved)
  const staleProfile = parsePersonalPreferences(dto({ draft: { ...dto().draft, atomicPreferences: { ...profile, status: 'stale' } } }))
  assert.equal(staleProfile.draft.atomicPreferences.status, 'stale')
  let call
  const saved = { ...emptyPersonalDraft, originalText: '여행 중 초밥 한번', atomicPreferences: profile }
  await saveMyPreferences('trip-1', 2, 6, saved, { analysisReceipt: requestId, fetcher: async (url, init) => { call = { url, init }; return response(dto({ preferenceVersion: 7, draft: { ...dto().draft, originalText: saved.originalText, atomicPreferences: profile } })) } })
  const body = JSON.parse(call.init.body)
  assert.equal(call.init.headers['X-Preference-Schema'], '2')
  assert.equal(body.analysisReceipt, requestId)
  assert.deepEqual(body.draft.atomicPreferences, profile)
})

test('top-level unresolved acknowledgement metadata validates and round trips without entering canonical draft', async () => {
  const sourceDigest = 'd'.repeat(64)
  const items = [
    { note: { code: 'AMBIGUOUS_WALKING', evidence: '오래 걸으면 어려워요', message: '걷기 시간을 확인해 주세요.' }, disposition: 'ignored' },
    { note: { code: 'AMBIGUOUS_MEAL', evidence: '오래 걸으면 어려워요', message: '식사 조건을 확인해 주세요.' }, disposition: 'handled' },
  ]
  const savedMeta = { sourceDigest, items }
  assert.deepEqual(parsePersonalPreferences(dto({ unresolvedAcknowledgements: savedMeta })).unresolvedAcknowledgements, savedMeta)
  let call
  await saveMyPreferences('trip-1', 2, 4, emptyPersonalDraft, {
    unresolvedAcknowledgements: savedMeta,
    fetcher: async (url, init) => { call = { url, init }; return response(dto({ preferenceVersion: 5, unresolvedAcknowledgements: savedMeta })) },
  })
  const body = JSON.parse(call.init.body)
  assert.deepEqual(body.unresolvedAcknowledgements, savedMeta)
  assert.equal('unresolvedAcknowledgements' in body.draft, false)
  assert.equal('atomicPreferences' in body.draft, false)
  let resetCall
  await saveMyPreferences('trip-1', 2, 5, emptyPersonalDraft, {
    unresolvedAcknowledgements: { sourceDigest, items: [] },
    fetcher: async (url, init) => { resetCall = JSON.parse(init.body); return response(dto({ preferenceVersion: 6, unresolvedAcknowledgements: { sourceDigest, items: [] } })) },
  })
  assert.deepEqual(resetCall.unresolvedAcknowledgements, { sourceDigest, items: [] })
  assert.throws(() => parsePersonalPreferences(dto({ unresolvedAcknowledgements: { ...savedMeta, sourceDigest: 'bad' } })), /개인 준비 응답/u)
  assert.throws(() => parsePersonalPreferences(dto({ unresolvedAcknowledgements: { sourceDigest, items: [items[0], items[0]] } })), /개인 준비 응답/u)
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
