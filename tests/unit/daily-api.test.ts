import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createApiApp } from '../../src/server/app.ts';
import type { AppRouter, RpcContext } from '../../src/server/trpc.ts';
import {
  DailyChallengeError,
  createDailyChallengeRecord,
  toPublicDailyChallenge,
  type DailyChallengeView,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../src/shared/circuit-generator.ts';

const now = Date.parse('2026-11-12T23:59:58Z');
const fixture = createDailyChallengeRecord({
  subredditId: 't5_home',
  day: '2026-11-12',
  createdAtMs: now,
  requestedSeed: 'api-fixture',
  generated: generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
    generator: { maxAttempts: 1 },
    maxQualityAttempts: 1,
  }),
}).then((record): DailyChallengeView => ({
  challenge: toPublicDailyChallenge(record),
  serverNowMs: now,
  currentDay: '2026-11-12',
  nextResetAtMs: Date.parse('2026-11-13T00:00:00Z'),
  isCurrent: true,
  rankedWindowOpen: true,
}));

function setup(getDailyChallenge: RpcContext['getDailyChallenge']) {
  const app = createApiApp(() => ({
    getDailyChallenge,
    startRankedRace: async () => {
      throw new Error('Unexpected ranked start');
    },
    submitRun: async () => {
      throw new Error('Unexpected ranked submission');
    },
    getLeaderboard: async () => {
      throw new Error('Unexpected leaderboard query');
    },
  }));
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
  return { app, client };
}

void test('the typed client uses the production Hono/tRPC adapter and no-store response', async () => {
  const view = await fixture;
  const { app, client } = setup(async () => view);
  // JSON normalizes IEEE negative zero; compare the actual wire representation.
  assert.equal(
    JSON.stringify(await client.dailyChallenge.query()),
    JSON.stringify(view)
  );
  const response = await app.request('/api/trpc/dailyChallenge');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const text = await response.text();
  for (const privateField of [
    'fastReplay',
    'audit',
    'generatorConfig',
    'qualityThresholds',
  ])
    assert.ok(!text.includes(`"${privateField}"`));
  assert.ok(text.includes(view.challenge.trackHash));
});

void test('client-selected dates, posts, users, tracks and times cannot select the challenge', async () => {
  let calls = 0;
  const { app } = setup(async () => {
    calls++;
    return fixture;
  });
  for (const input of [
    { day: '2026-11-11' },
    { postId: 't3_other' },
    { userId: 't2_fake', time: 1, track: {} },
    null,
  ]) {
    const response = await app.request(
      `/api/trpc/dailyChallenge?input=${encodeURIComponent(JSON.stringify(input))}`
    );
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
});

void test('batching, wrong HTTP methods and unknown endpoints fail without generating', async () => {
  let calls = 0;
  const { app } = setup(async () => {
    calls++;
    return fixture;
  });
  assert.equal(
    (await app.request('/api/trpc/dailyChallenge?batch=1')).status,
    400
  );
  assert.equal(
    (
      await app.request('/api/trpc/dailyChallenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      })
    ).status,
    405
  );
  assert.equal((await app.request('/api/trpc/notAProcedure')).status, 404);
  assert.equal(calls, 0);
});

void test('unsupported or damaged persisted rules fail closed with a recognizable response', async () => {
  const kinds: Array<'unsupported' | 'integrity'> = [
    'unsupported',
    'integrity',
  ];
  for (const kind of kinds) {
    const { app } = setup(async () => {
      throw new DailyChallengeError(kind, 'Internal storage details');
    });
    const response = await app.request('/api/trpc/dailyChallenge');
    assert.equal(response.status, 412);
    const text = await response.text();
    assert.ok(text.includes('PRECONDITION_FAILED'));
    assert.ok(!text.includes('Internal storage details'));
  }
});

void test('storage failures return a safe unavailable error rather than an invented course', async () => {
  const { app } = setup(async () => {
    throw new Error('Redis private diagnostic');
  });
  const response = await app.request('/api/trpc/dailyChallenge');
  assert.equal(response.status, 500);
  const text = await response.text();
  assert.ok(text.includes('temporarily unavailable'));
  assert.ok(!text.includes('Redis private diagnostic'));
});
