import test from 'node:test'
import assert from 'node:assert/strict'
import { LiveEntryClient, UNKNOWN_RESULT_MS, validateEntry } from '../public/assets/live-entry/api.js'

const memoryStorage = () => {
  const map = new Map()
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) }
}

test('normalizes Unicode names and invite code before checking contract limits', () => {
  assert.deepEqual(validateEntry('create', { name: '  여행 🚆 ', nickname: ' 나 ' }), { values: { name: '여행 🚆', nickname: '나' } })
  assert.deepEqual(validateEntry('create', { name: '🙂'.repeat(40), nickname: '가' }), { values: { name: '🙂'.repeat(40), nickname: '가' } })
  assert.equal(validateEntry('create', { name: '🙂'.repeat(41), nickname: '가' }).field, 'name')
  assert.equal(validateEntry('create', { name: '방', nickname: '가\u2028나' }).field, 'nickname')
  assert.equal(validateEntry('create', { name: '\n방', nickname: '가' }).field, 'name')
  assert.equal(validateEntry('create', { name: '방', nickname: '\ud800' }).field, 'nickname')
  assert.equal(validateEntry('join', { inviteCode: 'ß', nickname: '민' }).field, 'inviteCode')
  assert.deepEqual(validateEntry('join', { inviteCode: ' cb-12-ab ', nickname: ' 민 ' }), { values: { inviteCode: 'CB-12-AB', nickname: '민' } })
  assert.equal(validateEntry('join', { inviteCode: 'CB_1', nickname: '민' }).field, 'inviteCode')
})

test('bootstraps under a cross-tab lock and sends create with a stable idempotency key', async () => {
  const calls = []; const storage = memoryStorage()
  const client = new LiveEntryClient({ storage, sharedStorage: memoryStorage(), locks: { request: async (_name, callback) => callback() }, randomUUID: () => 'key-1', fetcher: async (path, options) => {
    calls.push({ path, options })
    return { ok: true, json: async () => path.endsWith('device-session') ? {} : { trip: { id: 'trip-1' }, member: { nickname: 'A' } } }
  } })
  const result = await client.submit('create', { name: '방', nickname: 'A' })
  assert.equal(result.trip.id, 'trip-1')
  assert.deepEqual(calls.map((call) => call.path), ['/api/v1/device-session', '/api/v1/trips'])
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'key-1')
  assert.equal(calls[1].options.credentials, 'same-origin')
  assert.equal(storage.getItem('osami-live-entry-request-v1'), null)
})

test('retains request key after network failure and does not bootstrap again on retry', async () => {
  let count = 0; let nextKey = 0; const storage = memoryStorage(); const paths = []; const keys = []
  const client = new LiveEntryClient({ storage, sharedStorage: memoryStorage(), locks: { request: async (_name, callback) => callback() }, randomUUID: () => `key-${++nextKey}`, fetcher: async (path, options) => {
    paths.push(path); keys.push(options.headers['Idempotency-Key'])
    if (path.endsWith('device-session')) return { ok: true, json: async () => ({}) }
    count += 1
    if (count === 1) throw new TypeError('network')
    return { ok: true, json: async () => ({ trip: { id: 'trip-1' }, member: { nickname: 'A' } }) }
  } })
  await assert.rejects(client.submit('create', { name: '방', nickname: 'A' }), /network/)
  await client.submit('create', { name: '방', nickname: 'A' })
  assert.deepEqual(paths, ['/api/v1/device-session', '/api/v1/trips', '/api/v1/trips'])
  assert.deepEqual(keys, [undefined, 'key-1', 'key-1'])
})

