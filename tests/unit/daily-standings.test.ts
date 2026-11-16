import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDailyStandingsService } from '../../src/server/core/daily-standings.ts';
import {
  createCompetitionService,
  personalBestKey,
  boardRevisionKey,
} from '../../src/server/core/competition.ts';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
  DAY_MILLISECONDS,
} from '../../src/shared/daily-challenge.ts';
import {
  parseDailyStandingsQuery,
  parseDailyStandingsView,
} from '../../src/shared/daily-standings.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../src/shared/circuit-generator.ts';
import type { VerifiedRunCommit } from '../../src/server/core/ranked-races.ts';
import { CompetitionTestStore } from './fixtures/competition-store.ts';
const noon = Date.parse('2026-11-12T12:00:00Z');
const approved = generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
  generator: { maxAttempts: 1 },
  maxQualityAttempts: 1,
});
const fixture = createDailyChallengeRecord({
  subredditId: 't5_home',
  day: '2026-11-12',
  createdAtMs: noon,
  requestedSeed: 'competition-fixture',
  generated: approved,
});
const uuid = (value: number): string =>
  `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
const actor = { userId: 't2_racer', subredditId: 't5_home', postId: 't3_race' };
/** Synthetic verified-boundary fixtures test competition arithmetic, not physics. */
async function candidate(
  user: string,
  id: number,
  finishTicks: number,
  fingerprint?: string
): Promise<VerifiedRunCommit> {
  const record = await fixture;
  return {
    session: {
      schemaVersion: 1,
      sessionId: uuid(id),
      userId: user,
      subredditId: actor.subredditId,
      postId: actor.postId,
      day: record.day,
      challengeId: record.id,
      challengeHash: record.challengeHash,
      trackHash: record.trackHash,
      simulationVersion: record.simulationVersion,
      handlingVersion: record.handlingVersion,
      simulationHz: 120,
      createdAtMs: noon - 1000,
      expiresAtMs: noon - 1000 + 5 * 60_000,
    },
    replayFingerprint: fingerprint ?? id.toString(16).padStart(64, '0'),
    response: {
      sessionId: uuid(id),
      challengeId: record.id,
      challengeHash: record.challengeHash,
      finishTicks,
      simulationHz: 120,
      finishTimeMs: (finishTicks * 1000) / 120,
      verifiedAtMs: noon,
    },
  };
}

async function setup(count = 25) {
  let clock = noon;
  const store = new CompetitionTestStore(() => clock);
  let reads = 0;
  for (let i = 0; i < count; i++) {
    const user = `t2_r${i.toString().padStart(3, '0')}`;
    const service = createCompetitionService({
      context: { ...actor, userId: user },
      store,
      now: () => clock,
      getUsername: async () => `Racer ${i}`,
      daily: {
        getForPost: async () => dailyChallengeView(await fixture, clock),
      },
    });
    await service.commitVerified(
      await candidate(user, i + 1, i < 23 ? 1200 : 1400 + i)
    );
  }
  clock = Date.parse('2026-11-13T00:01:00Z');
  const deps = {
    context: { subredditId: actor.subredditId, userId: 't2_r023' },
    store,
    now: () => clock,
    daily: {
      read: async (input: { subredditId: string; day: string }) => {
        reads++;
        assert.equal(input.subredditId, actor.subredditId);
        return input.day === '2026-11-12' ? await fixture : null;
      },
    },
    readPost: async () => ({
      id: 't3_race',
      subredditId: actor.subredditId,
      createdAtMs: noon,
      available: true,
    }),
  };
  return {
    store,
    deps,
    read: createDailyStandingsService(deps),
    setTime: (t: number) => {
      clock = t;
    },
    reads: () => reads,
  };
}
test('historical pages retain >20 tied winners and true subsequent ranks', async () => {
  const h = await setup();
  const first = await h.read();
  assert.equal(first.status, 'available');
  assert.equal(first.rows.length, 20);
  assert.equal(first.nextOffset, 20);
  assert.equal(first.hasMore, true);
  assert(first.rows.every((r) => r.rank === 1));
  assert.equal(first.provisional, true);
  assert.equal(first.postUrl, 'https://www.reddit.com/comments/race/');
  const second = await h.read({ day: first.day, offset: 20 });
  assert.deepEqual(
    second.rows.map((r) => r.rank),
    [1, 1, 1, 24, 25]
  );
  assert.equal(second.rows[3]?.isSelf, true);
  assert.equal(second.nextOffset, null);
  assert.equal(second.hasMore, false);
  h.setTime(Date.parse('2026-11-13T00:04:00Z'));
  assert.equal((await h.read()).provisional, false);
  assert.deepEqual(parseDailyStandingsView(second), second);
});
test('date scope rejects future/current and client-supplied identities, never creates historical days', async () => {
  const h = await setup(0);
  for (const q of [
    { day: '2026-11-13' },
    { day: '2026-11-14' },
    { day: '2026-02-30' },
    { subredditId: 't5_other' },
    { userId: 't2_other' },
    { offset: -20 },
    { offset: 1 },
    { offset: 100020 },
    { day: 'garbage' },
  ])
    await assert.rejects(() => h.read(q));
  assert.equal(h.reads(), 0);
  assert.equal((await h.read({ day: '2026-11-11' })).status, 'missing');
  assert.equal((await h.read()).status, 'empty');
  const before = h.reads();
  assert.equal((await h.read({ day: '2026-01-01' })).status, 'expired');
  assert.equal(h.reads(), before);
});
test('retention boundary expires standings without reading records', async () => {
  const h = await setup(1);
  h.setTime(Date.parse('2026-11-13T00:00:00Z') + 90 * DAY_MILLISECONDS);
  const result = await h.read({ day: '2026-11-12' });
  assert.equal(result.status, 'expired');
  assert.equal(h.reads(), 0);
  assert.equal(result.rows.length, 0);
});
test('missing or mismatched trusted personal best is unavailable, never an empty leaderboard', async () => {
  const h = await setup(2);
  h.store.rawDelete(
    personalBestKey(actor.subredditId, '2026-11-12', 't2_r000')
  );
  assert.equal((await h.read()).status, 'unavailable');
  const other = await setup(1);
  const key = personalBestKey(actor.subredditId, '2026-11-12', 't2_r000');
  const raw = await other.store.get(key);
  assert(raw);
  other.store.rawSet(key, raw.replace('t5_home', 't5_other'));
  assert.equal((await other.read()).status, 'unavailable');
});
test('revision races retry boundedly and report unavailable; optional post failure preserves scores', async () => {
  const h = await setup(1);
  const key = boardRevisionKey(actor.subredditId, '2026-11-12');
  let reads = 0;
  h.store.afterGet = (requested) => {
    if (requested === key) {
      reads++;
      h.store.rawSet(key, String(reads + 100));
    }
  };
  assert.equal((await h.read()).status, 'unavailable');
  assert.equal(reads, 6);
  h.store.afterGet = undefined;
  const read = createDailyStandingsService({
    ...h.deps,
    readPost: async () => {
      throw new Error('Reddit down');
    },
  });
  const result = await read();
  assert.equal(result.status, 'available');
  assert.equal(result.postUrl, null);
});
test('response parser rejects forged rank, continuation, expired and URL metadata', async () => {
  const h = await setup();
  const view = await h.read();
  for (const bad of [
    { ...view, rows: [{ ...view.rows[0], rank: 2 }] },
    { ...view, nextOffset: 40 },
    { ...view, hasMore: false },
    { ...view, status: 'expired' },
    { ...view, postUrl: 'https://evil.example/' },
    { ...view, day: '2026-11-13' },
  ])
    assert.throws(() => parseDailyStandingsView(bad));
  assert.deepEqual(parseDailyStandingsQuery(undefined), {});
});
