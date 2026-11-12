import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  RaceRequestTimeoutError,
  withRequestDeadline,
} from '../../src/client/request-deadline.ts';

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred not initialized');
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}

void test('a hung non-abort-compliant request reaches the exact default deadline and aborts its own signal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clears = t.mock.method(globalThis, 'clearTimeout');
  const external = new AbortController(),
    signals: AbortSignal[] = [];
  const pending = withRequestDeadline(
    (signal) => {
      signals.push(signal);
      return new Promise<number>(() => {});
    },
    { signal: external.signal }
  );
  const internal = signals[0];
  assert.ok(internal);
  assert.notEqual(internal, external.signal);
  assert.equal(getEventListeners(external.signal, 'abort').length, 1);
  let done = false;
  const rejected = assert.rejects(pending, (error: unknown) => {
    done = true;
    return (
      error instanceof RaceRequestTimeoutError &&
      error.timeoutMs === DEFAULT_REQUEST_TIMEOUT_MS &&
      error.name === 'RaceRequestTimeoutError'
    );
  });
  t.mock.timers.tick(DEFAULT_REQUEST_TIMEOUT_MS - 1);
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(internal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(internal.aborted, true);
  assert.ok(internal.reason instanceof RaceRequestTimeoutError);
  assert.equal(external.signal.aborted, false);
  assert.equal(getEventListeners(external.signal, 'abort').length, 0);
  assert.equal(clears.mock.callCount(), 1);
});

void test('external cancellation settles immediately with its original reason and cleans the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clears = t.mock.method(globalThis, 'clearTimeout');
  const external = new AbortController(),
    signals: AbortSignal[] = [];
  const pending = withRequestDeadline(
    (signal) => {
      signals.push(signal);
      return new Promise<number>(() => {});
    },
    { signal: external.signal }
  );
  const reason = new DOMException('The player left the attempt.', 'AbortError');
  const rejected = assert.rejects(
    pending,
    (error: unknown) => error === reason
  );
  external.abort(reason);
  await rejected;
  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[0]?.reason, reason);
  assert.equal(getEventListeners(external.signal, 'abort').length, 0);
  assert.equal(clears.mock.callCount(), 1);
  t.mock.timers.tick(DEFAULT_REQUEST_TIMEOUT_MS * 2);
  assert.equal(signals[0]?.reason, reason);
});

void test('pre-aborted requests never start work or allocate a timer/listener', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timers = t.mock.method(globalThis, 'setTimeout');
  const external = new AbortController();
  external.abort();
  let starts = 0;
  await assert.rejects(
    withRequestDeadline(
      async () => {
        starts++;
        return 'unused';
      },
      { signal: external.signal }
    ),
    (error: unknown) =>
      error === external.signal.reason &&
      error instanceof DOMException &&
      error.name === 'AbortError'
  );
  assert.equal(starts, 0);
  assert.equal(timers.mock.callCount(), 0);
  assert.equal(getEventListeners(external.signal, 'abort').length, 0);
});

void test('an explicitly supplied null cancellation reason stays distinct from timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const external = new AbortController(),
    signals: AbortSignal[] = [];
  const pending = withRequestDeadline(
    (signal) => {
      signals.push(signal);
      return new Promise<number>(() => {});
    },
    { signal: external.signal }
  );
  const rejected = assert.rejects(
    pending,
    (reason: unknown) => reason === null
  );
  external.abort(null);
  await rejected;
  assert.equal(signals[0]?.reason, null);
});

void test('success clears the timer/listener and later cancellation never reaches completed work', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clears = t.mock.method(globalThis, 'clearTimeout');
  const external = new AbortController(),
    signals: AbortSignal[] = [];
  const value = { result: 'verified' };
  assert.equal(
    await withRequestDeadline(
      async (signal) => {
        signals.push(signal);
        return value;
      },
      { signal: external.signal, timeoutMs: 1 }
    ),
    value
  );
  assert.equal(getEventListeners(external.signal, 'abort').length, 0);
  assert.equal(clears.mock.callCount(), 1);
  t.mock.timers.tick(DEFAULT_REQUEST_TIMEOUT_MS);
  external.abort();
  assert.equal(signals[0]?.aborted, false);
});

void test('promise failure and synchronous startup failure preserve the error and clean all resources', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clears = t.mock.method(globalThis, 'clearTimeout');
  const failure = new Error('Transport refused the request');
  const external = new AbortController(),
    signals: AbortSignal[] = [];
  for (const synchronous of [false, true]) {
    await assert.rejects(
      withRequestDeadline<number>(
        (signal) => {
          signals.push(signal);
          if (synchronous) throw failure;
          return Promise.reject(failure);
        },
        { signal: external.signal }
      ),
      (error: unknown) => error === failure
    );
    assert.equal(getEventListeners(external.signal, 'abort').length, 0);
  }
  assert.equal(clears.mock.callCount(), 2);
  t.mock.timers.tick(DEFAULT_REQUEST_TIMEOUT_MS * 2);
  external.abort();
  assert.ok(signals.every((signal) => !signal.aborted));
});

void test('late fulfillment and rejection after timeout cannot change the result or become unhandled', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', record);
  t.after(() => {
    process.removeListener('unhandledRejection', record);
  });
  for (const rejectLate of [false, true]) {
    const work = deferred<string>();
    const pending = withRequestDeadline(() => work.promise, { timeoutMs: 5 });
    const rejected = assert.rejects(pending, RaceRequestTimeoutError);
    t.mock.timers.tick(5);
    await rejected;
    if (rejectLate) work.reject(new Error('Late network failure'));
    else work.resolve('late success');
    await setImmediate();
    await assert.rejects(pending, RaceRequestTimeoutError);
  }
  assert.deepEqual(unhandled, []);
});

void test('late rejection after external cancellation remains consumed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const external = new AbortController(),
    work = deferred<number>();
  const pending = withRequestDeadline(() => work.promise, {
    signal: external.signal,
  });
  const rejected = assert.rejects(
    pending,
    (error: unknown) => error === external.signal.reason
  );
  external.abort();
  await rejected;
  work.reject(new Error('Request rejected after cancellation'));
  await setImmediate();
  assert.equal(getEventListeners(external.signal, 'abort').length, 0);
});

void test('timeout bounds reject invalid values before starting work and accept both endpoints', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let starts = 0;
  for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, -Infinity, 120_001]) {
    await assert.rejects(
      withRequestDeadline(
        async () => {
          starts++;
          return 'unused';
        },
        { timeoutMs }
      ),
      RangeError
    );
  }
  assert.equal(starts, 0);
  for (const timeoutMs of [1, 120_000])
    assert.equal(
      await withRequestDeadline(async () => 'done', { timeoutMs }),
      'done'
    );
});
