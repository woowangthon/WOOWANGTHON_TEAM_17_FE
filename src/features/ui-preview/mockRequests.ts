export type RoomRequestOptions = {
  fail?: boolean;
  delayMs?: number;
  signal?: AbortSignal;
};

function delay(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('요청이 취소되었습니다.', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitForPreview(delayMs = 650, signal?: AbortSignal): Promise<void> {
  await delay(delayMs, signal);
}

export async function submitRoomName(
  name: string,
  options: RoomRequestOptions = {},
): Promise<{ roomName: string; roomCode: string }> {
  await delay(options.delayMs ?? 900, options.signal);
  if (options.fail) throw new Error('예시 요청에 실패했어요. 입력한 이름은 그대로 보관했어요.');
  return { roomName: name, roomCode: 'WOO-241' };
}