test('blocks resend when an idempotency result is older than the server retention window', async () => {
  const storage = memoryStorage(); let calls = 0
  storage.setItem('osami-live-entry-request-v1', JSON.stringify({ fingerprint: JSON.stringify({ path: 'trips', body: { name: '방', nickname: 'A' } }), key: 'old-key', createdAt: 1000, reuseSession: true }))
  const client = new LiveEntryClient({ storage, sharedStorage: memoryStorage(), now: () => 1000 + UNKNOWN_RESULT_MS, locks: { request: async (_name, callback) => callback() }, fetcher: async () => { calls += 1; return { ok: true, json: async () => ({}) } } })
  await assert.rejects(client.submit('create', { name: '방', nickname: 'A' }), /중복 방지를 위해 다시 보내지 않았습니다/)
  assert.equal(calls, 0)
})

test('does not mark the entry as started when bootstrap fails', async () => {
  const storage = memoryStorage(); let bootstraps = 0; let trips = 0
  const client = new LiveEntryClient({ storage, sharedStorage: memoryStorage(), locks: { request: async (_name, callback) => callback() }, randomUUID: () => 'key-bootstrap', fetcher: async (path) => {
    if (path.endsWith('device-session')) { bootstraps += 1; if (bootstraps === 1) throw new TypeError('network') }
    else trips += 1
    return { ok: true, json: async () => path.endsWith('device-session') ? {} : { trip: { id: 'trip-1' }, member: { nickname: 'A' } } }
  } })
  await assert.rejects(client.submit('create', { name: '방', nickname: 'A' }), /network/)
  await client.submit('create', { name: '방', nickname: 'A' })
  assert.equal(bootstraps, 2); assert.equal(trips, 1)
})

test('keeps idempotency key when a successful response is not a valid entry DTO', async () => {
  const storage = memoryStorage(); let count = 0; const sent = []
  const client = new LiveEntryClient({ storage, sharedStorage: memoryStorage(), locks: { request: async (_name, callback) => callback() }, randomUUID: () => 'key-invalid-dto', fetcher: async (path, options) => {
    if (path.endsWith('device-session')) return { ok: true, json: async () => ({}) }
    sent.push(options.headers['Idempotency-Key']); count += 1
    return { ok: true, json: async () => count === 1 ? null : { trip: { id: 'trip-1' }, member: { nickname: 'A' } } }
  } })
  await assert.rejects(client.submit('create', { name: '방', nickname: 'A' }), /응답을 확인할 수 없어요/)
  await client.submit('create', { name: '방', nickname: 'A' })
  assert.deepEqual(sent, ['key-invalid-dto', 'key-invalid-dto'])
})

for (const retryStatus of [409, 429]) {
  test(`retains the original idempotency key across retryable HTTP ${retryStatus}`, async () => {
    let tripCall = 0; const sent = []; const storage = memoryStorage()
    const client = new LiveEntryClient({ storage, sharedStorage: memoryStorage(), locks: { request: async (_name, callback) => callback() }, randomUUID: () => 'stable-retry-key', fetcher: async (path, options) => {
      if (path.endsWith('device-session')) return { ok: true, json: async () => ({}) }
      sent.push(options.headers['Idempotency-Key']); tripCall += 1
      if (tripCall === 1) throw new TypeError('network')
      if (tripCall === 2) return { ok: false, status: retryStatus, headers: { get: () => null }, json: async () => ({ error: { code: retryStatus === 409 ? 'REQUEST_IN_PROGRESS' : 'RATE_LIMITED', message: '잠시 기다려 주세요.' } }) }
      return { ok: true, json: async () => ({ trip: { id: 'trip-1' }, member: { nickname: 'A' } }) }
    } })
    await assert.rejects(client.submit('create', { name: '방', nickname: 'A' }), /network/)
    await assert.rejects(client.submit('create', { name: '방', nickname: 'A' }), /기다려 주세요/)
    await client.submit('create', { name: '방', nickname: 'A' })
    assert.deepEqual(sent, ['stable-retry-key', 'stable-retry-key', 'stable-retry-key'])
  })
}

function serialLocks() {
  const tails = new Map()
  return { request: async (name, callback) => {
    const previous = tails.get(name) ?? Promise.resolve()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    tails.set(name, previous.then(() => gate))
    await previous
    try { return await callback() } finally { release() }
  } }
}

