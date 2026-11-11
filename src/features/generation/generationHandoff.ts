export function mayCompleteHandoff(signal: AbortSignal, ownEpoch: number, currentEpoch: number, blockedReason?: string): boolean {
  return !signal.aborted && ownEpoch === currentEpoch && !blockedReason;
}

export function waitForTwoPaints(signal: AbortSignal,
  requestFrame: (callback: FrameRequestCallback) => number = callback => requestAnimationFrame(callback),
  cancelFrame: (handle: number) => void = handle => cancelAnimationFrame(handle)): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    let first: number | undefined;
    let second: number | undefined;
    const abort = () => {
      if (first !== undefined) cancelFrame(first);
      if (second !== undefined) cancelFrame(second);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    first = requestFrame(() => {
      second = requestFrame(() => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
        else resolve();
      });
    });
  });
}
