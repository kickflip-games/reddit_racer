import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCompetitionStore } from '../../src/server/competition-store.ts';
import { RevisionRedis } from '../helpers/revision-redis.ts';
import type { CompetitionMutation } from '../../src/server/core/competition.ts';
import { RankedRaceError } from '../../src/shared/ranked-race.ts';

const now = Date.parse('2026-11-12T12:00:00Z');
const deadline = now + 7 * 24 * 60 * 60_000;

function mutation(): CompetitionMutation {
  return {
    expected: [
      { key: 'racer:pb', value: undefined },
      { key: 'racer:receipt', value: undefined },
      { key: 'racer:outcome', value: undefined },
    ],
    sets: [
      { key: 'racer:pb', value: 'best proof', expiresAtMs: deadline },
      { key: 'racer:receipt', value: 'receipt proof', expiresAtMs: deadline },
      { key: 'racer:outcome', value: 'outcome proof', expiresAtMs: deadline },
    ],
    sortedSet: {
      key: 'racer:board',
      member: 't2_racer',
      score: 2800,
      expectedScore: undefined,
      expiresAtMs: deadline,
    },
    increments: [{ key: 'racer:revision', expiresAtMs: deadline }],
  };
}

void test('SDK adapter watches before ordinary reads, commits all related values and confirms expiry', async () => {
  const redis = new RevisionRedis(),
    store = createCompetitionStore(redis, () => now);
  assert.equal(await store.compareAndSwap(mutation()), true);
  assert.equal(redis.calls[0], 'watch');
  assert.ok(redis.calls.indexOf('get') < redis.calls.indexOf('multi'));
  assert.equal(redis.strings.get('racer:pb'), 'best proof');
  assert.equal(redis.strings.get('racer:receipt'), 'receipt proof');
  assert.equal(redis.strings.get('racer:outcome'), 'outcome proof');
  assert.equal(redis.sorted.get('racer:board')?.get('t2_racer'), 2800);
  assert.equal(redis.strings.get('racer:revision'), '1');
  assert.equal(redis.deadlines.get('racer:board'), deadline / 1000);
});
void test('stale expected records and own score abort before queuing and release WATCH', async () => {
  for (const mode of ['record', 'score', 'empty-string']) {
    const redis = new RevisionRedis(),
      store = createCompetitionStore(redis, () => now);
    if (mode === 'record') redis.seed('racer:pb', 'other proof');
    else if (mode === 'empty-string') redis.seed('racer:pb', '');
    else redis.sorted.set('racer:board', new Map([['t2_racer', 2700]]));
    assert.equal(await store.compareAndSwap(mutation()), false);
    assert.ok(redis.calls.includes('unwatch'));
    assert.ok(!redis.calls.includes('multi'));
    assert.equal(redis.strings.has('racer:receipt'), false);
  }
});
void test('forced competing writers cannot both commit from the same watched revision', async () => {
  const redis = new RevisionRedis(),
    store = createCompetitionStore(redis, () => now);
  let entered = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  redis.beforeExec = async () => {
    if (++entered === 2) release();
    await gate;
  };
  const results = await Promise.all([
    store.compareAndSwap(mutation()),
    store.compareAndSwap(mutation()),
  ]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(redis.strings.get('racer:revision'), '1');
});
void test('wrong key types, malformed numeric revisions and queue failures never write receipts', async () => {
  for (const mode of ['type', 'counter', 'queue']) {
    const redis = new RevisionRedis(),
      store = createCompetitionStore(redis, () => now);
    if (mode === 'type') redis.sorted.set('racer:pb', new Map());
    if (mode === 'counter') redis.seed('racer:revision', '-1');
    if (mode === 'queue') redis.failQueue = true;
    await assert.rejects(
      store.compareAndSwap(mutation()),
      (error: unknown) => error instanceof RankedRaceError
    );
    assert.equal(redis.strings.has('racer:receipt'), false);
    assert.ok(redis.calls.includes(mode === 'queue' ? 'discard' : 'unwatch'));
  }
});
void test('empty, malformed, lost and incomplete write confirmations never report CAS success', async () => {
  for (const mode of ['empty', 'short', 'invalid-expiry', 'lost', 'missing']) {
    const redis = new RevisionRedis(),
      store = createCompetitionStore(redis, () => now);
    if (mode === 'empty') redis.alterReply = () => [];
    if (mode === 'short') redis.alterReply = (value) => value.slice(0, -1);
    if (mode === 'invalid-expiry')
      redis.alterReply = (value) => [...value.slice(0, -1), false];
    if (mode === 'lost') redis.loseReply = true;
    if (mode === 'missing') redis.omitSet = 'racer:outcome';
    assert.equal(await store.compareAndSwap(mutation()), false, mode);
    if (mode === 'lost') assert.ok(redis.calls.includes('discard'));
  }
});
void test('bounded range and exact-score reads preserve ties and missing values', async () => {
  const redis = new RevisionRedis(),
    store = createCompetitionStore(redis, () => now);
  redis.sorted.set(
    'racer:board',
    new Map([
      ['t2_c', 200],
      ['t2_a', 100],
      ['t2_b', 100],
    ])
  );
  assert.deepEqual(await store.rangeByRank('racer:board', 0, 1), [
    { member: 't2_a', score: 100 },
    { member: 't2_b', score: 100 },
  ]);
  assert.deepEqual(await store.firstAtScore('racer:board', 100), {
    member: 't2_a',
    score: 100,
  });
  assert.equal(await store.rankOf('racer:board', 'missing'), undefined);
  assert.equal(await store.scoreOf('racer:board', 'missing'), undefined);
  assert.deepEqual(await store.getMany(['racer:missing']), [undefined]);
  await assert.rejects(store.rangeByRank('racer:board', 0, 100));
  await assert.rejects(
    store.getMany(Array.from({ length: 101 }, () => 'racer:x'))
  );
});
void test('expired deadlines and unwatched or repeated writes cannot enter MULTI', async () => {
  const redis = new RevisionRedis(),
    store = createCompetitionStore(redis, () => now);
  const expired = mutation();
  expired.sets[0] && (expired.sets[0].expiresAtMs = now);
  assert.equal(await store.compareAndSwap(expired), false);
  const unwatched = mutation();
  unwatched.sets.push({
    key: 'racer:unwatched',
    value: 'bad',
    expiresAtMs: deadline,
  });
  await assert.rejects(store.compareAndSwap(unwatched));
  assert.ok(!redis.calls.includes('multi'));
});

void test('repair and confirmation mutations may update only the score or revision', async () => {
  const redis = new RevisionRedis(),
    store = createCompetitionStore(redis, () => now);
  const repair = mutation();
  repair.sets = [];
  assert.equal(await store.compareAndSwap(repair), true);
  const confirm = mutation();
  confirm.sets = [];
  delete confirm.sortedSet;
  assert.equal(await store.compareAndSwap(confirm), true);
  assert.equal(redis.strings.get('racer:revision'), '2');
});
