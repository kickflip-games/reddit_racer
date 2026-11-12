import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createResolutionObserver,
  resolveRenderPixelRatio,
  resolveRenderViewport,
  type ResolutionObserverPorts,
  type ResolutionQuery,
} from '../../src/client/render-viewport.ts';

class Query implements ResolutionQuery {
  readonly listeners = new Set<() => void>();
  lastRegistered: (() => void) | undefined;
  additions = 0;
  removals = 0;
  constructor(readonly text: string) {}
  addEventListener(type: 'change', listener: () => void): void {
    assert.equal(type, 'change');
    this.additions++;
    this.lastRegistered = listener;
    this.listeners.add(listener);
  }
  removeEventListener(type: 'change', listener: () => void): void {
    assert.equal(type, 'change');
    this.removals++;
    this.listeners.delete(listener);
  }
  fire(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
class Display implements ResolutionObserverPorts {
  dpr = 1;
  readonly queries: Query[] = [];
  readDevicePixelRatio(): number {
    return this.dpr;
  }
  matchMedia(text: string): Query {
    const query = new Query(text);
    this.queries.push(query);
    return query;
  }
  change(dpr: number): void {
    this.dpr = dpr;
    this.queries.at(-1)?.fire();
  }
  get activeListeners(): number {
    return this.queries.reduce((sum, query) => sum + query.listeners.size, 0);
  }
}

void test('the frame guard compares capped DPR without allocating a viewport or requiring native events', () => {
  assert.equal(resolveRenderPixelRatio(3), 2);
  assert.equal(resolveRenderPixelRatio(4), 2);
  assert.equal(resolveRenderPixelRatio(1.5), 1.5);
  assert.equal(resolveRenderPixelRatio(0.5), 0.5);
  for (const invalid of [NaN, Infinity, -Infinity, 0, -1])
    assert.equal(resolveRenderPixelRatio(invalid), 1);

  const display = new Display();
  display.dpr = 3;
  const observer = createResolutionObserver(
    () => assert.fail('No native event is delivered in this regression'),
    display
  );
  let cached = resolveRenderPixelRatio(display.dpr);
  let resizes = 0;
  for (const dpr of [4, 1.5, 1.5, 1.5]) {
    display.dpr = dpr; // Native capability changes without a media-query event.
    const current = resolveRenderPixelRatio(display.dpr);
    if (current !== cached) {
      cached = current;
      observer.refresh(); // Root resize synchronously rearms the observer.
      resizes++;
    }
  }
  assert.equal(resizes, 1);
  assert.equal(cached, 1.5);
  assert.equal(display.queries.at(-1)?.text, '(resolution: 1.5dppx)');
  assert.equal(display.activeListeners, 1);
  observer.dispose();
});

void test('DPR bounds preserve CSS coordinates and use renderer-compatible integer backing dimensions', () => {
  for (const [dpr, ratio, width, height] of [
    [1, 1, 393, 852],
    [2, 2, 786, 1704],
    [3, 2, 786, 1704],
    [0.5, 0.5, 196, 426],
    [1.25, 1.25, 491, 1065],
  ]) {
    assert.ok(
      dpr !== undefined &&
        ratio !== undefined &&
        width !== undefined &&
        height !== undefined
    );
    assert.deepEqual(resolveRenderViewport(393, 852, dpr), {
      width: 393,
      height: 852,
      pixelRatio: ratio,
      drawable: true,
      backingWidth: width,
      backingHeight: height,
    });
  }
  assert.deepEqual(resolveRenderViewport(320.75, 568.25, 1.5), {
    width: 320.75,
    height: 568.25,
    pixelRatio: 1.5,
    drawable: true,
    backingWidth: 481,
    backingHeight: 852,
  });
});

void test('invalid DPR falls back safely and zero/invalid/subpixel sizes never fabricate a buffer', () => {
  for (const dpr of [NaN, Infinity, -Infinity, 0, -1]) {
    const viewport = resolveRenderViewport(320, 568, dpr);
    assert.equal(viewport.pixelRatio, 1);
    assert.equal(viewport.backingWidth, 320);
    assert.equal(viewport.backingHeight, 568);
  }
  for (const invalid of [0, -1, NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
    for (const viewport of [
      resolveRenderViewport(invalid, 568, 3),
      resolveRenderViewport(320, invalid, 3),
    ]) {
      assert.equal(viewport.drawable, false);
      assert.equal(viewport.backingWidth, 0);
      assert.equal(viewport.backingHeight, 0);
      assert.ok(
        Object.values(viewport).every(
          (value) => typeof value !== 'number' || Number.isFinite(value)
        )
      );
    }
  }
  const tiny = resolveRenderViewport(0.1, 1, 0.5);
  assert.equal(tiny.drawable, false);
  assert.equal(tiny.backingWidth, 0);
  const restored = resolveRenderViewport(320, 568, 2);
  assert.equal(restored.drawable, true);
  assert.equal(restored.backingWidth, 640);
});

void test('constructor and explicit refresh silently resync without recursive callbacks', () => {
  const display = new Display();
  let notifications = 0;
  const observer = createResolutionObserver(() => notifications++, display);
  assert.equal(notifications, 0);
  assert.equal(display.queries.at(-1)?.text, '(resolution: 1dppx)');
  observer.refresh();
  assert.equal(display.queries.length, 1);
  display.dpr = 2;
  observer.refresh();
  assert.equal(notifications, 0);
  assert.equal(display.queries.length, 2);
  assert.equal(display.queries[0]?.listeners.size, 0);
  assert.equal(display.queries.at(-1)?.text, '(resolution: 2dppx)');
  display.queries.at(-1)?.fire();
  assert.equal(notifications, 0);
  observer.dispose();
});

void test('raw 3 to 4 rearms despite equal cap, so 4 to 1.5 notifies after the new listener is installed', () => {
  const display = new Display();
  display.dpr = 3;
  const observed: string[] = [];
  const observer = createResolutionObserver(() => {
    observed.push(display.queries.at(-1)?.text ?? 'missing');
    observer.refresh(); // Root's normal resize callback must not recurse.
  }, display);
  display.change(4);
  assert.deepEqual(observed, []);
  assert.equal(display.queries.at(-1)?.text, '(resolution: 4dppx)');
  assert.equal(display.activeListeners, 1);
  display.change(1.5);
  assert.deepEqual(observed, ['(resolution: 1.5dppx)']);
  assert.equal(display.activeListeners, 1);
  display.queries.at(-1)?.fire();
  assert.equal(observed.length, 1);
  observer.dispose();
});

void test('twenty resolution changes retain one listener and stale/disposed callbacks cannot resubscribe', () => {
  const display = new Display();
  let notifications = 0;
  const observer = createResolutionObserver(() => notifications++, display);
  const values = [3, 4, 1.5, 2, 1, 0.75];
  for (let index = 0; index < 20; index++) {
    const dpr = values[index % values.length];
    assert.ok(dpr !== undefined);
    const previous = display.queries.at(-1);
    display.change(dpr);
    assert.equal(display.activeListeners, 1);
    assert.equal(previous?.listeners.size, 0);
    const before = notifications;
    previous?.lastRegistered?.(); // A queued event from a replaced query.
    assert.equal(notifications, before);
  }
  assert.equal(display.queries.length, 21);
  assert.equal(notifications, 16);
  observer.dispose();
  observer.dispose();
  assert.equal(display.activeListeners, 0);
  assert.equal(
    display.queries.reduce((sum, query) => sum + query.additions, 0),
    21
  );
  assert.equal(
    display.queries.reduce((sum, query) => sum + query.removals, 0),
    21
  );
  for (const query of display.queries) query.lastRegistered?.();
  observer.refresh();
  assert.equal(notifications, 16);
  assert.equal(display.queries.length, 21);
});

void test('twenty create/dispose cycles release every listener without leaking callbacks', () => {
  const display = new Display();
  let notifications = 0;
  for (let cycle = 0; cycle < 20; cycle++) {
    const observer = createResolutionObserver(() => notifications++, display);
    assert.equal(display.activeListeners, 1);
    observer.dispose();
    assert.equal(display.activeListeners, 0);
    display.queries.at(-1)?.lastRegistered?.();
    observer.refresh();
  }
  assert.equal(notifications, 0);
  assert.equal(display.queries.length, 20);
  assert.equal(
    display.queries.reduce((sum, query) => sum + query.additions, 0),
    20
  );
  assert.equal(
    display.queries.reduce((sum, query) => sum + query.removals, 0),
    20
  );
});

void test('missing media-query capability and failed ratio reads remain safe for explicit refreshes', () => {
  let callbacks = 0;
  const observer = createResolutionObserver(() => callbacks++, {
    readDevicePixelRatio() {
      throw new Error('Capability unavailable');
    },
    matchMedia(text) {
      assert.equal(text, '(resolution: 1dppx)');
      return null;
    },
  });
  observer.refresh();
  observer.dispose();
  assert.equal(callbacks, 0);
  const unavailable = createResolutionObserver(
    () => assert.fail('no native event'),
    {
      readDevicePixelRatio: () => 2,
      matchMedia() {
        throw new Error('Media query unavailable');
      },
    }
  );
  assert.doesNotThrow(() => unavailable.refresh());
  unavailable.dispose();
});
