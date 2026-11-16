import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createApiApp } from '../../src/server/app.ts';
import type { AppRouter, RpcContext } from '../../src/server/trpc.ts';
import { createDailyStandingsService } from '../../src/server/core/daily-standings.ts';
import { createDailyChallengeRecord } from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../src/shared/circuit-generator.ts';
import { parseDailyStandingsView } from '../../src/shared/daily-standings.ts';
import { CompetitionTestStore } from './fixtures/competition-store.ts';

const now = Date.parse('2026-11-13T00:01:00Z');
const fixture = createDailyChallengeRecord({
  subredditId: 't5_home',
  day: '2026-11-12',
  createdAtMs: now - 12 * 60 * 60_000,
  requestedSeed: 'archive-http-fixture',
  generated: generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
    generator: { maxAttempts: 1 },
    maxQualityAttempts: 1,
  }),
});
function harness(serviceAvailable = true) {
  const store = new CompetitionTestStore(() => now);
  const reads: { subredditId: string; day: string }[] = [];
  let mutatingCalls = 0,
    generationCalls = 0;
  const unexpected = async (): Promise<never> => {
    mutatingCalls++;
    throw new Error('Mutation called from archive');
  };
  const archive = createDailyStandingsService({
    context: { subredditId: 't5_home', userId: 't2_trusted' },
    store,
    now: () => now,
    daily: {
      read: async (input) => {
        reads.push(input);
        return input.day === '2026-11-12' ? await fixture : null;
      },
    },
    readPost: async () => undefined,
  });
  const context: RpcContext = {
    ...(serviceAvailable ? { dailyStandings: archive } : {}),
    getDailyChallenge: async () => {
      generationCalls++;
      throw new Error('Archive must not generate/load post course');
    },
    todayRacePost: unexpected,
    startRankedRace: unexpected,
    submitRun: unexpected,
    getLeaderboard: unexpected,
  };
  const app = createApiApp(() => context);
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
            })
          ),
      }),
    ],
  });
  const snapshot = () =>
    JSON.stringify({
      strings: [...store.strings],
      sorted: [...store.sorted],
      revisions: [...store.revisions],
      casCalls: store.casCalls,
    });
  return {
    app,
    client,
    store,
    reads,
    snapshot,
    mutatingCalls: () => mutatingCalls,
    generationCalls: () => generationCalls,
  };
}
function path(input: unknown): string {
  return `/api/trpc/dailyStandings?input=${encodeURIComponent(JSON.stringify(input))}`;
}

test('HTTP archive defaults yesterday UTC and accepts date/page without writes or generation', async () => {
  const h = harness(),
    before = h.snapshot();
  const view = parseDailyStandingsView(await h.client.dailyStandings.query({}));
  assert.equal(view.day, '2026-11-12');
  assert.equal(view.status, 'empty');
  assert.equal(view.provisional, true);
  const paged = await h.client.dailyStandings.query({
    day: '2026-11-12',
    offset: 20,
  });
  assert.equal(paged.offset, 20);
  const response = await h.app.request('/api/trpc/dailyStandings');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(h.snapshot(), before);
  assert.equal(h.mutatingCalls(), 0);
  assert.equal(h.generationCalls(), 0);
});
test('HTTP archive rejects client account/subreddit/post fields and malformed pages before storage', async () => {
  const h = harness();
  for (const input of [
    null,
    { day: '2026-02-30' },
    { day: 'not-a-date' },
    { offset: -20 },
    { offset: 1 },
    { offset: 100020 },
    { day: '2026-11-12', subredditId: 't5_other' },
    { userId: 't2_fake' },
    { postId: 't3_other' },
    { sessionId: 'fake' },
  ]) {
    const response = await h.app.request(path(input));
    assert.equal(response.status, 400, JSON.stringify(input));
  }
  assert.equal(h.reads.length, 0);
  assert.equal(h.mutatingCalls(), 0);
  assert.equal(h.generationCalls(), 0);
});
test('HTTP date scope maps current/future to400 and expired dates to explicit readonly status', async () => {
  const h = harness();
  for (const day of ['2026-11-13', '2026-11-14'])
    assert.equal((await h.app.request(path({ day }))).status, 400);
  assert.equal(h.reads.length, 0);
  const expired = await h.client.dailyStandings.query({ day: '2026-01-01' });
  assert.equal(expired.status, 'expired');
  assert.equal(h.reads.length, 0);
  const missing = await h.client.dailyStandings.query({ day: '2026-11-11' });
  assert.equal(missing.status, 'missing');
  assert.equal(h.generationCalls(), 0);
});
test('HTTP archive ignores spoofed identity headers and retains trusted installed scope', async () => {
  const h = harness();
  const response = await h.app.request(path({ day: '2026-11-12' }), {
    headers: { 'X-Subreddit-Id': 't5_other', 'X-User-Id': 't2_fake' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(h.reads, [{ subredditId: 't5_home', day: '2026-11-12' }]);
});
test('HTTP archive without optional service fails closed503, never falls through to current leaderboard', async () => {
  const h = harness(false);
  const response = await h.app.request('/api/trpc/dailyStandings');
  assert.equal(response.status, 503);
  const body = await response.text();
  assert(!body.includes('Daily archive unavailable'));
  assert.equal(h.reads.length, 0);
  assert.equal(h.mutatingCalls(), 0);
  assert.equal(h.generationCalls(), 0);
});
test('HTTP archive does not expose a mutation or accept POST query dispatch', async () => {
  const h = harness();
  const response = await h.app.request('/api/trpc/dailyStandings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ day: '2026-11-12' }),
  });
  assert.equal(response.status, 405);
  assert.equal(h.reads.length, 0);
  assert.equal(h.mutatingCalls(), 0);
});
