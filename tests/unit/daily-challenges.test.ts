import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDailyChallengeService,
  dailyChallengeKey,
  postBindingsKey,
} from '../../src/server/core/daily-challenges.ts';
import type {
  DailyChallengeServiceDependencies,
  DailyChallengeStore,
} from '../../src/server/core/daily-challenges.ts';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
  DailyChallengeError,
  hashDailyChallenge,
  parseDailyChallenge,
  parseDailyChallengeRecord,
  parseDailyChallengeView,
  rankedSessionExpiresAt,
  serializeDailyChallengeRecord,
  toPublicDailyChallenge,
  utcDay,
  utcDayWindow,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../src/shared/circuit-generator.ts';
import { hashTrack, parseTrack } from '../../src/shared/track.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';

const approved = generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
  generator: { maxAttempts: 1 },
  maxQualityAttempts: 1,
});
const alternate = generateValidatedCircuit('showcase-0');
const noon = Date.parse('2026-11-12T12:00:00Z');
const home = 't5_home',
  postId = 't3_race';

/** Check and set are one synchronous critical section, matching Redis HSETNX. */
class AtomicHashStore implements DailyChallengeStore {
  readonly values = new Map<string, Map<string, string>>();
  writeAttempts = 0;
  writeWins = 0;
  dropWrites = false;
  throwWrites = false;
  async hGet(key: string, field: string): Promise<string | undefined> {
    return this.values.get(key)?.get(field);
  }
  async hSetNX(key: string, field: string, value: string): Promise<number> {
    this.writeAttempts++;
    if (this.throwWrites) throw new Error('Injected storage outage');
    if (this.dropWrites) return 1;
    let hash = this.values.get(key);
    if (!hash) {
      hash = new Map();
      this.values.set(key, hash);
    }
    if (hash.has(field)) return 0;
    hash.set(field, value);
    this.writeWins++;
    return 1;
  }
  inject(key: string, field: string, value: string): void {
    let hash = this.values.get(key);
    if (!hash) {
      hash = new Map();
      this.values.set(key, hash);
    }
    hash.set(field, value);
  }
}
function dependencies(
  store: AtomicHashStore,
  overrides: Partial<DailyChallengeServiceDependencies> = {}
): DailyChallengeServiceDependencies {
  return {
    store,
    now: () => noon,
    getPost: async (id) => ({ id, subredditId: home, createdAtMs: noon }),
    generate: () => approved,
    reserve: () => approved,
    ...overrides,
  };
}
function errorKind(
  kind: DailyChallengeError['kind']
): (error: unknown) => boolean {
  return (error) => error instanceof DailyChallengeError && error.kind === kind;
}
const originalRecord = createDailyChallengeRecord({
  subredditId: home,
  day: '2026-11-12',
  createdAtMs: noon,
  requestedSeed: 'fixture',
  generated: approved,
});

void test('canonical daily/public hashes roundtrip while private snapshots and solver data stay private', async () => {
  const record = await originalRecord;
  const encoded = serializeDailyChallengeRecord(record);
  assert.equal(
    serializeDailyChallengeRecord(
      await parseDailyChallengeRecord(JSON.parse(encoded))
    ),
    encoded
  );
  assert.equal(record.generatorConfig.width, 7);
  assert.equal(record.qualityThresholds.minLiftTicks, 12);
  assert.equal(record.audit.fastFinishTicks, 2848);
  const publicChallenge = toPublicDailyChallenge(record);
  assert.equal(
    (await parseDailyChallenge(publicChallenge)).challengeHash,
    record.challengeHash
  );
  const publicJson = JSON.stringify(publicChallenge);
  for (const field of [
    'audit',
    'generatorConfig',
    'qualityThresholds',
    'fastReplay',
    'transitions',
    'controlPoints',
    'validationWork',
  ])
    assert.ok(!publicJson.includes(`"${field}"`));
  const view = dailyChallengeView(record, noon);
  assert.deepEqual(
    await parseDailyChallengeView(JSON.parse(JSON.stringify(view))),
    JSON.parse(JSON.stringify(view))
  );
  await assert.rejects(
    parseDailyChallengeView({ ...view, currentDay: '2026-11-13' }),
    errorKind('integrity')
  );
  await assert.rejects(
    parseDailyChallenge({
      ...publicChallenge,
      startsAtMs: record.startsAtMs + 1,
    }),
    errorKind('integrity')
  );
  await assert.rejects(
    parseDailyChallenge({
      ...publicChallenge,
      initialConditions: { ...publicChallenge.initialConditions, speed: 1 },
    }),
    errorKind('unsupported')
  );
});

