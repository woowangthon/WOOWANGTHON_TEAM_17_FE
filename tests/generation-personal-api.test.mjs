import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmPersonal, getPersonal, interpretPersonal, putPersonal, parsePersonal } from '../src/features/room/personalApi.ts'

const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const current = { conditionsVersion: 3, preferenceVersion: 8, draft: { originalText: '내 원문', likes: '숲', avoid: '', avoidImportance: 'required', food: '', foodImportance: 'preferred', walking: '40' }, confirmation: { status: 'writing', confirmedConditionsVersion: null, confirmedPreferenceVersion: null, confirmedAt: null } }

test('GET restores private own draft with no-store and same-origin credentials', async (t) => {
  let called
  t.mock.method(globalThis, 'fetch', async (path, init) => { called = { path, init }; return response(current) })
  const result = await getPersonal('trip/1')
  assert.equal(called.path, '/api/v1/trips/trip%2F1/preferences/me')
  assert.equal(called.init.credentials, 'same-origin')
  assert.equal(called.init.cache, 'no-store')
  assert.equal(result.draft.originalText, '내 원문')
  assert.deepEqual(parsePersonal({ ...current, extraPrivate: true })?.draft, current.draft)
})

test('PUT saves only the draft with both expected versions and leaves confirmation separate', async (t) => {
  let called
  t.mock.method(globalThis, 'fetch', async (path, init) => { called = { path, init }; return response({ ...current, preferenceVersion: 9, draft: JSON.parse(init.body).draft }) })
  const next = await putPersonal('trip-1', current, { ...current.draft, originalText: '  새 원문  ', likes: '  숲 ' })
  assert.equal(called.init.method, 'PUT')
  assert.deepEqual(JSON.parse(called.init.body), { expectedConditionsVersion: 3, expectedPreferenceVersion: 8, draft: { ...current.draft, originalText: '새 원문', likes: '숲', avoid: null, food: null } })
  assert.equal(next.preferenceVersion, 9)
  assert.equal(next.confirmation.status, 'writing')
})

test('interpret and confirm are distinct explicit POSTs with idempotency keys', async (t) => {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (path, init) => { calls.push({ path, init }); return response(path.endsWith('/interpret') ? { sourceConditionsVersion: 3, sourcePreferenceVersion: 8, suggestions: { likes: '숲', avoid: null, avoidImportance: 'required', food: null, foodImportance: 'preferred', walking: null }, needsWalkingAnswer: true } : { ...current, confirmation: { status: 'confirmed', confirmedConditionsVersion: 3, confirmedPreferenceVersion: 8, confirmedAt: '2026-11-09T00:00:00Z' } }) })
  const proposal = await interpretPersonal('trip-1', current)
  assert.equal(calls[0].path, '/api/v1/trips/trip-1/preferences/me/interpret')
  assert.equal(calls[0].init.method, 'POST')
  assert.match(calls[0].init.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/)
  assert.deepEqual(JSON.parse(calls[0].init.body), { expectedConditionsVersion: 3, expectedPreferenceVersion: 8 })
  assert.equal(proposal.suggestions.likes, '숲')
  assert.equal(proposal.suggestions.avoid, null)
  assert.equal(proposal.suggestions.food, null)
  assert.equal(proposal.suggestions.walking, null)
  assert.equal(proposal.needsWalkingAnswer, true)
  const confirmed = await confirmPersonal('trip-1', current)
  assert.equal(calls[1].path, '/api/v1/trips/trip-1/preferences/me/confirm')
  assert.deepEqual(JSON.parse(calls[1].init.body), { expectedConditionsVersion: 3, expectedPreferenceVersion: 8, reviewed: true })
  assert.equal(confirmed.confirmation.status, 'confirmed')
})

test('version conflicts use safe copy and preserve input in caller state', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => response({ error: { code: 'VERSION_CONFLICT', message: 'raw server detail' } }, 409))
  const error = await putPersonal('trip-1', current, current.draft).catch((value) => value)
  assert.match(error.message, /최신 내용을 다시 불러와 주세요/)
  assert.equal(error.message.includes('raw server detail'), false)
  assert.equal(current.draft.originalText, '내 원문')
})

test('confirmation cannot accept a newly fetched common version that was not reviewed', async () => {
  const { sameReviewedVersion, canonicalPersonalDraft } = await import('../src/features/room/personalApi.ts');
  const draft = { originalText:' 합성 원문 ', likes:' 자연 ', avoid:'', food:'', walking:'20', avoidImportance:'required', foodImportance:'preferred' };
  const shown = { conditionsVersion:1, preferenceVersion:2, draft };
  const latest = { ...shown, draft:canonicalPersonalDraft(draft) };
  assert.equal(sameReviewedVersion(shown, latest, 1), true);
  assert.equal(sameReviewedVersion(shown, {...latest,conditionsVersion:2}, 2), false);
  assert.equal(sameReviewedVersion(shown, {...latest,preferenceVersion:3}, 1), false);
});
