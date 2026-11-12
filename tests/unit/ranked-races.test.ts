import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createNxReceiptCommitter,
  createRankedRaceService,
  parseRankedSession,
  parseVerificationReceipt,
  RECEIPT_RETENTION_MS,
  receiptKey,
  serializeRankedSession,
  sessionKey,
  SESSION_METADATA_GRACE_MS,
} from '../../src/server/core/ranked-races.ts';
import type {
  RankedRaceServiceDependencies,
  RankedStore,
  VerifiedRunCommit,
} from '../../src/server/core/ranked-races.ts';
import {
  fingerprintReplay,
  parseRankedSubmission,
  parseStartRankedRaceResponse,
  parseVerifiedRunResponse,
  RankedRaceError,
} from '../../src/shared/ranked-race.ts';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../src/shared/circuit-generator.ts';
import { MAX_REPLAY_TRANSITIONS } from '../../src/shared/replay.ts';

const noon = Date.parse('2026-11-12T12:00:00Z');
const approved = generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
  generator: { maxAttempts: 1 },
  maxQualityAttempts: 1,
});
const fastReplay = approved.quality.fastReplay;
if (!fastReplay) throw new Error('Missing validated reserve replay');
const replay = fastReplay;
const holdReplay = {
  ...replay,
  transitions: [{ tick: 0, held: true }],
  endTick: 3318,
};
const fixture = createDailyChallengeRecord({
  subredditId: 't5_home',
  day: '2026-11-12',
  createdAtMs: noon,
  requestedSeed: 'ranked-fixture',
  generated: approved,
});
const actor = { userId: 't2_racer', subredditId: 't5_home', postId: 't3_race' };
const uuid = (index: number): string =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
function kind(expected: RankedRaceError['kind']): (error: unknown) => boolean {
  return (error) => error instanceof RankedRaceError && error.kind === expected;
}

