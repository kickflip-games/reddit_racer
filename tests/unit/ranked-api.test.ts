import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createApiApp, MAX_RPC_BODY_BYTES } from '../../src/server/app.ts';
import type { AppRouter } from '../../src/server/trpc.ts';
import {
  createNxReceiptCommitter,
  createRankedRaceService,
  type RankedStore,
} from '../../src/server/core/ranked-races.ts';
import {
  consumeRaceBudget,
  type RaceBudgetStore,
} from '../../src/server/core/race-rate-limit.ts';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../src/shared/circuit-generator.ts';
import { MAX_REPLAY_TRANSITIONS } from '../../src/shared/replay.ts';
import { MAX_SIMULATION_TICKS } from '../../src/shared/simulation.ts';

// This harness deliberately injects identity. Hosted Devvit authentication is a
// separate acceptance check; headers supplied to these requests never set it.
const initialNow = Date.parse('2026-11-12T12:00:00Z');
const generated = generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
  generator: { maxAttempts: 1 },
  maxQualityAttempts: 1,
});
const fixture = createDailyChallengeRecord({
  subredditId: 't5_home',
  day: '2026-11-12',
  createdAtMs: initialNow,
  requestedSeed: 'ranked-api-fixture',
  generated,
});
const replay = generated.quality.fastReplay;
if (!replay) throw new Error('Expected a replay-checked fixture.');

class AtomicRaceStore implements RankedStore, RaceBudgetStore {
  readonly values = new Map<string, { value: string; expiresAtMs: number }>();
  constructor(private readonly now: () => number) {}
  private prune(key: string): void {
    const value = this.values.get(key);
    if (value && value.expiresAtMs <= this.now()) this.values.delete(key);
  }
  async get(key: string): Promise<string | undefined> {
    this.prune(key);
    return this.values.get(key)?.value;
  }
  async setNX(
    key: string,
    value: string,
    expiresAtMs: number
  ): Promise<boolean> {
    this.prune(key);
    if (this.values.has(key)) return false;
    this.values.set(key, { value, expiresAtMs });
    return true;
  }
  async incrBy(key: string, increment: number): Promise<number> {
    this.prune(key);
    const current = this.values.get(key);
    if (!current) throw new Error('Expected an atomically expiring counter.');
    const value = Number(current.value) + increment;
    this.values.set(key, { ...current, value: String(value) });
    return value;
  }
}

function setup() {
  let now = initialNow;
  let userId: string | undefined = 't2_racer';
  let sequence = 0;
  let contextCalls = 0;
  let startBudgetCalls = 0;
  let verifyBudgetCalls = 0;
  const store = new AtomicRaceStore(() => now);
  const app = createApiApp(() => {
    contextCalls++;
    const trusted = {
      ...(userId ? { userId } : {}),
      subredditId: 't5_home',
      postId: 't3_race',
    };
    const service = createRankedRaceService({
      context: trusted,
      store,
      daily: {
        getForPost: async () => dailyChallengeView(await fixture, now),
        read: async (input) => {
          const record = await fixture;
          return input.day === record.day &&
            input.subredditId === record.subredditId
            ? record
            : null;
        },
      },
      now: () => now,
      newSessionId: () =>
        `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
      consumeStartBudget: async () => {
        startBudgetCalls++;
        await consumeRaceBudget({
          store,
          nowMs: now,
          subredditId: trusted.subredditId,
          userId: trusted.userId ?? '',
          operation: 'start',
        });
      },
      consumeVerifyBudget: async () => {
        verifyBudgetCalls++;
        await consumeRaceBudget({
          store,
          nowMs: now,
          subredditId: trusted.subredditId,
          userId: trusted.userId ?? '',
          operation: 'verify',
        });
      },
      commitVerified: createNxReceiptCommitter(store),
    });
    return {
      getDailyChallenge: async () => dailyChallengeView(await fixture, now),
      startRankedRace: () => service.start(),
      submitRun: (input) => service.submit(input),
      getLeaderboard: async () => {
        throw new Error('Unexpected leaderboard query');
      },
    };
  });
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: 'http://racer.test/api/trpc',
        fetch: async (url, init) =>
          app.request(
            new Request(url, {
              method: init?.method ?? 'GET',
              ...(init?.headers ? { headers: init.headers } : {}),
              ...(typeof init?.body === 'string' ? { body: init.body } : {}),
              ...(init?.signal ? { signal: init.signal } : {}),
            })
          ),
      }),
    ],
  });
  function post(
    procedure: string,
    input: unknown,
    headers: Record<string, string> = {}
  ) {
    return app.request(`/api/trpc/${procedure}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(input),
    });
  }
  return {
    app,
    client,
    post,
    setUser: (value: string | undefined) => {
      userId = value;
    },
    setNow: (value: number) => {
      now = value;
    },
    calls: () => ({ contextCalls, startBudgetCalls, verifyBudgetCalls }),
  };
}

void test('typed HTTP start and submit run the real authoritative replay and return an idempotent receipt', async () => {
  const api = setup();
  const session = await api.client.startRankedRace.mutate();
  assert.equal(session.challengeHash, (await fixture).challengeHash);
  assert.equal(session.trackHash, (await fixture).trackHash);
  const input = { sessionId: session.sessionId, replay };
  const [first, duplicate] = await Promise.all([
    api.client.submitRun.mutate(input),
    api.client.submitRun.mutate(input),
  ]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.finishTicks, replay.endTick);
  assert.equal(first.simulationHz, 120);
  assert.ok(
    Math.abs(first.finishTimeMs - (first.finishTicks * 1000) / 120) < 0.000001
  );
  assert.ok(!('userId' in first));
  assert.ok(!('rank' in first));
  const budgetBeforeRepeat = api.calls().verifyBudgetCalls;
  api.setNow(session.expiresAtMs + 1);
  assert.deepEqual(await api.client.submitRun.mutate(input), first);
  assert.equal(api.calls().verifyBudgetCalls, budgetBeforeRepeat);
});

void test('client headers and fields cannot provide authenticated identity, time or road', async () => {
  const api = setup();
  api.setUser(undefined);
  const anonymous = await api.app.request('/api/trpc/startRankedRace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': 't2_racer' },
  });
  assert.equal(anonymous.status, 401);
  assert.equal(api.calls().startBudgetCalls, 0);
  api.setUser('t2_racer');
  const session = await api.client.startRankedRace.mutate();
  const forged = await api.post('submitRun', {
    sessionId: session.sessionId,
    replay,
    userId: 't2_racer',
    time: 1,
    track: {},
  });
  assert.equal(forged.status, 400);
  assert.equal(api.calls().verifyBudgetCalls, 0);
  api.setUser('t2_other');
  const wrongOwner = await api.post(
    'submitRun',
    { sessionId: session.sessionId, replay },
    { 'X-User-Id': 't2_racer' }
  );
  assert.equal(wrongOwner.status, 403);
  assert.equal(api.calls().verifyBudgetCalls, 0);
});

