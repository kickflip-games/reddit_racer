import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RevisionRedis } from '../helpers/revision-redis.ts';
import {
  runPrivateRedisSmoke,
  type PrivateRedisSmokeDependencies,
  type PrivateRedisSmokeResult,
  type SmokeRedis,
} from '../../src/server/diagnostics/redis-smoke.ts';

const now = Date.parse('2026-11-12T12:00:00Z');
function setup() {
  const values = new Map<string, string>(),
    calls: { method: string; keys: string[]; expiration?: number }[] = [],
    logs: PrivateRedisSmokeResult[] = [];
  let duplicate = false,
    failAfterMarker = false;
  const store: SmokeRedis = {
    get: async (key) => values.get(key),
    set: async (key, value, options) => {
      calls.push({
        method: 'set',
        keys: [key],
        ...(options?.expiration
          ? { expiration: options.expiration.getTime() }
          : {}),
      });
      if (options?.nx && duplicate) return '';
      if (failAfterMarker && !options?.nx)
        throw new Error('secret-token-must-never-be-logged');
      values.set(key, value);
      return 'OK';
    },
    del: async (...keys) => {
      calls.push({ method: 'del', keys });
      keys.forEach((key) => values.delete(key));
    },
    watch: async (key) => {
      calls.push({ method: 'watch', keys: [key] });
      return {
        multi: async () => {},
        set: async () => {},
        incrBy: async () => {},
        zAdd: async () => {},
        expire: async () => {},
        exec: async () => ['unexpected'],
        discard: async () => {},
        unwatch: async () => {},
      };
    },
    expireTime: async () => -1,
    zRange: async () => [],
    zRank: async () => undefined,
    zScore: async () => undefined,
    type: async (key) => (values.has(key) ? 'string' : 'none'),
    mGet: async (keys) => keys.map((key) => values.get(key) ?? null),
  };
  const deps: PrivateRedisSmokeDependencies = {
    context: {
      appSlug: 'full-throttle-dev',
      appVersion: '0.0.6',
      subredditId: 't5_kv7foq',
      subredditName: 'full_throttle_dev_dev',
    },
    redis: store,
    now: () => now,
    nonce: () => 'bounded-probe',
    log: (result) => logs.push(result),
  };
  return {
    deps,
    calls,
    logs,
    values,
    duplicate: () => {
      duplicate = true;
    },
    failAfterMarker: () => {
      failAfterMarker = true;
    },
  };
}
void test('diagnostic authorization requires the exact trusted app, private version and home scope', async () => {
  for (const override of [
    { appSlug: 'other-app' },
    { appVersion: '0.0.2' },
    { appVersion: '0.0.3' },
    { appVersion: '0.0.4' },
    { appVersion: '0.0.5' },
    { appVersion: '0.0.6.1' },
    { appVersion: undefined },
    { subredditId: 't5_other' },
    { subredditName: 'other_home' },
  ]) {
    const h = setup();
    h.deps.context = { ...h.deps.context, ...override };
    assert.deepEqual(await runPrivateRedisSmoke(h.deps), {
      status: 'skipped',
      version: '0.0.6',
      reason: 'scope',
    });
    assert.equal(h.calls.length, 0);
    assert.equal(h.logs.length, 0);
  }
});
void test('an existing per-build marker prevents all diagnostic data writes', async () => {
  const h = setup();
  h.duplicate();
  assert.deepEqual(await runPrivateRedisSmoke(h.deps), {
    status: 'skipped',
    version: '0.0.6',
    reason: 'already-ran',
  });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]?.expiration, now + 120_000);
});
void test('failed controls clean only their five temporary keys and retain a bounded 24-hour report', async () => {
  const h = setup(),
    result = await runPrivateRedisSmoke(h.deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks?.cleanup, true);
  const cleanup = h.calls.find((call) => call.method === 'del');
  assert.equal(cleanup?.keys.length, 5);
  assert.ok(
    cleanup?.keys.every((key) =>
      key.startsWith('racer:diagnostic:redis-smoke:0.0.6:bounded-probe:')
    )
  );
  assert.ok(
    !h.calls.some((call) =>
      call.keys.some(
        (key) =>
          key.startsWith('racer:leaderboard:') ||
          key.startsWith('racer:pb:') ||
          key.startsWith('racer:session:')
      )
    )
  );
  assert.equal(h.values.size, 1);
  assert.equal(h.calls.at(-1)?.expiration, now + 24 * 60 * 60_000);
  assert.equal(h.logs.length, 1);
  assert.ok(JSON.stringify(result).length < 4096);
});
void test('RPC errors cannot expose arbitrary text, metadata or credentials in retained diagnostic reports', async () => {
  const h = setup();
  h.failAfterMarker();
  const result = await runPrivateRedisSmoke(h.deps);
  assert.equal(result.status, 'failed');
  assert.ok(!JSON.stringify(result).includes('secret-token'));
  assert.ok(!JSON.stringify(h.logs).includes('secret-token'));
  assert.ok(!JSON.stringify([...h.values.values()]).includes('secret-token'));
});

