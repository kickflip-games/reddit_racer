import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createApiApp } from '../../src/server/app.ts';
import type { AppRouter } from '../../src/server/trpc.ts';
import { createCompetitionService } from '../../src/server/core/competition.ts';
import { createCompetitionStore } from '../../src/server/competition-store.ts';
import { createRankedRaceService } from '../../src/server/core/ranked-races.ts';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../src/shared/circuit-generator.ts';
import type { Replay } from '../../src/shared/replay.ts';
import {
  HANDLING_VERSION,
  SIMULATION_VERSION,
} from '../../src/shared/simulation.ts';
import { RevisionRedis } from '../helpers/revision-redis.ts';

const now = Date.parse('2026-11-12T12:00:00Z');
const generated = generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
  generator: { maxAttempts: 1 },
  maxQualityAttempts: 1,
});
const fixture = createDailyChallengeRecord({
  subredditId: 't5_home',
  day: '2026-11-12',
  createdAtMs: now,
  requestedSeed: 'competition-api-fixture',
  generated,
});
const fast = generated.quality.fastReplay;
const holdTicks = generated.quality.metrics?.hold.finishTicks;
if (!fast || !holdTicks) throw new Error('Expected replay-checked fixture.');
const slow: Replay = {
  schemaVersion: 1,
  simulationVersion: SIMULATION_VERSION,
  handlingVersion: HANDLING_VERSION,
  transitions: [{ tick: 0, held: true }],
  endTick: holdTicks,
};