test('blocks an uncertain retry after another tab bootstraps a different shared session', async () => {
  const locks = serialLocks(); const sharedStorage = memoryStorage(); const storageA = memoryStorage(); const storageB = memoryStorage(); let committedCreates = 0
  const clientA = new LiveEntryClient({ storage: storageA, sharedStorage, locks, randomUUID: (() => { const ids = ['key-a', 'generation-a']; return () => ids.shift() })(), fetcher: async (path) => {
    if (path.endsWith('device-session')) return { ok: true, json: async () => ({}) }
    committedCreates += 1
    throw new TypeError('response lost after commit')
  } })
  const clientB = new LiveEntryClient({ storage: storageB, sharedStorage, locks, randomUUID: () => 'generation-b', fetcher: async () => ({ ok: true, json: async () => ({}) }) })
  await assert.rejects(clientA.submit('create', { name: '방', nickname: 'A' }), /response lost after commit/)
  await clientB.ensureSession()
  await assert.rejects(clientA.submit('create', { name: '방', nickname: 'A' }), /중복 방지를 위해 다시 보내지 않았습니다/)
  assert.equal(committedCreates, 1)
  assert.equal(JSON.parse(storageA.getItem('osami-live-entry-request-v1')).blocked, true)
})

test('allows new requests from two tabs after each obtains the shared lock', async () => {
  const locks = serialLocks(); const sharedStorage = memoryStorage(); const seen = []
  const makeClient = (label) => new LiveEntryClient({ storage: memoryStorage(), sharedStorage, locks, randomUUID: () => `generation-${label}`, fetcher: async (path, options) => {
    if (path.endsWith('device-session')) return { ok: true, json: async () => ({}) }
    seen.push(JSON.parse(options.body).name)
    return { ok: true, json: async () => ({ trip: { id: `trip-${label}` }, member: { nickname: label } }) }
  } })
  const [first, second] = await Promise.all([
    makeClient('one').submit('create', { name: '첫번째', nickname: 'one' }),
    makeClient('two').submit('create', { name: '두번째', nickname: 'two' }),
  ])
  assert.equal(first.trip.id, 'trip-one'); assert.equal(second.trip.id, 'trip-two')
  assert.deepEqual(seen.sort(), ['두번째', '첫번째'])
})

test('permanently blocks a 401 entry request instead of retrying under a new session', async () => {
  const storage = memoryStorage(); const sharedStorage = memoryStorage(); let entryCalls = 0
  const client = new LiveEntryClient({ storage, sharedStorage, locks: serialLocks(), randomUUID: () => 'generation-401', fetcher: async (path) => {
    if (path.endsWith('device-session')) return { ok: true, json: async () => ({}) }
    entryCalls += 1
    return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({ error: { code: 'UNAUTHORIZED', message: '인증 실패' } }) }
  } })
  await assert.rejects(client.submit('create', { name: '방', nickname: 'A' }), /인증 실패/)
  await assert.rejects(client.submit('create', { name: '방', nickname: 'A' }), /중복 방지를 위해 다시 보내지 않았습니다/)
  assert.equal(entryCalls, 1)
})

test('default fetch wrapper preserves the browser global receiver', async () => {
  const originalFetch = globalThis.fetch; const calls = []
  globalThis.fetch = async function (...args) {
    assert.equal(this, globalThis)
    calls.push(args[0])
    return { ok: true, json: async () => args[0].endsWith('device-session') ? {} : { trip: { id: 'trip-default-fetch' }, member: { nickname: 'A' } } }
  }
  try {
    const client = new LiveEntryClient({ storage: memoryStorage(), sharedStorage: memoryStorage(), locks: serialLocks(), randomUUID: () => 'default-fetch-generation' })
    const result = await client.submit('create', { name: '방', nickname: 'A' })
    assert.equal(result.trip.id, 'trip-default-fetch')
    assert.deepEqual(calls, ['/api/v1/device-session', '/api/v1/trips'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