void test('racing candidate writers return the persisted winner, including the loser of a different course', async () => {
  const store = new AtomicHashStore();
  let releaseFirst: () => void = () => {};
  let enteredFirst: () => void = () => {};
  const firstEntered = new Promise<void>((resolve) => {
    enteredFirst = resolve;
  });
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let calls = 0;
  const service = createDailyChallengeService(
    dependencies(store, {
      generate: async () => {
        calls++;
        if (calls === 1) {
          enteredFirst();
          await firstGate;
          return approved;
        }
        return alternate;
      },
    })
  );
  const first = service.getOrCreate({ subredditId: home, day: '2026-11-12' });
  await firstEntered;
  const second = await service.getOrCreate({
    subredditId: home,
    day: '2026-11-12',
  });
  releaseFirst();
  const loser = await first;
  assert.equal(calls, 2);
  assert.equal(store.writeWins, 1);
  assert.equal(store.writeAttempts, 2);
  assert.equal(second.trackHash, await hashTrack(alternate.track));
  assert.equal(loser.challengeHash, second.challengeHash);
  assert.equal(
    serializeDailyChallengeRecord(loser),
    serializeDailyChallengeRecord(second)
  );
  const later = await Promise.all(
    Array.from({ length: 12 }, () =>
      service.getOrCreate({ subredditId: home, day: '2026-11-12' })
    )
  );
  assert.ok(
    later.every((record) => record.challengeHash === second.challengeHash)
  );
  assert.equal(calls, 2, 'stored reads do not regenerate or reassess');
});

void test('deploying a different generator cannot replace a day, its configuration or prior hash', async () => {
  const store = new AtomicHashStore();
  const first = createDailyChallengeService(dependencies(store));
  const before = await first.getForPost({ subredditId: home, postId });
  const bytes = await store.hGet(
    dailyChallengeKey(home, '2026-11-12'),
    'record'
  );
  let generationCalls = 0,
    postCalls = 0;
  const deployed = createDailyChallengeService(
    dependencies(store, {
      generate: () => {
        generationCalls++;
        return alternate;
      },
      reserve: () => {
        throw new Error('must not need reserve');
      },
      getPost: async () => {
        postCalls++;
        throw new Error('stored binding needs no Reddit lookup');
      },
    })
  );
  const after = await deployed.getForPost({ subredditId: home, postId });
  assert.equal(after.challenge.challengeHash, before.challenge.challengeHash);
  assert.equal(
    await store.hGet(dailyChallengeKey(home, '2026-11-12'), 'record'),
    bytes
  );
  assert.equal(generationCalls, 0);
  assert.equal(postCalls, 0);
});

void test('post creation time fixes its original UTC day forever, including missing historical bindings', async () => {
  const store = new AtomicHashStore();
  let clock = Date.parse('2026-11-13T12:00:00Z');
  let trustedCreation = Date.parse('2026-11-12T23:59:59Z');
  let metadataCalls = 0;
  const service = createDailyChallengeService(
    dependencies(store, {
      now: () => clock,
      getPost: async (id) => {
        metadataCalls++;
        return { id, subredditId: home, createdAtMs: trustedCreation };
      },
    })
  );
  const archive = await service.getForPost({ subredditId: home, postId });
  assert.equal(archive.challenge.day, '2026-11-12');
  assert.equal(archive.currentDay, '2026-11-13');
  assert.equal(archive.isCurrent, false);
  assert.equal(archive.rankedWindowOpen, false);
  assert.equal(
    await store.hGet(dailyChallengeKey(home, '2026-11-13'), 'record'),
    undefined
  );
  const boundHash = archive.challenge.challengeHash;
  clock += 30 * 86_400_000;
  trustedCreation = clock;
  const old = await service.getForPost({ subredditId: home, postId });
  assert.equal(old.challenge.day, '2026-11-12');
  assert.equal(old.challenge.challengeHash, boundHash);
  assert.equal(metadataCalls, 1);
  const anotherPost = await service.getForPost({
    subredditId: home,
    postId: 't3_new',
  });
  assert.equal(anotherPost.challenge.day, utcDay(clock));
  assert.notEqual(anotherPost.challenge.id, old.challenge.id);
});

