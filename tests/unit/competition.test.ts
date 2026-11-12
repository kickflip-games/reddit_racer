import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  boardRevisionKey,
  competitionOutcomeKey,
  createCompetitionService,
  leaderboardKey,
  MAX_COMPETITION_CAS_ATTEMPTS,
  parseCompetitionOutcomeRecord,
  parsePersonalBest,
  personalBestKey,
} from '../../src/server/core/competition.ts';
import type { CompetitionDependencies } from '../../src/server/core/competition.ts';
import {
  createNxReceiptCommitter,
  parseVerificationReceipt,
  receiptKey,
  RECEIPT_RETENTION_MS,
} from '../../src/server/core/ranked-races.ts';
import type {
  RankedContext,
  VerifiedRunCommit,
} from '../../src/server/core/ranked-races.ts';
import { RankedRaceError } from '../../src/shared/ranked-race.ts';
import {
  parseLeaderboardQuery,
  parseLeaderboardView,
  RESULTS_RETENTION_MS,
} from '../../src/shared/leaderboard.ts';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../src/shared/circuit-generator.ts';
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
function kind(expected: RankedRaceError['kind']): (error: unknown) => boolean {
  return (error) => error instanceof RankedRaceError && error.kind === expected;
}

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
function setup() {
  let clock = noon;
  const store = new CompetitionTestStore(() => clock);
  const names = new Map<string, string>();
  const service = (context: RankedContext = actor) => {
    const deps: CompetitionDependencies = {
      context,
      store,
      now: () => clock,
      getUsername: async (user) => names.get(user),
      daily: {
        getForPost: async () => dailyChallengeView(await fixture, clock),
      },
    };
    return createCompetitionService(deps);
  };
  const publish = async (user: string, id: number, ticks: number) => {
    names.set(user, `Racer${user.slice(3)}`);
    const run = await candidate(user, id, ticks);
    const result = await service({ ...actor, userId: user }).commitVerified(
      run
    );
    return { run, result };
  };
  return {
    store,
    names,
    service,
    publish,
    setClock: (value: number) => {
      clock = value;
    },
  };
}
async function privateOutcome(store: CompetitionTestStore, id: number) {
  const raw = await store.get(
    competitionOutcomeKey(actor.subredditId, uuid(id))
  );
  assert.ok(raw);
  return parseCompetitionOutcomeRecord(raw);
}

void test('first/faster/equal/slower attempts atomically preserve a strict personal minimum and original outcome', async () => {
  const h = setup();
  await h.publish(actor.userId, 1, 1200);
  const first = await privateOutcome(h.store, 1);
  assert.deepEqual(first.outcome, {
    sessionId: uuid(1),
    previousBestTicks: null,
    personalBestTicks: 1200,
    isPersonalBest: true,
    improvementTicks: null,
  });
  await h.publish(actor.userId, 2, 1000);
  assert.deepEqual((await privateOutcome(h.store, 2)).outcome, {
    sessionId: uuid(2),
    previousBestTicks: 1200,
    personalBestTicks: 1000,
    isPersonalBest: true,
    improvementTicks: 200,
  });
  await h.publish(actor.userId, 3, 1000);
  await h.publish(actor.userId, 4, 1300);
  for (const id of [3, 4])
    assert.deepEqual((await privateOutcome(h.store, id)).outcome, {
      sessionId: uuid(id),
      previousBestTicks: 1000,
      personalBestTicks: 1000,
      isPersonalBest: false,
      improvementTicks: 0,
    });
  assert.equal(
    await h.store.scoreOf(
      leaderboardKey(actor.subredditId, '2026-11-12'),
      actor.userId
    ),
    1000
  );
  const view = await h.service().getLeaderboard({ sessionId: uuid(1) });
  assert.equal(view.me?.finishTicks, 1000);
  assert.equal(
    view.outcome?.personalBestTicks,
    1200,
    'prior improvement snapshot stays immutable after another device improves'
  );
});

