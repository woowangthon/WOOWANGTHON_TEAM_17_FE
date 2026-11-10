import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyRoomDraft, validateRoomDraft, parseRoomEntry, personalDraftComplete, emptyPersonalDraft, roomConditionsStarted } from '../src/features/room/roomData.ts'

const validEntry = () => ({
  trip: { id: 'trip-1', name: '단양 여행', status: 'OPEN', inviteCode: 'CB-1234567890' },
  member: { id: 'member-1', nickname: '여행자 A', role: 'OWNER', status: 'ACTIVE' },
  alreadyJoined: true,
})

test('accepts a complete room response and rejects absent or untrusted member data', () => {
  assert.deepEqual(parseRoomEntry(validEntry()), validEntry())
  assert.throws(() => parseRoomEntry(null), /정보를 확인할 수/)
  const invalid = validEntry()
  invalid.member.role = 'ADMIN'
  assert.throws(() => parseRoomEntry(invalid), /참여 정보를 확인할 수/)
})

test('validates complete calendar dates, order, and numeric travel limits', () => {
  assert.deepEqual(validateRoomDraft(emptyRoomDraft), {})
  assert.equal(roomConditionsStarted(emptyRoomDraft), false)
  assert.equal(roomConditionsStarted({ ...emptyRoomDraft, transport: 'undecided' }), false)
  assert.equal(roomConditionsStarted({ ...emptyRoomDraft, transport: 'car' }), true)
  assert.equal(roomConditionsStarted({ ...emptyRoomDraft, budget: '600000' }), true)
  assert.deepEqual(validateRoomDraft({ ...emptyRoomDraft, startDate: '2027-02-29', endDate: '2027-03-01' }).startDate, '올바른 여행 시작일을 입력해 주세요.')
  assert.deepEqual(validateRoomDraft({ ...emptyRoomDraft, startDate: '2027-06-02', endDate: '2027-06-01' }).endDate, '마지막 날은 시작일과 같거나 이후여야 해요.')
  assert.ok(validateRoomDraft({ ...emptyRoomDraft, expectedPeople: '1.5' }).expectedPeople)
  assert.ok(validateRoomDraft({ ...emptyRoomDraft, expectedPeople: '51' }).expectedPeople)
  assert.ok(validateRoomDraft({ ...emptyRoomDraft, budget: '-1' }).budget)
  assert.ok(validateRoomDraft({ ...emptyRoomDraft, budget: '1000000001' }).budget)
  assert.deepEqual(validateRoomDraft({ ...emptyRoomDraft, startDate: '2028-02-29', endDate: '2028-03-01', expectedPeople: '50', budget: '1000000000' }), {})
})

test('requires a personal draft before the local confirmation control becomes available', () => {
  assert.equal(personalDraftComplete(emptyPersonalDraft), false)
  assert.equal(personalDraftComplete({ ...emptyPersonalDraft, originalText: '여유롭게 여행하고 싶어요', likes: '자연', walking: '40' }), true)
  assert.equal(personalDraftComplete({ ...emptyPersonalDraft, originalText: '여유롭게 여행하고 싶어요', walking: '40' }), false)
})
