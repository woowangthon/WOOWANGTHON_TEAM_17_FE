import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationStartController } from '../src/features/generation/generationStartController.ts';

function state(overrides = {}) {
  return {
    conditionsVersion: 2, inputToken: 'input-a', settingsVersion: 3, settings: {}, reviewMembers: [],
    readyForGeneration: true, reasons: [], latestJob: null, latestPlan: null, ...overrides,
  };
}

test('does not create a job while public readiness is incomplete', async () => {
  let posts = 0;
  const controller = createGenerationStartController({
    getLatest: async () => state({ readyForGeneration: false, reasons: [{ code: 'REVIEW_REQUIRED' }] }),
    create: async () => { posts += 1; }, createKey: () => 'key',
  });
  const result = await controller.start('trip-a', new AbortController().signal);
  assert.equal(result.kind, 'not-ready');
  assert.equal(posts, 0);
});

test('reuses an active job without posting a duplicate', async () => {
  let posts = 0;
  const controller = createGenerationStartController({
    getLatest: async () => state({ latestJob: { id: 'job-a', status: 'RUNNING' } }),
    create: async () => { posts += 1; }, createKey: () => 'key',
  });
  const result = await controller.start('trip-a', new AbortController().signal);
  assert.equal(result.kind, 'active');
  assert.equal(posts, 0);
});

test('keeps an idempotency key after an uncertain error and changes it with inputs', async () => {
  let inputToken = 'input-a';
  const keys = [];
  let calls = 0;
  let keyNumber = 0;
  const controller = createGenerationStartController({
    getLatest: async () => state({ inputToken }),
    create: async (_trip, _token, _version, key) => {
      keys.push(key);
      calls += 1;
      if (calls === 1) throw new Error('connection dropped after submit');
      return { id: 'job-a', status: 'QUEUED' };
    },
    createKey: () => `key-${++keyNumber}`,
  });
  await assert.rejects(controller.start('trip-a', new AbortController().signal));
  assert.equal((await controller.start('trip-a', new AbortController().signal)).kind, 'started');
  inputToken = 'input-b';
  await controller.start('trip-a', new AbortController().signal);
  assert.deepEqual(keys, ['key-1', 'key-1', 'key-2']);
});

test('blocks locally without fetching or posting', async () => {
  let gets = 0;
  const controller = createGenerationStartController({
    getLatest: async () => { gets += 1; return state(); },
    create: async () => assert.fail('must not post'), createKey: () => 'key',
  });
  const result = await controller.start('trip-a', new AbortController().signal, '저장 중');
  assert.deepEqual(result, { kind: 'blocked', reason: '저장 중' });
  assert.equal(gets, 0);
});

test('rechecks local edits after a delayed readiness fetch before creating a job', async () => {
  let release;
  let blocked = undefined;
  let posts = 0;
  const controller = createGenerationStartController({
    getLatest: () => new Promise((resolve) => { release = resolve; }),
    create: async () => { posts += 1; }, createKey: () => 'key',
  });
  const pending = controller.start('trip-a', new AbortController().signal, () => blocked);
  blocked = '저장하지 않은 변경이 있어요.';
  release(state());
  const result = await pending;
  assert.equal(result.kind, 'blocked');
  assert.equal(posts, 0);
});

test('does not allow overlapping starts', async () => {
  let release;
  let posts = 0;
  const controller = createGenerationStartController({
    getLatest: () => new Promise((resolve) => { release = resolve; }),
    create: async () => { posts += 1; return { id: 'job', status: 'QUEUED' }; }, createKey: () => 'key',
  });
  const first = controller.start('trip-a', new AbortController().signal);
  const second = await controller.start('trip-a', new AbortController().signal);
  assert.equal(second.kind, 'busy');
  release(state());
  assert.equal((await first).kind, 'started');
  assert.equal(posts, 1);
});