void test('faster/slower concurrent completions preserve the minimum in both transaction orders', async () => {
  for (const delayed of ['fast', 'slow']) {
    const h = setup();
    await h.publish(actor.userId, 10, 1200);
    const slow = await candidate(actor.userId, 11, 1100),
      fast = await candidate(actor.userId, 12, 900);
    let entered: () => void = () => {},
      release: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const target = delayed === 'fast' ? fast : slow;
    h.store.beforeCas = async (mutation) => {
      if (
        !held &&
        mutation.expected.some(
          (entry) =>
            entry.key ===
            receiptKey(actor.subredditId, target.session.sessionId)
        )
      ) {
        held = true;
        entered();
        await gate;
      }
    };
    const pending = h.service().commitVerified(target);
    await arrived;
    await h.service().commitVerified(delayed === 'fast' ? slow : fast);
    release();
    await pending;
    const view = await h.service().getLeaderboard();
    assert.equal(view.me?.finishTicks, 900);
    const raw = await h.store.get(
      personalBestKey(actor.subredditId, '2026-11-12', actor.userId)
    );
    assert.ok(raw);
    assert.equal(parsePersonalBest(raw).receipt.response.finishTicks, 900);
    assert.ok(
      h.store.casCalls > h.store.casWins,
      'a real watched conflict was retried'
    );
    assert.equal(
      (await privateOutcome(h.store, 11)).outcome.isPersonalBest,
      delayed === 'fast'
    );
  }
});

void test('duplicate replay commits return the original receipt; a different replay for the same session conflicts', async () => {
  const h = setup();
  h.names.set(actor.userId, 'RealRacer');
  const run = await candidate(actor.userId, 20, 1000);
  const first = await h.service().commitVerified(run);
  const duplicate = await h.service().commitVerified({
    ...run,
    response: { ...run.response, verifiedAtMs: noon + 10 },
  });
  assert.deepEqual(duplicate, first);
  const revision = await h.store.get(
    boardRevisionKey(actor.subredditId, '2026-11-12')
  );
  await assert.rejects(
    h.service().commitVerified({ ...run, replayFingerprint: 'f'.repeat(64) }),
    kind('conflict')
  );
  assert.equal(
    await h.store.get(boardRevisionKey(actor.subredditId, '2026-11-12')),
    revision
  );
});