/** Distinct request contexts share one revision-aware store, like different devices. */
function harness() {
  const redis = new RevisionRedis(now);
  const store = createCompetitionStore(redis, () => now);
  let nextSession = 0;
  const names = new Map([
    ['t2_alice', 'AliceRacer'],
    ['t2_bob', 'BobRacer'],
    ['t2_carol', 'CarolRacer'],
  ]);
  function device(userId?: string, postId = 't3_race', day = '2026-11-12') {
    const actor = {
      ...(userId ? { userId } : {}),
      subredditId: 't5_home',
      postId,
    };
    const daily = {
      getForPost: async () => {
        const record = await fixture;
        if (day !== record.day) throw new Error('Unexpected fixture day');
        return dailyChallengeView(record, now);
      },
      read: async (input: { subredditId: string; day: string }) => {
        const record = await fixture;
        return input.subredditId === record.subredditId &&
          input.day === record.day
          ? record
          : null;
      },
    };
    const app = createApiApp(() => {
      const competition = createCompetitionService({
        context: actor,
        daily,
        store,
        now: () => now,
        getUsername: async (id) => (id === userId ? names.get(id) : undefined),
      });
      const ranked = createRankedRaceService({
        context: actor,
        daily,
        store: {
          get: (key) => redis.get(key),
          setNX: async (key, value, expiresAtMs) =>
            (await redis.set(key, value, {
              nx: true,
              expiration: new Date(expiresAtMs),
            })) === 'OK',
        },
        now: () => now,
        newSessionId: () =>
          `10000000-0000-4000-8000-${String(++nextSession).padStart(12, '0')}`,
        consumeStartBudget: async () => {},
        consumeVerifyBudget: async () => {},
        commitVerified: competition.commitVerified,
      });
      return {
        todayRacePost: async () => {
          throw new Error('Unexpected today post query');
        },
        getDailyChallenge: () => daily.getForPost(),
        startRankedRace: ranked.start,
        submitRun: ranked.submit,
        getLeaderboard: competition.getLeaderboard,
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
    async function run(replay: Replay) {
      const session = await client.startRankedRace.mutate();
      const response = await client.submitRun.mutate({
        sessionId: session.sessionId,
        replay,
      });
      return { session, response };
    }
    return { app, client, run };
  }
  return { device, redis };
}

void test('verified HTTP submissions atomically create a PB that another device can read', async () => {
  const { device } = harness();
  const first = device('t2_alice');
  const completed = await first.run(fast);
  const result = await first.client.getLeaderboard.query({
    sessionId: completed.session.sessionId,
  });
  assert.equal(result.me?.finishTicks, fast.endTick);
  assert.equal(result.me?.rank, 1);
  assert.equal(result.me?.username, 'AliceRacer');
  assert.equal(result.outcome?.isPersonalBest, true);
  assert.equal(result.outcome?.previousBestTicks, null);
  assert.equal(result.outcome?.improvementTicks, null);
  assert.equal(result.viewer, 'signed-in');
  const refreshed = await device('t2_alice').client.getLeaderboard.query({});
  assert.deepEqual(refreshed.me, result.me);
  assert.deepEqual(refreshed.top, result.top);
  assert.equal(refreshed.outcome, null);
  const slower = await first.run(slow);
  const afterSlow = await first.client.getLeaderboard.query({
    sessionId: slower.session.sessionId,
  });
  assert.equal(afterSlow.me?.finishTicks, fast.endTick);
  assert.equal(afterSlow.outcome?.isPersonalBest, false);
  assert.equal(afterSlow.outcome?.improvementTicks, 0);
});

void test('tied tick scores share competition ranks and public reads invent no identity', async () => {
  const { device } = harness();
  await device('t2_alice').run(fast);
  await device('t2_bob').run(fast);
  await device('t2_carol').run(slow);
  const publicView = await device().client.getLeaderboard.query({});
  assert.equal(publicView.viewer, 'signed-out');
  assert.deepEqual(
    publicView.top.map((row) => row.rank),
    [1, 1, 3]
  );
  assert.ok(publicView.top.every((row) => !row.isSelf));
  assert.equal(publicView.me, null);
  assert.equal(publicView.outcome, null);
  const own = await device('t2_carol').client.getLeaderboard.query({});
  assert.equal(own.me?.rank, 3);
  assert.equal(own.nearby.filter((row) => row.isSelf).length, 1);
});

void test('concurrent device submissions never replace the faster verified PB', async () => {
  const { device } = harness();
  const one = device('t2_alice'),
    two = device('t2_alice');
  const [fastRun, slowRun] = await Promise.all([one.run(fast), two.run(slow)]);
  assert.equal(fastRun.response.finishTicks, fast.endTick);
  assert.equal(slowRun.response.finishTicks, slow.endTick);
  const view = await device('t2_alice').client.getLeaderboard.query({});
  assert.equal(view.me?.finishTicks, fast.endTick);
  assert.equal(view.top.length, 1);
  const repeated = await one.client.submitRun.mutate({
    sessionId: fastRun.session.sessionId,
    replay: fast,
  });
  assert.deepEqual(repeated, fastRun.response);
});

void test('query cannot select another user/date or retrieve another account/post outcome', async () => {
  const { device } = harness();
  const alice = device('t2_alice');
  const run = await alice.run(fast);
  for (const input of [
    { userId: 't2_bob' },
    { day: '2026-11-11' },
    { limit: 1000000 },
  ]) {
    const response = await alice.app.request(
      `/api/trpc/getLeaderboard?input=${encodeURIComponent(JSON.stringify(input))}`
    );
    assert.equal(response.status, 400);
  }
  const other = device('t2_bob');
  const wrongOwner = await other.app.request(
    `/api/trpc/getLeaderboard?input=${encodeURIComponent(JSON.stringify({ sessionId: run.session.sessionId }))}`,
    { headers: { 'X-User-Id': 't2_alice' } }
  );
  assert.equal(wrongOwner.status, 403);
  const otherPost = device('t2_alice', 't3_other');
  assert.equal(
    (
      await otherPost.app.request(
        `/api/trpc/getLeaderboard?input=${encodeURIComponent(JSON.stringify({ sessionId: run.session.sessionId }))}`
      )
    ).status,
    403
  );
});
