import test from 'node:test'
import assert from 'node:assert/strict'
import {
  conditionsToDraft,
  draftToConditions,
  fetchPreparation,
  PreparationHttpError,
  saveSharedConditions,
} from '../src/features/room/preparationApi.ts'
import { emptyRoomDraft } from '../src/features/room/roomData.ts'

const emptyConditions = () => ({
  region: null, startDate: null, endDate: null, expectedPeople: null, budget: null,
  transport: null, departure: null, returnRoute: null, lodging: null, fixedSchedule: null,
})

const preparation = (overrides = {}) => ({
  trip: { id: 'trip-1', name: '단양 여행', status: 'OPEN', inviteCode: 'CB-1234567890' },
  currentMember: { id: 'member-1', nickname: '나', role: 'OWNER' },
  canEditConditions: true,
  conditionsVersion: 3,
  conditions: emptyConditions(),
  activeMemberCount: 2,
  members: [
    { id: 'member-1', nickname: '나', role: 'OWNER', preparationStatus: 'writing' },
    { id: 'member-2', nickname: '친구', role: 'MEMBER', preparationStatus: 'confirmed' },
  ],
  readiness: { conditionsReady: false, reasons: [{ code: 'CONDITIONS_INCOMPLETE', fields: ['region'] }] },
  ...overrides,
})

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

test('GET uses only the preparation endpoint and validates/allowlists the shared response', async () => {
  let called
  const result = await fetchPreparation('trip/a ?#', {
    fetcher: async (url, init) => {
      called = { url, init }
      return jsonResponse(preparation({ personalOriginalText: 'private', secret: 'hidden' }))
    },
  })
  assert.equal(called.url, '/api/v1/trips/trip%2Fa%20%3F%23/preparation')
  assert.equal(called.init.method, 'GET')
  assert.equal(called.init.credentials, 'same-origin')
  assert.equal(called.init.cache, 'no-store')
  assert.equal(called.init.body, undefined)
  assert.deepEqual(result.members.map(({ preparationStatus }) => preparationStatus), ['writing', 'confirmed'])
  assert.equal(result.activeMemberCount, 2)
  assert.equal('personalOriginalText' in result, false)
  assert.equal('secret' in result, false)
  assert.equal('private' in result.members[0], false)
})

test('condition conversion preserves nullable values, maps undecided, trims text, and sends every field', async () => {
  const fromServer = conditionsToDraft({
    ...emptyConditions(), region: '충북 단양', expectedPeople: 3, budget: 600000, transport: 'car',
  })
  assert.equal(fromServer.transport, 'car')
  assert.equal(fromServer.startDate, '')
  assert.equal(conditionsToDraft(emptyConditions()).transport, 'undecided')
  const draft = {
    ...emptyRoomDraft,
    region: ' 충북 단양 ', startDate: '2027-11-14', endDate: '2027-11-15', expectedPeople: '03', budget: '600000',
    transport: 'undecided', departure: ' 청주역 ', returnRoute: '', lodging: ' 숙소 ', fixedSchedule: ' 둘째 날 18:00 복귀 ',
    clientOnly: 'ignore this',
  }
  let called
  const result = await saveSharedConditions('trip-1', 3, draft, {
    fetcher: async (url, init) => {
      called = { url, init }
      return jsonResponse({ conditionsVersion: 4, conditions: { ...emptyConditions(), region: '충북 단양', expectedPeople: 3, budget: 600000, transport: null, departure: '청주역', lodging: '숙소', fixedSchedule: '둘째 날 18:00 복귀' }, requiresReconfirmation: true })
    },
  })
  // The contract exposes conditions as a sibling of preparation, not a child.
  assert.equal(called.url, '/api/v1/trips/trip-1/conditions')
  assert.equal(called.init.method, 'PUT')
  assert.equal(called.init.credentials, 'same-origin')
  assert.equal(called.init.cache, 'no-store')
  assert.equal(called.init.headers['Content-Type'], 'application/json')
  const body = JSON.parse(called.init.body)
  assert.equal(body.expectedConditionsVersion, 3)
  assert.deepEqual(Object.keys(body.conditions), ['region', 'startDate', 'endDate', 'expectedPeople', 'budget', 'transport', 'departure', 'departureTime', 'departureContentid', 'returnRoute', 'lodging', 'fixedSchedule'])
  assert.equal(body.conditions.region, '충북 단양')
  assert.equal(body.conditions.startDate, '2027-11-14')
  assert.equal(body.conditions.expectedPeople, 3)
  assert.equal(body.conditions.budget, 600000)
  assert.equal(body.conditions.transport, null)
  assert.equal(body.conditions.departure, '청주역')
  assert.equal(body.conditions.departureTime, '09:00')
  assert.equal(body.conditions.departureContentid, null)
  assert.equal(body.conditions.returnRoute, null)
  assert.equal(body.conditions.lodging, '숙소')
  assert.equal(body.conditions.fixedSchedule, '둘째 날 18:00 복귀')
  assert.equal('clientOnly' in body.conditions, false)
  assert.equal(result.conditionsVersion, 4)
  assert.equal(result.requiresReconfirmation, true)
})