void test('midnight during generation changes eligibility but never the captured post challenge', async () => {
  const store = new AtomicHashStore();
  let clock = Date.parse('2026-11-12T23:59:59Z');
  const createdAtMs = clock;
  const service = createDailyChallengeService(
    dependencies(store, {
      now: () => clock,
      getPost: async (id) => ({ id, subredditId: home, createdAtMs }),
      generate: () => {
        clock = Date.parse('2026-11-13T00:00:00Z');
        return approved;
      },
    })
  );
  const view = await service.getForPost({ subredditId: home, postId });
  assert.equal(view.challenge.day, '2026-11-12');
  assert.equal(view.currentDay, '2026-11-13');
  assert.equal(view.rankedWindowOpen, false);
  assert.equal(view.nextResetAtMs, Date.parse('2026-11-14T00:00:00Z'));
  const expires = rankedSessionExpiresAt(view.challenge, createdAtMs);
  assert.equal(expires, Date.parse('2026-11-13T00:03:00Z'));
  assert.throws(
    () => rankedSessionExpiresAt(view.challenge, clock),
    errorKind('invalid')
  );
  assert.equal(rankedSessionExpiresAt(view.challenge, noon), noon + 5 * 60_000);
});

void test('UTC calendar parsing ignores local offsets and handles leap days without rollover', () => {
  const instant = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(
    utcDay(Date.parse('2026-11-12T13:00:00+13:00')),
    utcDay(instant)
  );
  assert.equal(
    utcDay(Date.parse('2026-11-12T08:00:00+08:00')),
    utcDay(instant)
  );
  assert.equal(
    utcDay(Date.parse('2026-11-11T16:00:00-08:00')),
    utcDay(instant)
  );
  assert.equal(
    utcDayWindow('2028-02-29').endsAtMs,
    Date.parse('2028-03-01T00:00:00Z')
  );
  assert.equal(
    utcDayWindow('2026-09-27').endsAtMs - utcDayWindow('2026-09-27').startsAtMs,
    86_400_000
  );
  for (const invalid of [
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-1-01',
    'tomorrow',
  ])
    assert.throws(() => utcDayWindow(invalid));
});

void test('generator failure uses a fully reapproved reserve; stale approval or an invalid reserve cannot write a day', async () => {
  const store = new AtomicHashStore();
  let reserveCalls = 0;
  const service = createDailyChallengeService(
    dependencies(store, {
      generate: () => {
        throw new Error('generator outage');
      },
      reserve: () => {
        reserveCalls++;
        return approved;
      },
    })
  );
  const record = await service.getOrCreate({
    subredditId: home,
    day: '2026-11-12',
  });
  assert.equal(record.audit.generatorFallback, true);
  assert.equal(record.track.seed, FALLBACK_CIRCUIT_SEED);
  assert.equal(reserveCalls, 1);
  const stale = {
    ...approved,
    track: {
      ...createOvalTrack(),
      generatorVersion: approved.track.generatorVersion,
    },
  };
  await assert.rejects(
    createDailyChallengeRecord({
      subredditId: home,
      day: '2026-11-12',
      createdAtMs: noon,
      requestedSeed: 'stale',
      generated: stale,
    }),
    errorKind('integrity')
  );
  const failedStore = new AtomicHashStore();
  const failed = createDailyChallengeService(
    dependencies(failedStore, {
      generate: () => {
        throw new Error('generator outage');
      },
      reserve: () => ({
        ...approved,
        quality: { ...approved.quality, valid: false },
      }),
    })
  );
  await assert.rejects(
    failed.getOrCreate({ subredditId: home, day: '2026-11-12' }),
    errorKind('unavailable')
  );
  assert.equal(failedStore.writeAttempts, 0);
});