void test('payload and replay bounds reject oversized or abnormal requests before verification', async () => {
  const api = setup();
  const oversized = await api.post('submitRun', {
    padding: 'x'.repeat(MAX_RPC_BODY_BYTES),
  });
  assert.equal(oversized.status, 413);
  assert.equal(api.calls().contextCalls, 0);
  const session = await api.client.startRankedRace.mutate();
  for (const invalidReplay of [
    { ...replay, endTick: MAX_SIMULATION_TICKS + 1 },
    { ...replay, simulationVersion: 'made-up-rules' },
    {
      ...replay,
      transitions: Array.from(
        { length: MAX_REPLAY_TRANSITIONS + 1 },
        (_, tick) => ({ tick, held: tick % 2 === 0 })
      ),
    },
  ]) {
    assert.equal(
      (
        await api.post('submitRun', {
          sessionId: session.sessionId,
          replay: invalidReplay,
        })
      ).status,
      400
    );
  }
  assert.equal(api.calls().verifyBudgetCalls, 0);
});

void test('expired and archived sessions fail safely while a new start is rate limited', async () => {
  const expired = setup();
  const session = await expired.client.startRankedRace.mutate();
  expired.setNow(session.expiresAtMs);
  assert.equal(
    (await expired.post('submitRun', { sessionId: session.sessionId, replay }))
      .status,
    412
  );
  expired.setNow(Date.parse('2026-11-13T00:00:00Z'));
  assert.equal(
    (
      await expired.app.request('/api/trpc/startRankedRace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    ).status,
    412
  );
  const limited = setup();
  for (let attempt = 0; attempt < 12; attempt++)
    await limited.client.startRankedRace.mutate();
  assert.equal(
    (
      await limited.app.request('/api/trpc/startRankedRace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    ).status,
    429
  );
});

void test('malformed JSON, forged start parameters, method changes and batching cannot reach race work', async () => {
  const api = setup();
  assert.equal(
    (
      await api.app.request('/api/trpc/submitRun', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '}',
      })
    ).status,
    400
  );
  assert.equal(
    (
      await api.post('startRankedRace', {
        day: '2026-11-11',
        userId: 't2_racer',
      })
    ).status,
    400
  );
  assert.equal(
    (await api.app.request('/api/trpc/startRankedRace')).status,
    405
  );
  assert.equal(
    (await api.post('submitRun?batch=1', { sessionId: 'unknown', replay }))
      .status,
    400
  );
  assert.equal(api.calls().startBudgetCalls, 0);
  assert.equal(api.calls().verifyBudgetCalls, 0);
});
