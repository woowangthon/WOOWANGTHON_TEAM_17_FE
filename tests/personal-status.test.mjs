import test from 'node:test'
import assert from 'node:assert/strict'
import { derivePersonalSaveStatus } from '../src/features/personal/personalStatus.ts'
import { emptyPersonalDraft } from '../src/features/room/roomData.ts'

const confirmed = {
  status: 'confirmed', confirmedConditionsVersion: 4, confirmedPreferenceVersion: 7,
  confirmedAt: '2026-11-10T00:00:00.000Z',
}

const input = (overrides = {}) => ({
  state: 'ready', phase: 'idle', dirty: false, savedDraft: emptyPersonalDraft,
  preferenceVersion: 0, confirmation: null, conditionsChanged: false, ...overrides,
})

test('loading and in-flight requests take priority over persisted data', () => {
  assert.equal(derivePersonalSaveStatus(input({ state: 'loading', savedDraft: { ...emptyPersonalDraft, originalText: 'memo' } })), 'loading')
  assert.equal(derivePersonalSaveStatus(input({ phase: 'analyzing', savedDraft: { ...emptyPersonalDraft, originalText: 'memo' } })), 'saving')
  assert.equal(derivePersonalSaveStatus(input({ phase: 'confirming', preferenceVersion: 7 })), 'saving')
})

test('private saved raw text counts as saved even when parsed result fields are empty', () => {
  assert.equal(derivePersonalSaveStatus(input({ savedDraft: { ...emptyPersonalDraft, originalText: 'private notes' } })), 'saved')
})

test('dirty input overrides a server-confirmed saved version', () => {
  assert.equal(derivePersonalSaveStatus(input({ dirty: true, preferenceVersion: 7, confirmation: confirmed })), 'unsaved')
})

test('errors and changed shared conditions make the save status unknown', () => {
  assert.equal(derivePersonalSaveStatus(input({ state: 'error', savedDraft: { ...emptyPersonalDraft, originalText: 'memo' } })), 'unknown')
  assert.equal(derivePersonalSaveStatus(input({ conditionsChanged: true, preferenceVersion: 7, confirmation: confirmed })), 'unknown')
})

test('confirmed requires a server confirmation for the current preference version', () => {
  assert.equal(derivePersonalSaveStatus(input({ preferenceVersion: 7, confirmation: confirmed })), 'confirmed')
  assert.equal(derivePersonalSaveStatus(input({ preferenceVersion: 8, confirmation: confirmed })), 'saved')
})

test('empty requires no persisted draft and preference version zero', () => {
  assert.equal(derivePersonalSaveStatus(input()), 'empty')
  assert.equal(derivePersonalSaveStatus(input({ preferenceVersion: 1 })), 'saved')
})
