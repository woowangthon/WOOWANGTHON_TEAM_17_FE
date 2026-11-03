import assert from 'node:assert/strict';
import test from 'node:test';
import { submitRoomName, waitForPreview } from '../src/features/ui-preview/mockRequests.ts';

test('mock success returns the submitted name and a nonempty preview code', async () => {
  const result = await submitRoomName('단양 여행', { fail: false, delayMs: 1 });
  assert.equal(result.roomName, '단양 여행');
  assert.equal(typeof result.roomCode, 'string');
  assert.ok(result.roomCode.length > 0);
});

test('a failed mock request can be retried successfully with the same input', async () => {
  await assert.rejects(submitRoomName('같은 여행', { fail: true, delayMs: 1 }));
  const result = await submitRoomName('같은 여행', { fail: false, delayMs: 1 });
  assert.equal(result.roomName, '같은 여행');
});

test('an already-aborted request rejects as AbortError instead of succeeding', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    submitRoomName('취소된 여행', { fail: false, signal: controller.signal, delayMs: 100 }),
    { name: 'AbortError' },
  );
});

test('aborting an in-flight request rejects and prevents a late success', async () => {
  const controller = new AbortController();
  const request = submitRoomName('진행 중 취소', { fail: false, signal: controller.signal, delayMs: 100 });
  const rejection = assert.rejects(request, { name: 'AbortError' });
  controller.abort();
  await rejection;
});

test('shared preview delay supports cancellation for other local actions', async () => {
  const controller = new AbortController();
  const delay = waitForPreview(100, controller.signal);
  const rejection = assert.rejects(delay, { name: 'AbortError' });
  controller.abort();
  await rejection;
  await waitForPreview(1);
});