/** Absolute TTL and check+set are atomic; no await between inspection and insertion. */
class AtomicExpiringStore implements RankedStore {
  readonly entries = new Map<string, { value: string; expiresAtMs: number }>();
  writeAttempts = 0;
  writeWins = 0;
  dropReceipts = false;
  throwReads = false;
  constructor(private readonly clock: () => number) {}
  async get(key: string): Promise<string | undefined> {
    if (this.throwReads) throw new Error('Injected read outage');
    const entry = this.entries.get(key);
    if (entry && entry.expiresAtMs <= this.clock()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry?.value;
  }
  async setNX(
    key: string,
    value: string,
    expiresAtMs: number
  ): Promise<boolean> {
    this.writeAttempts++;
    const existing = this.entries.get(key);
    if (existing && existing.expiresAtMs <= this.clock())
      this.entries.delete(key);
    if (this.entries.has(key)) return false;
    if (this.dropReceipts && key.startsWith('racer:receipt:')) return true;
    this.entries.set(key, { value, expiresAtMs });
    this.writeWins++;
    return true;
  }
}
function setup() {
  let clock = noon,
    sequence = 0;
  const counts = { starts: 0, verifies: 0, commits: 0, dailyReads: 0 };
  const store = new AtomicExpiringStore(() => clock);
  const nx = createNxReceiptCommitter(store);
  const deps: RankedRaceServiceDependencies = {
    context: actor,
    store,
    daily: {
      getForPost: async () => dailyChallengeView(await fixture, clock),
      read: async () => {
        counts.dailyReads++;
        return fixture;
      },
    },
    now: () => clock,
    newSessionId: () => uuid(++sequence),
    consumeStartBudget: async () => {
      counts.starts++;
    },
    consumeVerifyBudget: async () => {
      counts.verifies++;
    },
    commitVerified: async (candidate) => {
      counts.commits++;
      return nx(candidate);
    },
  };
  return {
    store,
    counts,
    deps,
    nx,
    service: createRankedRaceService(deps),
    setClock: (value: number) => {
      clock = value;
    },
  };
}

void test('authenticated sessions pin stored rules and return only authoritative verified time', async () => {
  const harness = setup(),
    started = await harness.service.start();
  assert.equal(started.challengeHash, (await fixture).challengeHash);
  assert.equal(started.expiresAtMs, noon + 5 * 60_000);
  const raw = await harness.store.get(
    sessionKey(actor.subredditId, started.sessionId)
  );
  assert.ok(raw);
  const session = parseRankedSession(raw);
  assert.equal(session.userId, actor.userId);
  assert.equal(session.postId, actor.postId);
  assert.equal(
    harness.store.entries.get(sessionKey(actor.subredditId, started.sessionId))
      ?.expiresAtMs,
    session.expiresAtMs + SESSION_METADATA_GRACE_MS
  );
  const response = await harness.service.submit({
    sessionId: started.sessionId,
    replay,
  });
  assert.equal(response.finishTicks, 2848);
  assert.equal(response.finishTimeMs, (2848 * 1000) / 120);
  assert.equal(response.challengeHash, started.challengeHash);
  assert.equal(harness.counts.verifies, 1);
  assert.equal(harness.counts.commits, 1);
  assert.deepEqual(parseStartRankedRaceResponse(started), started);
  assert.deepEqual(parseVerifiedRunResponse(response), response);
  const receiptRaw = await harness.store.get(
    receiptKey(actor.subredditId, started.sessionId)
  );
  assert.ok(receiptRaw);
  assert.equal(parseVerificationReceipt(receiptRaw).response.finishTicks, 2848);
  assert.equal(
    harness.store.entries.get(receiptKey(actor.subredditId, started.sessionId))
      ?.expiresAtMs,
    response.verifiedAtMs + RECEIPT_RETENTION_MS
  );
  assert.ok(!JSON.stringify(response).includes('userId'));
  assert.ok(!JSON.stringify(response).includes('replayFingerprint'));
});

void test('account, originating post and installation scope cannot be supplied or borrowed', async () => {
  const h = setup(),
    started = await h.service.start();
  for (const context of [
    { ...actor, userId: 't2_other' },
    { ...actor, postId: 't3_other' },
  ]) {
    const intruder = createRankedRaceService({ ...h.deps, context });
    await assert.rejects(
      intruder.submit({ sessionId: started.sessionId, replay }),
      kind('forbidden')
    );
  }
  const otherScope = createRankedRaceService({
    ...h.deps,
    context: { ...actor, subredditId: 't5_other' },
  });
  await assert.rejects(
    otherScope.submit({ sessionId: started.sessionId, replay })
  );
  const signedOut = createRankedRaceService({
    ...h.deps,
    context: { subredditId: actor.subredditId, postId: actor.postId },
  });
  await assert.rejects(signedOut.start(), kind('unauthenticated'));
  await assert.rejects(
    signedOut.submit({
      sessionId: started.sessionId,
      replay,
      userId: actor.userId,
    }),
    kind('unauthenticated')
  );
  assert.equal(h.counts.verifies, 0);
  assert.equal(h.counts.commits, 0);
});

void test('submission schema rejects client times, forged data, invalid tick streams and processing excess', async () => {
  const h = setup(),
    started = await h.service.start();
  const payload = { sessionId: started.sessionId, replay };
  for (const malformed of [
    { ...payload, time: 1 },
    { ...payload, userId: 't2_fake' },
    { ...payload, track: {} },
    { ...payload, sessionId: 'not-a-uuid' },
    { ...payload, replay: { ...replay, endTick: 14401 } },
    {
      ...payload,
      replay: { ...replay, transitions: [{ tick: 0.1, held: true }] },
    },
    { ...payload, replay: { ...replay, transitions: [{ tick: 0, held: 1 }] } },
    {
      ...payload,
      replay: {
        ...replay,
        transitions: [
          { tick: 0, held: true },
          { tick: 0, held: false },
        ],
      },
    },
    {
      ...payload,
      replay: {
        ...replay,
        transitions: Array.from(
          { length: MAX_REPLAY_TRANSITIONS + 1 },
          (_, tick) => ({ tick, held: tick % 2 === 0 })
        ),
      },
    },
  ])
    await assert.rejects(h.service.submit(malformed), kind('invalid'));
  await assert.rejects(
    h.service.submit({
      ...payload,
      replay: { ...replay, simulationVersion: 'future-v3' },
    }),
    kind('unsupported')
  );
  await assert.rejects(
    h.service.submit({
      ...payload,
      replay: {
        ...replay,
        transitions: [{ tick: 0, held: true }],
        endTick: 100,
      },
    }),
    kind('invalid')
  );
  assert.equal(h.counts.commits, 0);
  assert.equal(
    h.counts.verifies,
    1,
    'only the bounded but incomplete replay reaches simulation allowance'
  );
});

void test('canonical replay fingerprint ignores object insertion order but changes with sampled inputs', async () => {
  const reordered = {
    endTick: replay.endTick,
    transitions: replay.transitions.map(({ tick, held }) => ({ held, tick })),
    handlingVersion: replay.handlingVersion,
    simulationVersion: replay.simulationVersion,
    schemaVersion: replay.schemaVersion,
  };
  const normalized = parseRankedSubmission({
    replay: reordered,
    sessionId: uuid(1),
  }).replay;
  assert.equal(
    await fingerprintReplay(normalized),
    await fingerprintReplay(replay)
  );
  assert.notEqual(
    await fingerprintReplay(holdReplay),
    await fingerprintReplay(replay)
  );
});

void test('a retained same-payload receipt returns unchanged after expiry without new allowance or stored session', async () => {
  const h = setup(),
    started = await h.service.start();
  const first = await h.service.submit({
    sessionId: started.sessionId,
    replay,
  });
  h.setClock(started.expiresAtMs + 1);
  h.store.entries.delete(sessionKey(actor.subredditId, started.sessionId));
  const noRead = createRankedRaceService({
    ...h.deps,
    daily: {
      ...h.deps.daily,
      read: async () => {
        throw new Error('must not reverify a receipt');
      },
    },
    consumeVerifyBudget: async () => {
      throw new Error('must not consume more allowance');
    },
  });
  assert.deepEqual(
    await noRead.submit({ sessionId: started.sessionId, replay }),
    first
  );
  await assert.rejects(
    noRead.submit({ sessionId: started.sessionId, replay: holdReplay }),
    kind('conflict')
  );
  const intruder = createRankedRaceService({
    ...h.deps,
    context: { ...actor, userId: 't2_other' },
  });
  await assert.rejects(
    intruder.submit({ sessionId: started.sessionId, replay }),
    kind('forbidden')
  );
  h.setClock(first.verifiedAtMs + RECEIPT_RETENTION_MS + 1);
  await assert.rejects(
    h.service.submit({ sessionId: started.sessionId, replay }),
    kind('expired')
  );
  assert.equal(h.counts.verifies, 1);
  assert.equal(h.counts.commits, 1);
});

void test('receipt deletion cannot permit another commit while expired session metadata remains', async () => {
  const h = setup(),
    started = await h.service.start();
  const response = await h.service.submit({
    sessionId: started.sessionId,
    replay,
  });
  h.setClock(response.verifiedAtMs + RECEIPT_RETENTION_MS + 1);
  assert.ok(
    await h.store.get(sessionKey(actor.subredditId, started.sessionId)),
    'metadata outlives this receipt'
  );
  await assert.rejects(
    h.service.submit({ sessionId: started.sessionId, replay }),
    kind('expired')
  );
  assert.equal(h.counts.commits, 1);
});

void test('concurrent identical submissions return the one stored receipt', async () => {
  const h = setup(),
    started = await h.service.start();
  let entered = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrent = createRankedRaceService({
    ...h.deps,
    commitVerified: async (candidate) => {
      entered++;
      if (entered === 2) release();
      await gate;
      return h.nx(candidate);
    },
  });
  const results = await Promise.all([
    concurrent.submit({ sessionId: started.sessionId, replay }),
    concurrent.submit({ sessionId: started.sessionId, replay }),
  ]);
  assert.equal(entered, 2);
  assert.deepEqual(results[0], results[1]);
  assert.equal(h.store.writeWins, 2, 'one session and one receipt');
});

void test('concurrent different valid replays consume the session only once and conflict for the loser', async () => {
  const h = setup(),
    started = await h.service.start();
  let entered = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const concurrent = createRankedRaceService({
    ...h.deps,
    commitVerified: async (candidate) => {
      entered++;
      if (entered === 2) release();
      await gate;
      return h.nx(candidate);
    },
  });
  const results = await Promise.allSettled([
    concurrent.submit({ sessionId: started.sessionId, replay }),
    concurrent.submit({ sessionId: started.sessionId, replay: holdReplay }),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1
  );
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(
    rejected &&
      rejected.status === 'rejected' &&
      rejected.reason instanceof RankedRaceError &&
      rejected.reason.kind === 'conflict'
  );
  assert.equal(h.store.writeWins, 2);
});

void test('failed persistence does not consume a session; read-back confirmation is mandatory', async () => {
  const h = setup(),
    started = await h.service.start();
  let attempts = 0;
  const retryable = createRankedRaceService({
    ...h.deps,
    commitVerified: async (candidate) => {
      attempts++;
      if (attempts === 1) throw new Error('transaction unavailable');
      return h.nx(candidate);
    },
  });
  await assert.rejects(
    retryable.submit({ sessionId: started.sessionId, replay }),
    kind('unavailable')
  );
  assert.equal(
    await h.store.get(receiptKey(actor.subredditId, started.sessionId)),
    undefined
  );
  assert.equal(
    (await retryable.submit({ sessionId: started.sessionId, replay }))
      .finishTicks,
    2848
  );
  const other = setup(),
    pending = await other.service.start();
  other.store.dropReceipts = true;
  await assert.rejects(
    other.service.submit({ sessionId: pending.sessionId, replay }),
    kind('unavailable')
  );
  other.store.dropReceipts = false;
  assert.equal(
    (await other.service.submit({ sessionId: pending.sessionId, replay }))
      .finishTicks,
    2848
  );
});

void test('retained receipt verified before expiry survives persistence latency across the deadline', async () => {
  const h = setup(),
    started = await h.service.start();
  const slowCommit = createRankedRaceService({
    ...h.deps,
    commitVerified: async (candidate) => {
      const winner = await h.nx(candidate);
      h.setClock(started.expiresAtMs + 1);
      return winner;
    },
  });
  const response = await slowCommit.submit({
    sessionId: started.sessionId,
    replay,
  });
  assert.ok(response.verifiedAtMs < started.expiresAtMs);
  assert.deepEqual(
    await h.service.submit({ sessionId: started.sessionId, replay }),
    response
  );
});

void test('expired, changed-rule or missing stored challenges cannot accept a new verification', async () => {
  const h = setup(),
    started = await h.service.start();
  const invalidChallenge = createRankedRaceService({
    ...h.deps,
    daily: {
      ...h.deps.daily,
      read: async () => ({ ...(await fixture), trackHash: '0'.repeat(64) }),
    },
  });
  await assert.rejects(
    invalidChallenge.submit({ sessionId: started.sessionId, replay }),
    kind('integrity')
  );
  const missingChallenge = createRankedRaceService({
    ...h.deps,
    daily: { ...h.deps.daily, read: async () => null },
  });
  await assert.rejects(
    missingChallenge.submit({ sessionId: started.sessionId, replay }),
    kind('integrity')
  );
  const raw = await h.store.get(
    sessionKey(actor.subredditId, started.sessionId)
  );
  assert.ok(raw);
  const session = parseRankedSession(raw);
  h.store.entries.set(sessionKey(actor.subredditId, started.sessionId), {
    value: serializeRankedSession({
      ...session,
      handlingVersion: 'future-handling',
    }),
    expiresAtMs: session.expiresAtMs + SESSION_METADATA_GRACE_MS,
  });
  await assert.rejects(
    h.service.submit({ sessionId: started.sessionId, replay }),
    kind('integrity')
  );
  h.setClock(started.expiresAtMs);
  await assert.rejects(
    h.service.submit({ sessionId: started.sessionId, replay }),
    kind('expired')
  );
  assert.equal(h.counts.commits, 0);
});

void test('expiry after replay or immediately before commit cannot consume a receipt', async () => {
  for (const expiresOnRead of [3, 4]) {
    const h = setup(),
      started = await h.service.start();
    let reads = 0;
    const boundary = createRankedRaceService({
      ...h.deps,
      now: () => {
        reads++;
        return reads >= expiresOnRead ? started.expiresAtMs : noon;
      },
    });
    await assert.rejects(
      boundary.submit({ sessionId: started.sessionId, replay }),
      kind('expired')
    );
    assert.equal(h.counts.commits, 0);
  }
});

void test('midnight starts are rechecked after allowance/load and in-flight runs keep their original challenge', async () => {
  const h = setup();
  h.setClock(Date.parse('2026-11-12T23:59:59Z'));
  const started = await h.service.start();
  assert.equal(started.expiresAtMs, Date.parse('2026-11-13T00:03:00Z'));
  h.setClock(Date.parse('2026-11-13T00:00:30Z'));
  const verified = await h.service.submit({
    sessionId: started.sessionId,
    replay,
  });
  assert.equal(verified.challengeId, 't5_home:2026-11-12');
  await assert.rejects(h.service.start(), kind('archive'));
  const midnightDuringLoad = setup();
  midnightDuringLoad.setClock(Date.parse('2026-11-12T23:59:59Z'));
  const delayed = createRankedRaceService({
    ...midnightDuringLoad.deps,
    daily: {
      ...midnightDuringLoad.deps.daily,
      getForPost: async () => {
        const view = dailyChallengeView(
          await fixture,
          Date.parse('2026-11-12T23:59:59Z')
        );
        midnightDuringLoad.setClock(Date.parse('2026-11-13T00:00:00Z'));
        return view;
      },
    },
  });
  await assert.rejects(delayed.start(), kind('archive'));
  assert.equal(midnightDuringLoad.store.writeAttempts, 0);
});

void test('request allowances reject before work and session-ID collisions are bounded', async () => {
  const h = setup();
  const limited = createRankedRaceService({
    ...h.deps,
    consumeStartBudget: async () => {
      throw new RankedRaceError('rate-limited', 'Try later');
    },
  });
  await assert.rejects(limited.start(), kind('rate-limited'));
  assert.equal(h.store.writeAttempts, 0);
  const started = await h.service.start();
  const verifyLimited = createRankedRaceService({
    ...h.deps,
    consumeVerifyBudget: async () => {
      throw new RankedRaceError('rate-limited', 'Try later');
    },
  });
  await assert.rejects(
    verifyLimited.submit({ sessionId: started.sessionId, replay }),
    kind('rate-limited')
  );
  assert.equal(h.counts.commits, 0);
  let ids = 0;
  const collisions = createRankedRaceService({
    ...h.deps,
    newSessionId: () => {
      ids++;
      return started.sessionId;
    },
  });
  await assert.rejects(collisions.start(), kind('unavailable'));
  assert.equal(ids, 3);
  assert.equal(h.store.writeWins, 1);
});

void test('invalid committed winner cannot replace ownership, replay or authoritative score', async () => {
  const h = setup(),
    started = await h.service.start();
  const wrongWinner = createRankedRaceService({
    ...h.deps,
    commitVerified: async (candidate: VerifiedRunCommit) => ({
      schemaVersion: 1,
      ...candidate,
      replayFingerprint: '0'.repeat(64),
    }),
  });
  await assert.rejects(
    wrongWinner.submit({ sessionId: started.sessionId, replay }),
    kind('conflict')
  );
  await assert.rejects(
    Promise.resolve().then(() =>
      parseVerifiedRunResponse({
        sessionId: started.sessionId,
        challengeId: started.challengeId,
        challengeHash: started.challengeHash,
        finishTicks: 1,
        simulationHz: 120,
        finishTimeMs: 0,
        verifiedAtMs: noon,
      })
    ),
    kind('integrity')
  );
});
