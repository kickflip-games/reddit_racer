import { context, redis } from '@devvit/web/server';
import {
  createCompetitionStore,
  type CompetitionRedis,
  type CompetitionTransaction,
} from '../competition-store';

export const PRIVATE_REDIS_SMOKE_VERSION = '0.0.4';
export const PRIVATE_REDIS_SMOKE_HOME_ID = 't5_kv7foq';
export const PRIVATE_REDIS_SMOKE_HOME_NAME = 'full_throttle_dev_dev';
const DATA_TTL_MS = 120_000;
const REPORT_TTL_MS = 24 * 60 * 60_000;
const MARKER = `racer:diagnostic:redis-smoke:${PRIVATE_REDIS_SMOKE_VERSION}:once`;

type SetOptions = { nx?: boolean; expiration?: Date };
export type SmokeTransaction = CompetitionTransaction;
export type SmokeRedis = CompetitionRedis & {
  set: (key: string, value: string, options?: SetOptions) => Promise<string>;
  del: (...keys: string[]) => Promise<void>;
};
type SafeError = {
  name: string;
  code?: string | number;
  redisTransactionFailed: boolean;
};
export type ExecObservation =
  | { label: string; kind: 'array'; length: number; values: string[] }
  | { label: string; kind: 'unexpected' }
  | { label: string; kind: 'thrown'; error: SafeError };
export type PrivateRedisSmokeResult = {
  status: 'passed' | 'failed' | 'skipped';
  version: string;
  reason?: 'scope' | 'already-ran' | 'unavailable';
  checks?: {
    unchangedCommit: boolean;
    externalChangeAborted: boolean;
    competingWatchAborted: boolean;
    sortedReads: boolean;
    expirations: boolean;
    adapterCommit: boolean;
    cleanup: boolean;
  };
  exec?: ExecObservation[];
  error?: SafeError;
};
export type PrivateRedisSmokeDependencies = {
  context: {
    appSlug: unknown;
    appVersion: unknown;
    subredditId: unknown;
    subredditName: unknown;
  };
  redis: SmokeRedis;
  now: () => number;
  nonce: () => string;
  log: (result: PrivateRedisSmokeResult) => void;
};

function safeError(error: unknown): SafeError {
  const name = error instanceof Error ? error.name : 'UnknownError';
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  return {
    name: [
      'Error',
      'TypeError',
      'RangeError',
      'TwirpError',
      'ConnectError',
    ].includes(name)
      ? name
      : 'Error',
    ...(typeof code === 'number' &&
    Number.isSafeInteger(code) &&
    code >= 0 &&
    code <= 599
      ? { code }
      : typeof code === 'string' &&
          [
            'UNKNOWN',
            'ABORTED',
            'FAILED_PRECONDITION',
            'UNAVAILABLE',
            'DEADLINE_EXCEEDED',
            'RESOURCE_EXHAUSTED',
            'INTERNAL',
            'CANCELLED',
          ].includes(code)
        ? { code }
        : {}),
    // Preserve the known Redis discriminator without logging arbitrary RPC text.
    redisTransactionFailed:
      error instanceof Error &&
      error.message.includes('redis: transaction failed'),
  };
}
function observation(label: string, value: unknown): ExecObservation {
  if (!Array.isArray(value)) return { label, kind: 'unexpected' };
  return {
    label,
    kind: 'array',
    length: value.length,
    values: value.slice(0, 8).map((item: unknown) => {
      if (item === 'OK') return 'string:OK';
      if (item === null) return 'null';
      if (typeof item === 'number' && Number.isFinite(item))
        return `number:${item}`;
      if (typeof item === 'boolean') return `boolean:${item}`;
      return typeof item;
    }),
  };
}
function requireCheck(value: boolean): void {
  if (!value) throw new Error('DiagnosticCheckFailed');
}
function confirmedAbort(
  value: unknown,
  observed: ExecObservation | undefined
): boolean {
  if (Array.isArray(value) && value.length === 0) return true;
  return (
    observed?.kind === 'thrown' &&
    (observed.error.redisTransactionFailed ||
      observed.error.code === 'ABORTED' ||
      observed.error.code === 10)
  );
}