void test('all diagnostic controls include the real adapter and share exactly five cleaned data keys', async () => {
  const h = setup();
  const redis = new RevisionRedis(now);
  h.deps.redis = redis;
  const result = await runPrivateRedisSmoke(h.deps);
  assert.equal(result.status, 'passed');
  assert.equal(result.checks?.adapterCommit, true);
  assert.ok(Object.values(result.checks ?? {}).every((value) => value));
  assert.equal(result.exec?.length, 5);
  assert.equal(
    redis.calls.filter((call) => call === 'exec').length,
    7,
    'five raw controls and both adapter mutations execute'
  );
  assert.equal(
    result.exec?.find((entry) => entry.label === 'external-change')?.kind,
    'array'
  );
  assert.equal(
    result.exec?.find((entry) => entry.label === 'competing-loser')?.kind,
    'array'
  );
  assert.equal(
    redis.strings.size,
    1,
    'only the bounded report marker survives'
  );
  assert.equal(redis.sorted.size, 0);
  assert.equal(redis.deadlines.size, 1);
  const duplicate = await runPrivateRedisSmoke(h.deps);
  assert.equal(duplicate.status, 'skipped');
  assert.equal(duplicate.reason, 'already-ran');
});

void test('an unrelated EXEC outage with unchanged sentinel does not prove WATCH conflict handling', async () => {
  const h = setup(),
    redis = new RevisionRedis(now);
  let executions = 0;
  redis.beforeExec = async () => {
    if (++executions === 2) throw new Error('network unavailable');
  };
  h.deps.redis = redis;
  const result = await runPrivateRedisSmoke(h.deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks?.unchangedCommit, true);
  assert.equal(result.checks?.externalChangeAborted, false);
  assert.equal(result.checks?.cleanup, true);
});

void test('cleanup cannot mistake an undeleted sorted set for an absent MGET value', async () => {
  const h = setup(),
    redis = new RevisionRedis(now);
  const remove = redis.del.bind(redis);
  let removals = 0;
  redis.del = async (...keys) => {
    const board = [...redis.sorted.entries()][0];
    await remove(...keys);
    if (++removals === 3 && board) redis.sorted.set(board[0], board[1]);
  };
  h.deps.redis = redis;
  const result = await runPrivateRedisSmoke(h.deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks?.adapterCommit, true);
  assert.equal(result.checks?.cleanup, false);
});

void test('creating a score alone cannot pass if the existing sorted-set type is unsupported', async () => {
  const h = setup(),
    redis = new RevisionRedis(now);
  const type = redis.type.bind(redis);
  redis.type = async (key) =>
    redis.sorted.has(key) ? 'unsupported-set' : type(key);
  h.deps.redis = redis;
  const result = await runPrivateRedisSmoke(h.deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks?.adapterCommit, false);
  assert.equal(result.checks?.cleanup, true);
  assert.equal(
    redis.calls.filter((call) => call === 'exec').length,
    6,
    'initial adapter creation succeeds; improvement fails closed before EXEC'
  );
});

