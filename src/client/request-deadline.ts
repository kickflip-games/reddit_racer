export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_TIMEOUT_MS = 120_000;

export class RaceRequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super('The race request timed out. Please try again.');
    this.name = 'RaceRequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

type RequestDeadlineOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function cancellationReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException('The request was cancelled.', 'AbortError')
    : signal.reason;
}

/** Settles on time even when the underlying transport ignores its abort signal. */
export async function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  options: RequestDeadlineOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_REQUEST_TIMEOUT_MS
  )
    throw new RangeError(
      'Request timeout must be an integer from 1 to 120000 milliseconds.'
    );
  const external = options.signal;
  if (external?.aborted) throw cancellationReason(external);

  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function cleanup(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      external?.removeEventListener('abort', cancel);
    }
    function succeed(value: T): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }
    function fail(error: unknown): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }
    function cancel(): void {
      if (settled || !external) return;
      const reason = cancellationReason(external);
      fail(reason);
      controller.abort(reason);
    }

    external?.addEventListener('abort', cancel, { once: true });
    if (external?.aborted) {
      cancel();
      return;
    }
    timer = setTimeout(() => {
      const error = new RaceRequestTimeoutError(timeoutMs);
      fail(error);
      controller.abort(error);
    }, timeoutMs);
    try {
      // Attach both handlers immediately: a rejection after timeout/cancellation
      // remains consumed and cannot replace the result or become unhandled.
      void Promise.resolve(request(controller.signal)).then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}