test('conditions preserve chosen database departure and saved departure time', async () => {
  const draft = { ...emptyRoomDraft, departure: '청주역', departureTime: '07:35', departureContentid: '12345' }
  const wire = draftToConditions(draft)
  assert.equal(wire.departureTime, '07:35')
  assert.equal(wire.departureContentid, 12345)
  assert.deepEqual(conditionsToDraft({ ...emptyConditions(), departure: '청주역', departureTime: '07:35', departureContentid: 12345 }), { ...emptyRoomDraft, departure: '청주역', departureTime: '07:35', departureContentid: '12345' })
})

test('invalid drafts fail before issuing a request, including decimals and text over limits', async () => {
  let calls = 0
  const fetcher = async () => { calls += 1; return jsonResponse({}) }
  for (const draft of [
    { ...emptyRoomDraft, expectedPeople: '1.5' },
    { ...emptyRoomDraft, budget: '1000000001' },
    { ...emptyRoomDraft, startDate: '2027-02-29', endDate: '2027-03-01' },
    { ...emptyRoomDraft, region: '가'.repeat(101) },
  ]) {
    await assert.rejects(saveSharedConditions('trip-1', 1, draft, { fetcher }), PreparationHttpError)
  }
  assert.equal(calls, 0)
})

test('rejects malformed preparation DTOs and inconsistent participant state', async () => {
  const invalidPayloads = [
    preparation({ conditionsVersion: -1 }),
    preparation({ activeMemberCount: 3 }),
    preparation({ members: [preparation().members[0], preparation().members[0]] }),
    preparation({ members: [preparation().members[1]] }),
    preparation({ conditions: { ...emptyConditions(), startDate: '2027-02-29', endDate: '2027-03-01' } }),
    preparation({ readiness: { conditionsReady: true, reasons: [{ code: 'PRIVATE_PERSONAL_TEXT' }] } }),
  ]
  for (const payload of invalidPayloads) {
    await assert.rejects(fetchPreparation('trip-1', { fetcher: async () => jsonResponse(payload) }), /여행 준비 응답/)
  }
})

test('maps authorization and version conflict errors into safe typed errors', async () => {
  const forbidden = await fetchPreparation('trip-1', { fetcher: async () => jsonResponse({ error: { code: 'OWNER_REQUIRED', message: '여행방장만 수정할 수 있어요.' } }, 403) }).catch((error) => error)
  assert.ok(forbidden instanceof PreparationHttpError)
  assert.equal(forbidden.status, 403)
  assert.equal(forbidden.code, 'OWNER_REQUIRED')

  const session = await fetchPreparation('trip-1', { fetcher: async () => jsonResponse({ error: { code: 'SESSION_REQUIRED', message: '기기 세션이 필요해요.' } }, 401) }).catch((error) => error)
  assert.equal(session.status, 401)
  assert.equal(session.code, 'SESSION_REQUIRED')

  const conflict = await saveSharedConditions('trip-1', 2, emptyRoomDraft, {
    fetcher: async () => jsonResponse({ error: {
      code: 'VERSION_CONFLICT', message: '조건이 변경됐어요.', currentConditionsVersion: 7,
      fieldErrors: { 'conditions.region': '지역을 다시 확인해 주세요.', 'conditions.startDate': '날짜를 확인해 주세요.', 'personal.originalText': 'omit' },
    } }, 409),
  }).catch((error) => error)
  assert.equal(conflict.status, 409)
  assert.equal(conflict.currentConditionsVersion, 7)
  assert.deepEqual(conflict.fieldErrors, { region: '지역을 다시 확인해 주세요.', startDate: '날짜를 확인해 주세요.' })
})

test('keeps abort semantics and hides transport details', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetchPreparation('trip-1', { signal: controller.signal, fetcher: async () => jsonResponse(preparation()) }), (error) => error.name === 'AbortError')
  await assert.rejects(fetchPreparation('trip-1', { fetcher: async () => { throw new Error('sensitive socket detail') } }), (error) => {
    assert.equal(error.message.includes('sensitive socket detail'), false)
    return error.message.includes('연결을 확인')
  })
})