/** No caller-controlled key, account, board or challenge can enter this probe. */
export async function runPrivateRedisSmoke(
  supplied?: PrivateRedisSmokeDependencies
): Promise<PrivateRedisSmokeResult> {
  const deps = supplied ?? {
    context: {
      appSlug: context.appSlug,
      appVersion: context.appVersion,
      subredditId: context.subredditId,
      subredditName: context.subredditName,
    },
    redis,
    now: Date.now,
    nonce: () => globalThis.crypto.randomUUID(),
    log: (result: PrivateRedisSmokeResult) =>
      console.info('Private Redis smoke', JSON.stringify(result)),
  };
  if (
    deps.context.appSlug !== 'full-throttle-dev' ||
    deps.context.appVersion !== PRIVATE_REDIS_SMOKE_VERSION ||
    deps.context.subredditId !== PRIVATE_REDIS_SMOKE_HOME_ID ||
    deps.context.subredditName !== PRIVATE_REDIS_SMOKE_HOME_NAME
  )
    return {
      status: 'skipped',
      version: PRIVATE_REDIS_SMOKE_VERSION,
      reason: 'scope',
    };

  const checks = {
    unchangedCommit: false,
    externalChangeAborted: false,
    competingWatchAborted: false,
    sortedReads: false,
    expirations: false,
    adapterCommit: false,
    cleanup: false,
  };
  const exec: ExecObservation[] = [];
  const result: PrivateRedisSmokeResult = {
    status: 'failed',
    version: PRIVATE_REDIS_SMOKE_VERSION,
    checks,
    exec,
  };
  let keys: string[] = [];
  let markerOwned = false;
  const active = new Set<SmokeTransaction>();
  try {
    const started = deps.now();
    requireCheck(Number.isSafeInteger(started) && started >= 0);
    const nonce = deps.nonce();
    requireCheck(/^[a-zA-Z0-9-]{1,64}$/.test(nonce));
    const expiresAt = new Date(started + DATA_TTL_MS);
    const marker = await deps.redis.set(MARKER, 'pending', {
      nx: true,
      expiration: expiresAt,
    });
    if (marker === '')
      return {
        status: 'skipped',
        version: PRIVATE_REDIS_SMOKE_VERSION,
        reason: 'already-ran',
      };
    requireCheck(marker === 'OK');
    markerOwned = true;
    const prefix = `racer:diagnostic:redis-smoke:${PRIVATE_REDIS_SMOKE_VERSION}:${nonce}`;
    const control = `${prefix}:control`,
      conflict = `${prefix}:conflict`,
      sentinel = `${prefix}:sentinel`,
      pair = `${prefix}:pair`,
      board = `${prefix}:board`;
    keys = [control, conflict, sentinel, pair, board];
    for (const [key, value] of [
      [control, '0'],
      [conflict, '0'],
      [sentinel, 'untouched'],
      [pair, '0'],
    ]) {
      if (!key || !value) throw new Error('DiagnosticKeyMissing');
      requireCheck(
        (await deps.redis.set(key, value, { expiration: expiresAt })) === 'OK'
      );
    }
    async function watched(key: string): Promise<SmokeTransaction> {
      requireCheck(deps.now() - started < 15_000);
      const tx = await deps.redis.watch(key);
      active.add(tx);
      return tx;
    }
    async function execute(
      tx: SmokeTransaction,
      label: string
    ): Promise<unknown> {
      try {
        const value: unknown = await tx.exec();
        active.delete(tx);
        exec.push(observation(label, value));
        return value;
      } catch (error) {
        exec.push({ label, kind: 'thrown', error: safeError(error) });
        return undefined;
      }
    }
    const unchanged = await watched(control);
    requireCheck((await deps.redis.get(control)) === '0');
    await unchanged.multi();
    await unchanged.set(control, '4', { expiration: expiresAt });
    await unchanged.incrBy(control, 1);
    const committed = await execute(unchanged, 'unchanged');
    checks.unchangedCommit =
      Array.isArray(committed) &&
      committed.length === 2 &&
      committed[0] === 'OK' &&
      committed[1] === 5 &&
      (await deps.redis.get(control)) === '5';
    requireCheck(checks.unchangedCommit);

    const changed = await watched(conflict);
    requireCheck((await deps.redis.get(conflict)) === '0');
    requireCheck(
      (await deps.redis.set(conflict, '1', { expiration: expiresAt })) === 'OK'
    );
    await changed.multi();
    await changed.set(sentinel, 'overwritten', { expiration: expiresAt });
    const externalAbort = await execute(changed, 'external-change');
    checks.externalChangeAborted =
      confirmedAbort(externalAbort, exec.at(-1)) &&
      (await deps.redis.get(conflict)) === '1' &&
      (await deps.redis.get(sentinel)) === 'untouched';
    requireCheck(checks.externalChangeAborted);

    const first = await watched(pair),
      second = await watched(pair);
    requireCheck((await deps.redis.get(pair)) === '0');
    await first.multi();
    await first.set(pair, '1', { expiration: expiresAt });
    await second.multi();
    await second.set(pair, '2', { expiration: expiresAt });
    const winner = await execute(first, 'competing-winner');
    const competingAbort = await execute(second, 'competing-loser');
    checks.competingWatchAborted =
      Array.isArray(winner) &&
      winner.length === 1 &&
      winner[0] === 'OK' &&
      confirmedAbort(competingAbort, exec.at(-1)) &&
      (await deps.redis.get(pair)) === '1';
    requireCheck(checks.competingWatchAborted);

    const sorted = await watched(board);
    await sorted.multi();
    await sorted.zAdd(
      board,
      { member: 'diagnostic-alpha', score: 300 },
      { member: 'diagnostic-beta', score: 200 },
      { member: 'diagnostic-gamma', score: 200 }
    );
    await sorted.expire(board, DATA_TTL_MS / 1000);
    await execute(sorted, 'sorted-expiry');
    const ranked = await deps.redis.zRange(board, 0, 2, { by: 'rank' });
    const tied = await deps.redis.zRange(board, 200, 200, {
      by: 'score',
      limit: { offset: 0, count: 1 },
    });
    await deps.redis.del(conflict);
    const values = await deps.redis.mGet([control, conflict, pair]);
    const expectedRows = [
      { member: 'diagnostic-beta', score: 200 },
      { member: 'diagnostic-gamma', score: 200 },
      { member: 'diagnostic-alpha', score: 300 },
    ];
    checks.sortedReads =
      ranked.length === expectedRows.length &&
      ranked.every(
        (entry, index) =>
          entry.member === expectedRows[index]?.member &&
          entry.score === expectedRows[index]?.score
      ) &&
      tied.length === 1 &&
      tied[0]?.member === 'diagnostic-beta' &&
      tied[0]?.score === 200 &&
      (await deps.redis.zRank(board, 'diagnostic-gamma')) === 1 &&
      JSON.stringify(values) === JSON.stringify(['5', null, '1']);
    requireCheck(checks.sortedReads);
    const expirations = await Promise.all(
      [control, sentinel, pair, board].map((key) => deps.redis.expireTime(key))
    );
    const nowSeconds = Math.floor(deps.now() / 1000);
    checks.expirations = expirations.every(
      (value) =>
        Number.isSafeInteger(value) &&
        value > nowSeconds &&
        value <= nowSeconds + 125
    );
    requireCheck(checks.expirations);
    // Reuse precisely the same owned keys to exercise the deployed adapter too.
    requireCheck(deps.now() - started < 15_000);
    await deps.redis.del(...keys);
    const adapterDeadline = deps.now() + DATA_TTL_MS;
    const adapter = createCompetitionStore(deps.redis, deps.now);
    const adapterCreated = await adapter.compareAndSwap({
      expected: [control, conflict, sentinel].map((key) => ({
        key,
        value: undefined,
      })),
      sets: [
        { key: control, value: 'diagnostic-pb', expiresAtMs: adapterDeadline },
        {
          key: conflict,
          value: 'diagnostic-receipt',
          expiresAtMs: adapterDeadline,
        },
        {
          key: sentinel,
          value: 'diagnostic-outcome',
          expiresAtMs: adapterDeadline,
        },
      ],
      sortedSet: {
        key: board,
        member: 'diagnostic-adapter',
        score: 200,
        expectedScore: undefined,
        expiresAtMs: adapterDeadline,
      },
      increments: [{ key: pair, expiresAtMs: adapterDeadline }],
    });
    requireCheck(adapterCreated);
    requireCheck(
      (await deps.redis.get(control)) === 'diagnostic-pb' &&
        (await deps.redis.get(conflict)) === 'diagnostic-receipt' &&
        (await deps.redis.get(sentinel)) === 'diagnostic-outcome' &&
        (await deps.redis.get(pair)) === '1' &&
        (await deps.redis.zScore(board, 'diagnostic-adapter')) === 200
    );
    requireCheck(deps.now() - started < 15_000);
    checks.adapterCommit = await adapter.compareAndSwap({
      expected: [
        { key: control, value: 'diagnostic-pb' },
        { key: conflict, value: 'diagnostic-receipt' },
        { key: sentinel, value: 'diagnostic-outcome' },
      ],
      sets: [
        {
          key: control,
          value: 'diagnostic-pb-improved',
          expiresAtMs: adapterDeadline,
        },
        {
          key: conflict,
          value: 'diagnostic-receipt-improved',
          expiresAtMs: adapterDeadline,
        },
        {
          key: sentinel,
          value: 'diagnostic-outcome-improved',
          expiresAtMs: adapterDeadline,
        },
      ],
      sortedSet: {
        key: board,
        member: 'diagnostic-adapter',
        score: 150,
        expectedScore: 200,
        expiresAtMs: adapterDeadline,
      },
      increments: [{ key: pair, expiresAtMs: adapterDeadline }],
    });
    requireCheck(checks.adapterCommit);
    requireCheck(
      (await deps.redis.get(control)) === 'diagnostic-pb-improved' &&
        (await deps.redis.get(conflict)) === 'diagnostic-receipt-improved' &&
        (await deps.redis.get(sentinel)) === 'diagnostic-outcome-improved' &&
        (await deps.redis.get(pair)) === '2' &&
        (await deps.redis.zScore(board, 'diagnostic-adapter')) === 150
    );
    result.status = 'passed';
  } catch (error) {
    result.error = safeError(error);
  } finally {
    for (const tx of active) {
      try {
        await tx.discard();
      } catch {
        /* An aborted EXEC may already have released it. */
      }
    }
    if (keys.length) {
      try {
        await deps.redis.del(...keys);
        // MGET also returns nil for an existing sorted set; TYPE proves all five are absent.
        const absent = await Promise.all(
          keys.map((key) => deps.redis.type(key))
        );
        checks.cleanup =
          absent.length === keys.length &&
          absent.every((value) => value === 'none');
      } catch (error) {
        result.error = safeError(error);
      }
      if (!checks.cleanup) result.status = 'failed';
    }
    if (markerOwned) {
      try {
        requireCheck(
          (await deps.redis.set(MARKER, JSON.stringify(result), {
            expiration: new Date(deps.now() + REPORT_TTL_MS),
          })) === 'OK'
        );
      } catch (error) {
        result.status = 'failed';
        result.error = safeError(error);
      }
      deps.log(result);
    }
  }
  return result;
}
