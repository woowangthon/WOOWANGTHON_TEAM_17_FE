import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationCanvasImportController } from '../src/features/generation/generationCanvasImportController.ts';
import { CanvasHttpError } from '../src/features/workspace/canvasApi.ts';

test('unknown import result retries the exact body, revision and idempotency key', async () => {
  const sent = []; let calls = 0;
  const controller = createGenerationCanvasImportController({
    getRevision: async () => 7,
    importPlan: async (...args) => { sent.push(args.slice(1, 5)); calls += 1; if (calls === 1) throw new CanvasHttpError(0, 'NETWORK_ERROR', 'unknown'); return { tripId: args[0], revision: 8 }; },
    createKey: () => 'key-same',
  });
  await assert.rejects(controller.run('trip', 'plan', 'version', new AbortController().signal), /unknown/u);
  assert.deepEqual(controller.getPending(), { tripId: 'trip', planId: 'plan', versionId: 'version', expectedRevision: 7, key: 'key-same' });
  await controller.run('trip', 'plan', 'version', new AbortController().signal);
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(controller.getPending(), null);
});

test('known canvas CAS conflict refreshes revision and creates a new request key', async () => {
  let revision = 2; let keyNo = 0; const sent = [];
  const controller = createGenerationCanvasImportController({
    getRevision: async () => revision,
    importPlan: async (_trip, _plan, _version, expected, key) => { sent.push({ expected, key }); if (sent.length === 1) { revision = 3; throw new CanvasHttpError(409, 'VERSION_CONFLICT', 'retry'); } return { tripId: 'trip', revision: 4 }; },
    createKey: () => `key-${++keyNo}`,
  });
  await controller.run('trip', 'plan', 'version', new AbortController().signal);
  assert.deepEqual(sent, [{ expected: 2, key: 'key-1' }, { expected: 3, key: 'key-2' }]);
});
