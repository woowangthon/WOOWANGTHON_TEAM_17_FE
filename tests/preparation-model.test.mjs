import test from 'node:test'
import assert from 'node:assert/strict'
import { CHUNGBUK_REGIONS, regionSelection, withPreservedHiddenConditions } from '../src/features/preparation/preparationModel.ts'
import { emptyRoomDraft } from '../src/features/room/roomData.ts'

test('exposes the eleven supported Chungbuk choices with the raw server values', () => {
  assert.equal(CHUNGBUK_REGIONS.length, 11)
  assert.deepEqual(CHUNGBUK_REGIONS[0], { value: '충북 청주', label: '청주시' })
  assert.deepEqual(CHUNGBUK_REGIONS.at(-1), { value: '충북 단양', label: '단양군' })
})

test('recognizes unset, whole province, and exact known cities without rewriting stored values', () => {
  assert.deepEqual(regionSelection(''), { kind: 'unset', value: '', label: '' })
  assert.deepEqual(regionSelection('충청북도'), { kind: 'all', value: '충청북도', label: '충북 전체' })
  assert.deepEqual(regionSelection('충북 청주시'), { kind: 'specific', value: '충북 청주시', label: '청주시' })
  assert.deepEqual(regionSelection('충북 청주').value, '충북 청주')
})

test('keeps unknown and ambiguous legacy values visible as-is', () => {
  assert.deepEqual(regionSelection('청주 근처'), { kind: 'legacy', value: '청주 근처', label: '청주 근처' })
  assert.deepEqual(regionSelection('충북 전체권'), { kind: 'legacy', value: '충북 전체권', label: '충북 전체권' })
})

test('preserves latest hidden fields without mutating either draft and handles missing latest data', () => {
  const visible = { ...emptyRoomDraft, region: '충북 청주', lodging: '', fixedSchedule: '' }
  const latest = { ...emptyRoomDraft, lodging: '숙소 그대로', fixedSchedule: '첫날 오전 고정 일정' }
  const merged = withPreservedHiddenConditions(visible, latest)
  assert.equal(merged.lodging, '숙소 그대로')
  assert.equal(merged.fixedSchedule, '첫날 오전 고정 일정')
  assert.equal(merged.region, '충북 청주')
  assert.equal(visible.lodging, '')
  assert.equal(latest.region, '')
  const withoutLatest = withPreservedHiddenConditions(visible, null)
  assert.equal(withoutLatest.lodging, '')
  assert.equal(withoutLatest.fixedSchedule, '')
  assert.notEqual(withoutLatest, visible)
})