void test('corrupt or unsupported stored records fail closed without replacement or generation', async () => {
  const original = await originalRecord;
  const publicValue = toPublicDailyChallenge(original);
  const variants: { raw: string; kind: DailyChallengeError['kind'] }[] = [
    { raw: '{broken', kind: 'integrity' },
    { raw: '', kind: 'integrity' },
    {
      raw: JSON.stringify({ ...original, schemaVersion: 2 }),
      kind: 'unsupported',
    },
    {
      raw: JSON.stringify({ ...original, simulationVersion: 'future-v3' }),
      kind: 'unsupported',
    },
    {
      raw: JSON.stringify({ ...original, handlingVersion: 'arcade-v99' }),
      kind: 'unsupported',
    },
    {
      raw: JSON.stringify({ ...original, challengeHash: '0'.repeat(64) }),
      kind: 'integrity',
    },
    {
      raw: JSON.stringify({ ...original, trackHash: '0'.repeat(64) }),
      kind: 'integrity',
    },
    {
      raw: JSON.stringify({
        ...original,
        track: {
          ...publicValue.track,
          totalLength: publicValue.track.totalLength + 1,
        },
      }),
      kind: 'integrity',
    },
  ];
  for (const variant of variants) {
    const store = new AtomicHashStore();
    store.inject(dailyChallengeKey(home, '2026-11-12'), 'record', variant.raw);
    let calls = 0;
    const service = createDailyChallengeService(
      dependencies(store, {
        generate: () => {
          calls++;
          return alternate;
        },
      })
    );
    await assert.rejects(
      service.getOrCreate({ subredditId: home, day: '2026-11-12' }),
      errorKind(variant.kind)
    );
    assert.equal(calls, 0);
    assert.equal(store.writeAttempts, 0);
    assert.equal(
      await store.hGet(dailyChallengeKey(home, '2026-11-12'), 'record'),
      variant.raw
    );
  }
});

void test('atomic response without readable persistence never returns a local candidate or guessed binding', async () => {
  const store = new AtomicHashStore();
  store.dropWrites = true;
  const service = createDailyChallengeService(dependencies(store));
  await assert.rejects(
    service.getOrCreate({ subredditId: home, day: '2026-11-12' }),
    errorKind('unavailable')
  );
  await assert.rejects(
    service.bindPost({ subredditId: home, postId }),
    errorKind('unavailable')
  );
  assert.equal(store.values.size, 0);
  const outage = new AtomicHashStore();
  outage.throwWrites = true;
  await assert.rejects(
    createDailyChallengeService(dependencies(outage)).getOrCreate({
      subredditId: home,
      day: '2026-11-12',
    }),
    errorKind('unavailable')
  );
});

void test('missing or wrong trusted post metadata cannot fall back to current-day binding', async () => {
  for (const getPost of [
    async () => {
      throw new Error('Reddit unavailable');
    },
    async () => ({ id: postId, subredditId: 't5_other', createdAtMs: noon }),
    async () => ({ id: 't3_other', subredditId: home, createdAtMs: noon }),
    async () => ({ id: postId, subredditId: home, createdAtMs: NaN }),
  ]) {
    const store = new AtomicHashStore();
    const service = createDailyChallengeService(
      dependencies(store, { getPost })
    );
    await assert.rejects(service.getForPost({ subredditId: home, postId }));
    assert.equal(store.writeAttempts, 0);
  }
  const store = new AtomicHashStore();
  store.inject(
    postBindingsKey(home),
    postId,
    JSON.stringify({
      schemaVersion: 1,
      postId,
      subredditId: home,
      day: '2026-11-13',
      createdAtMs: noon,
    })
  );
  await assert.rejects(
    createDailyChallengeService(dependencies(store)).getForPost({
      subredditId: home,
      postId,
    }),
    errorKind('integrity')
  );
  assert.equal(store.writeAttempts, 0);
});

void test('historical generator/quality provenance remains readable with supported stored race rules', async () => {
  const original = await originalRecord;
  const track = parseTrack(JSON.parse(JSON.stringify(original.track)));
  track.generatorVersion = 'historic-generator';
  const publicValue = {
    ...toPublicDailyChallenge(original),
    track,
    trackHash: await hashTrack(track),
    generatorVersion: track.generatorVersion,
    qualityVersion: 'historic-quality',
  };
  const historical = {
    ...original,
    ...publicValue,
    challengeHash: await hashDailyChallenge(publicValue),
    generatorConfig: { historicalParameter: 42 },
    qualityThresholds: { historicalThreshold: 1 },
  };
  const parsed = await parseDailyChallengeRecord(
    JSON.parse(serializeDailyChallengeRecord(historical))
  );
  assert.equal(parsed.generatorVersion, 'historic-generator');
  assert.equal(parsed.qualityVersion, 'historic-quality');
  assert.equal(parsed.challengeHash, historical.challengeHash);
});
