export class GenerationDeadlineError extends Error {
  constructor() { super('Generation request deadline exceeded'); this.name = 'GenerationDeadlineError'; }
}

export async function withGenerationDeadline<T>(signal: AbortSignal | undefined, timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: ((error: unknown) => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStop = reject; });
  const abortFromParent = () => {
    controller.abort();
    rejectStop?.(new DOMException('Aborted', 'AbortError'));
  };
  signal?.addEventListener('abort', abortFromParent, { once: true });
  timeout = setTimeout(() => {
    controller.abort();
    rejectStop?.(new GenerationDeadlineError());
  }, timeoutMs);
  try {
    return await Promise.race([operation(controller.signal), stopped]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}
