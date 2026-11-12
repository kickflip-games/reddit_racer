import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  consumeRaceBudget,
  RACE_BUDGET_WINDOW_MS,
  RACE_STARTS_PER_WINDOW,
  type RaceBudgetStore,
} from '../../src/server/core/race-rate-limit.ts';
import { RankedRaceError } from '../../src/shared/ranked-race.ts';

class AtomicBudgetStore implements RaceBudgetStore {
  readonly values = new Map<string, number>();
  readonly expirations = new Map<string, number>();
  async setNX(
    key: string,
    value: string,
    expiresAtMs: number
  ): Promise<boolean> {
    if (this.values.has(key)) return false;
    this.values.set(key, Number(value));
    this.expirations.set(key, expiresAtMs);
    return true;
  }
  async incrBy(key: string, increment: number): Promise<number> {
    const result = (this.values.get(key) ?? 0) + increment;
    this.values.set(key, result);
    return result;
  }
}
function budget(
  store: RaceBudgetStore,
  overrides: Partial<Parameters<typeof consumeRaceBudget>[0]> = {}
) {
  return consumeRaceBudget({
    store,
    nowMs: 10 * RACE_BUDGET_WINDOW_MS + 123,
    subredditId: 't5_home',
    userId: 't2_racer',
    operation: 'start',
    ...overrides,
  });
}

void test('concurrent requests share one atomic counter and admit only the configured budget', async () => {
  const store = new AtomicBudgetStore();
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, () => budget(store))
  );
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    RACE_STARTS_PER_WINDOW
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof RankedRaceError);
      assert.equal(result.reason.kind, 'rate-limited');
    }
  }
  assert.equal(store.values.size, 1);
  assert.equal([...store.values.values()][0], 30);
  assert.equal([...store.expirations.values()][0], 12 * RACE_BUDGET_WINDOW_MS);
});

void test('minute rollover, identity, subreddit and operation have independent bounded counters', async () => {
  const store = new AtomicBudgetStore();
  for (let request = 0; request < RACE_STARTS_PER_WINDOW; request++)
    await budget(store);
  await assert.rejects(
    budget(store),
    (error: unknown) =>
      error instanceof RankedRaceError && error.kind === 'rate-limited'
  );
  await budget(store, { nowMs: 11 * RACE_BUDGET_WINDOW_MS });
  await budget(store, { userId: 't2_other' });
  await budget(store, { subredditId: 't5_other' });
  await budget(store, { operation: 'verify' });
  assert.equal(store.values.size, 5);
  const nextMinute = 'racer:budget:t5_home:t2_racer:start:11';
  assert.equal(store.values.get(nextMinute), 1);
  assert.equal(store.expirations.get(nextMinute), 13 * RACE_BUDGET_WINDOW_MS);
});

void test('initialization does not reset existing counts or remove their expiration', async () => {
  const store = new AtomicBudgetStore();
  for (let request = 0; request < 5; request++) await budget(store);
  const key = 'racer:budget:t5_home:t2_racer:start:10';
  assert.equal(store.values.get(key), 5);
  assert.equal(store.expirations.get(key), 12 * RACE_BUDGET_WINDOW_MS);
});

void test('storage failures and invalid counter replies never authorize unbudgeted work', async () => {
  const unavailable = (error: unknown) =>
    error instanceof RankedRaceError && error.kind === 'unavailable';
  await assert.rejects(
    budget({
      setNX: async () => {
        throw new Error('offline');
      },
      incrBy: async () => {
        throw new Error('must not increment');
      },
    }),
    unavailable
  );
  await assert.rejects(
    budget({
      setNX: async () => true,
      incrBy: async () => {
        throw new Error('offline');
      },
    }),
    unavailable
  );
  for (const invalidCount of [0, -1, NaN, Infinity, 1.5]) {
    await assert.rejects(
      budget({ setNX: async () => true, incrBy: async () => invalidCount }),
      unavailable
    );
  }
});

void test('invalid trusted scope or clock fails before storage access', async () => {
  let writes = 0;
  const store: RaceBudgetStore = {
    setNX: async () => {
      writes++;
      return true;
    },
    incrBy: async () => {
      writes++;
      return 1;
    },
  };
  for (const overrides of [
    { userId: 'fake' },
    { subredditId: 'fake' },
    { nowMs: NaN },
    { nowMs: -1 },
  ]) {
    await assert.rejects(budget(store, overrides));
  }
  assert.equal(writes, 0);
});