void test('hosted score-first member fields and null EXPIRE acknowledgements pass only with real TTLs', async () => {
  for (const omitExpiry of [false, true]) {
    const h = setup(),
      redis = new RevisionRedis(now);
    redis.expireAck = null;
    redis.omitExpiry = omitExpiry;
    h.deps.redis = redis;
    const result = await runPrivateRedisSmoke(h.deps);
    assert.equal(result.status, omitExpiry ? 'failed' : 'passed');
    assert.equal(
      result.checks?.sortedReads,
      true,
      'member property insertion order does not change row equality'
    );
    assert.equal(result.checks?.expirations, !omitExpiry);
    assert.equal(result.checks?.adapterCommit, !omitExpiry);
    assert.equal(result.checks?.cleanup, true);
  }
});

void test('expiry failures retain raw labelled values and clock context before failing closed', async () => {
  const h = setup(),
    redis = new RevisionRedis(now);
  redis.expireTime = async (key) => (key.endsWith(':board') ? 123.5 : -1);
  h.deps.redis = redis;
  const result = await runPrivateRedisSmoke(h.deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks?.expirations, false);
  assert.equal(result.checks?.adapterCommit, false);
  assert.equal(result.checks?.cleanup, true);
  assert.deepEqual(result.expiry, {
    nowMs: now,
    nowSeconds: now / 1000,
    expectedDeadlineMs: now + 120_000,
    values: [
      { label: 'control', type: 'number', rawNumber: -1, isSafeInteger: true },
      { label: 'sentinel', type: 'number', rawNumber: -1, isSafeInteger: true },
      { label: 'pair', type: 'number', rawNumber: -1, isSafeInteger: true },
      {
        label: 'board',
        type: 'number',
        rawNumber: 123.5,
        isSafeInteger: false,
      },
    ],
  });
  assert.deepEqual(h.logs[0]?.expiry, result.expiry);
  assert.ok(!JSON.stringify(result.expiry).includes('racer:'));
  assert.ok(!JSON.stringify(result.expiry).includes('bounded-probe'));
});

void test('nonfinite expiry observations are JSON-safe and never become successful TTL proof', async () => {
  const h = setup(),
    redis = new RevisionRedis(now);
  redis.expireTime = async () => NaN;
  h.deps.redis = redis;
  const result = await runPrivateRedisSmoke(h.deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.checks?.expirations, false);
  assert.ok(
    result.expiry?.values.every(
      (value) =>
        value.rawNumber === null &&
        value.nonFinite === 'NaN' &&
        value.type === 'number' &&
        !value.isSafeInteger
    )
  );
  const retained = [...redis.strings.values()][0];
  assert.ok(retained?.includes('"nonFinite":"NaN"'));
  assert.ok(!retained?.includes('secret-token'));
});

void test('observed hosted TTL seconds pass while an arbitrary one-second expiry cannot pass', async () => {
  for (const short of [false, true]) {
    const h = setup(),
      redis = new RevisionRedis(now);
    redis.expireAck = null;
    const remaining = redis.expireTime.bind(redis);
    redis.expireTime = async (key) =>
      short
        ? 1
        : key.endsWith(':board')
          ? remaining(key)
          : (await remaining(key)) - 1;
    h.deps.redis = redis;
    const result = await runPrivateRedisSmoke(h.deps);
    assert.equal(result.status, short ? 'failed' : 'passed');
    assert.equal(result.checks?.expirations, !short);
    assert.equal(result.checks?.adapterCommit, !short);
    assert.equal(result.checks?.cleanup, true);
    assert.deepEqual(
      result.expiry?.values.map((entry) => entry.rawNumber),
      short ? [1, 1, 1, 1] : [119, 119, 119, 120]
    );
  }
});
