import test from 'node:test';
import assert from 'node:assert/strict';
import { isGenerationAccessLost } from '../src/features/generation/generationAccess.ts';

test('only room access failures hide the shared workspace', () => {
  assert.equal(isGenerationAccessLost({ status: 401, code: 'SESSION_REQUIRED' }), true);
  assert.equal(isGenerationAccessLost({ status: 403, code: 'MEMBERSHIP_INACTIVE' }), true);
  assert.equal(isGenerationAccessLost({ status: 404, code: 'TRIP_NOT_ACCESSIBLE' }), true);
  assert.equal(isGenerationAccessLost({ status: 404, code: 'PLACE_NOT_FOUND' }), false);
  assert.equal(isGenerationAccessLost({ status: 404, code: 'PLAN_NOT_FOUND' }), false);
  assert.equal(isGenerationAccessLost({ status: 403, code: 'OWNER_REQUIRED' }), false);
});