void test('one atomic winner handles concurrent identical and different-payload receipts', async () => {
  for (const different of [false, true]) {
    const h = setup();
    h.names.set(actor.userId, 'RealRacer');
    const a = await candidate(actor.userId, 30, 1000),
      b = { ...a, ...(different ? { replayFingerprint: 'f'.repeat(64) } : {}) };
    let count = 0,
      release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.store.beforeCas = async (_mutation, call) => {
      if (call <= 2) {
        count++;
        if (count === 2) release();
        await gate;
      }
    };
    const results = await Promise.allSettled([
      h.service().commitVerified(a),
      h.service().commitVerified(b),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      different ? 1 : 2
    );
    if (different) {
      const result = results.find((entry) => entry.status === 'rejected');
      assert.ok(
        result &&
          result.status === 'rejected' &&
          result.reason instanceof RankedRaceError &&
          result.reason.kind === 'conflict'
      );
    }
    const raw = await h.store.get(receiptKey(actor.subredditId, uuid(30)));
    assert.ok(raw);
    assert.equal(parseVerificationReceipt(raw).response.finishTicks, 1000);
    assert.equal((await h.service().getLeaderboard()).me?.finishTicks, 1000);
  }
});

void test('proof/receipt/score/revision partial writes reconcile without losing the observed minimum', async () => {
  for (const part of [
    'proofs-only',
    'receipt-only',
    'score-only',
    'no-revision',
  ]) {
    const h = setup();
    await h.publish(actor.userId, 40, 1200);
    const faster = await candidate(actor.userId, 41, 900);
    if (
      part === 'proofs-only' ||
      part === 'receipt-only' ||
      part === 'score-only' ||
      part === 'no-revision'
    )
      h.store.partialNext = part;
    const result = await h.service().commitVerified(faster);
    assert.equal(result.response.finishTicks, 900);
    assert.equal((await h.service().getLeaderboard()).me?.finishTicks, 900);
    assert.equal(
      (await privateOutcome(h.store, 41)).outcome.personalBestTicks,
      900
    );
    assert.equal(
      (await privateOutcome(h.store, 41)).outcome.improvementTicks,
      300,
      `${part} preserves original proposed improvement`
    );
    assert.ok(h.store.casCalls > h.store.casWins);
  }
});

void test('an acknowledged receipt/outcome does not conceal a missing or divergent PB/zScore', async () => {
  const h = setup();
  const { run } = await h.publish(actor.userId, 50, 900);
  const board = leaderboardKey(actor.subredditId, '2026-11-12');
  h.store.rawScore(board, actor.userId, 1200);
  await h.service().commitVerified(run);
  assert.equal(await h.store.scoreOf(board, actor.userId), 900);
  h.store.rawDelete(
    personalBestKey(actor.subredditId, '2026-11-12', actor.userId)
  );
  await h.service().commitVerified(run);
  assert.equal((await h.service().getLeaderboard()).me?.finishTicks, 900);
  h.store.rawScore(board, actor.userId, 800);
  await assert.rejects(h.service().commitVerified(run), kind('unavailable'));
  assert.equal(
    await h.store.scoreOf(board, actor.userId),
    800,
    'an unproven faster value is preserved, never overwritten with a slower candidate'
  );
});

void test('legacy receipt adoption happens on its owned query without rewriting the receipt or extending TTL', async () => {
  const h = setup();
  h.names.set(actor.userId, 'LegacyRacer');
  const run = await candidate(actor.userId, 60, 1000);
  const legacy = await createNxReceiptCommitter(h.store)(run);
  const key = receiptKey(actor.subredditId, uuid(60)),
    before = await h.store.get(key),
    expiration = h.store.strings.get(key)?.expiresAtMs;
  const view = await h.service().getLeaderboard({ sessionId: uuid(60) });
  assert.equal(view.outcome?.personalBestTicks, 1000);
  assert.equal(view.me?.finishTicks, 1000);
  assert.equal(await h.store.get(key), before);
  assert.equal(h.store.strings.get(key)?.expiresAtMs, expiration);
  assert.deepEqual(legacy.response, run.response);
  await assert.rejects(
    h
      .service({ ...actor, userId: 't2_other' })
      .getLeaderboard({ sessionId: uuid(60) }),
    kind('forbidden')
  );
  await assert.rejects(
    h
      .service({ subredditId: actor.subredditId, postId: actor.postId })
      .getLeaderboard({ sessionId: uuid(60) }),
    kind('unauthenticated')
  );
});

void test('public ties use stable userId ordering and competition ranks1,1,3', async () => {
  const h = setup();
  await h.publish('t2_b', 71, 1000);
  await h.publish('t2_a', 72, 1000);
  await h.publish('t2_c', 73, 1100);
  const view = await h
    .service({ subredditId: actor.subredditId, postId: actor.postId })
    .getLeaderboard();
  assert.equal(view.viewer, 'signed-out');
  assert.deepEqual(
    view.top.map((row) => [row.username, row.rank]),
    [
      ['Racera', 1],
      ['Racerb', 1],
      ['Racerc', 3],
    ]
  );
  assert.equal(view.me, null);
  assert.deepEqual(view.nearby, []);
  assert.equal(view.outcome, null);
  assert.deepEqual(
    parseLeaderboardView(JSON.parse(JSON.stringify(view))),
    view
  );
});

void test('nearby windows stay seven rows at boundaries and ties spanning the first visible row rank correctly', async () => {
  const h = setup();
  for (let index = 0; index < 30; index++)
    await h.publish(
      `t2_p${String(index).padStart(2, '0')}`,
      100 + index,
      index < 12 ? 1000 : 1100 + index
    );
  const tied = await h.service({ ...actor, userId: 't2_p10' }).getLeaderboard();
  assert.equal(tied.me?.rank, 1);
  assert.equal(tied.nearby.length, 7);
  assert.ok(
    tied.nearby
      .filter((row) => row.finishTicks === 1000)
      .every((row) => row.rank === 1)
  );
  const last = await h.service({ ...actor, userId: 't2_p29' }).getLeaderboard();
  assert.equal(last.nearby.length, 7);
  assert.equal(last.nearby.at(-1)?.isSelf, true);
  assert.equal(last.me?.rank, 30);
  assert.equal(last.top.length, 20);
  assert.ok(h.store.batchSizes.every((size) => size <= 8));
});

void test('revision changes retry a bounded snapshot; continuous churn fails without a mixed board', async () => {
  const h = setup();
  await h.publish(actor.userId, 150, 1000);
  const key = boardRevisionKey(actor.subredditId, '2026-11-12');
  let changed = false;
  h.store.afterGet = (at, value) => {
    if (at === key && !changed) {
      changed = true;
      h.store.rawSet(key, String(Number(value ?? '0') + 1));
    }
  };
  assert.equal((await h.service().getLeaderboard()).me?.finishTicks, 1000);
  h.store.afterGet = (at, value) => {
    if (at === key) h.store.rawSet(key, String(Number(value ?? '0') + 1));
  };
  await assert.rejects(h.service().getLeaderboard(), kind('unavailable'));
});

void test('read/write conflicts, invalid storage types and missing trusted names fail closed before false acknowledgement', async () => {
  const h = setup();
  const run = await candidate(actor.userId, 160, 1000);
  await assert.rejects(h.service().commitVerified(run), kind('unavailable'));
  assert.equal(
    await h.store.get(receiptKey(actor.subredditId, uuid(160))),
    undefined
  );
  h.names.set(actor.userId, 'KnownRacer');
  h.store.alwaysConflict = true;
  await assert.rejects(h.service().commitVerified(run), kind('unavailable'));
  assert.equal(h.store.casCalls, MAX_COMPETITION_CAS_ATTEMPTS);
  h.store.alwaysConflict = false;
  h.store.rawSet(leaderboardKey(actor.subredditId, '2026-11-12'), 'wrong-type');
  await assert.rejects(h.service().commitVerified(run), kind('unavailable'));
  assert.equal(
    await h.store.get(receiptKey(actor.subredditId, uuid(160))),
    undefined
  );
});

void test('result retention expires explicitly at90days while the original track remains available', async () => {
  const h = setup();
  await h.publish(actor.userId, 170, 1000);
  const record = await fixture,
    expiresAt = record.endsAtMs + RESULTS_RETENTION_MS;
  assert.equal(
    h.store.strings.get(
      personalBestKey(actor.subredditId, record.day, actor.userId)
    )?.expiresAtMs,
    expiresAt
  );
  assert.equal(
    h.store.strings.get(competitionOutcomeKey(actor.subredditId, uuid(170)))
      ?.expiresAtMs,
    noon + RECEIPT_RETENTION_MS
  );
  h.setClock(expiresAt);
  const view = await h.service().getLeaderboard();
  assert.equal(view.status, 'expired');
  assert.deepEqual(view.top, []);
  assert.equal(view.me, null);
  assert.equal(
    (await fixture).trackHash,
    record.trackHash,
    'track geometry is not deleted with competition results'
  );
});

void test('retention crossed while composing a response returns an explicit expired board', async () => {
  const h = setup();
  await h.publish(actor.userId, 175, 1000);
  const record = await fixture,
    retainedUntil = record.endsAtMs + RESULTS_RETENTION_MS;
  let clockReads = 0;
  const service = createCompetitionService({
    context: actor,
    store: h.store,
    now: () => (++clockReads < 3 ? retainedUntil - 1 : retainedUntil),
    getUsername: async () => 'BoundaryRacer',
    daily: {
      getForPost: async () => dailyChallengeView(record, retainedUntil - 1),
    },
  });
  const view = await service.getLeaderboard();
  assert.equal(view.status, 'expired');
  assert.deepEqual(view.top, []);
  assert.equal(view.me, null);
  assert.deepEqual(view.nearby, []);
});

void test('client-selected identity/date is rejected and stale same-session metadata cannot overwrite the stored outcome', async () => {
  assert.deepEqual(parseLeaderboardQuery(undefined), {});
  for (const query of [
    { day: '2026-11-13' },
    { userId: 't2_other' },
    { postId: 't3_other' },
    { sessionId: 'bad' },
  ])
    assert.throws(() => parseLeaderboardQuery(query), kind('invalid'));
  const h = setup();
  const { run, result } = await h.publish(actor.userId, 180, 1000);
  const stale = {
    ...run,
    response: { ...run.response, verifiedAtMs: noon + 100 },
  };
  assert.deepEqual(await h.service().commitVerified(stale), result);
  const outcomeRaw = await h.store.get(
    competitionOutcomeKey(actor.subredditId, uuid(180))
  );
  assert.ok(outcomeRaw);
  assert.equal(
    parseCompetitionOutcomeRecord(outcomeRaw).receipt.response.verifiedAtMs,
    noon
  );
});

void test('core reconciles an omitted PB through the real Redis adapter contract after an unconfirmed transaction', async () => {
  const { RevisionRedis } = await import('../helpers/revision-redis.ts');
  const { createCompetitionStore } =
    await import('../../src/server/competition-store.ts');
  const redis = new RevisionRedis(noon),
    store = createCompetitionStore(redis, () => noon);
  const service = createCompetitionService({
    context: actor,
    store,
    now: () => noon,
    getUsername: async () => 'AdapterRacer',
    daily: { getForPost: async () => dailyChallengeView(await fixture, noon) },
  });
  const run = await candidate(actor.userId, 190, 900);
  redis.omitSet = personalBestKey(
    actor.subredditId,
    '2026-11-12',
    actor.userId
  );
  redis.alterReply = (replies) => {
    redis.omitSet = undefined;
    redis.alterReply = undefined;
    return replies;
  };
  assert.equal((await service.commitVerified(run)).response.finishTicks, 900);
  const view = await service.getLeaderboard({ sessionId: uuid(190) });
  assert.equal(view.me?.finishTicks, 900);
  assert.equal(view.outcome?.personalBestTicks, 900);
  assert.ok(redis.calls.filter((call) => call === 'watch').length >= 2);
});
