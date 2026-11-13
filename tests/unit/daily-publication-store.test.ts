import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRedisDailyPublicationStore,
  dailyPublicationKey,
} from '../../src/server/daily-publication-store.ts';
import type {
  DailyPublicationRedis,
  DailyPublicationTransaction,
} from '../../src/server/daily-publication-store.ts';

const scope = 't5_racing';
const key = 'racer:daily-publication:t5_racing';
const privateError = 'private Redis host and request metadata';

/** Ordinary reads plus independent, versioned WATCH transactions, as in the SDK. */
class PublicationRedis implements DailyPublicationRedis {
  readonly values = new Map<string, string>();
  readonly versions = new Map<string, number>();
  readonly calls: string[] = [];
  readonly setArguments: unknown[][] = [];
  activeTransactions = 0;
  failAt: string | undefined;
  conflictThrows = false;
  loseReply = false;
  nonCommit = false;
  reply: unknown = ['OK'];
  getReply: (() => unknown) | undefined;
  typeReply: (() => unknown) | undefined;
  beforeExec: (() => Promise<void>) | undefined;
  afterCommit: (() => void) | undefined;

  seed(name: string, value: string): void {
    this.values.set(name, value);
    this.versions.set(name, (this.versions.get(name) ?? 0) + 1);
  }
  private fail(operation: string): void {
    if (this.failAt === operation) throw new Error(privateError);
  }
  async get(name: string): Promise<unknown> {
    this.calls.push('get');
    this.fail('get');
    return this.getReply ? this.getReply() : this.values.get(name);
  }
  async type(name: string): Promise<unknown> {
    this.calls.push('type');
    this.fail('type');
    return this.typeReply
      ? this.typeReply()
      : this.values.has(name)
        ? 'string'
        : 'none';
  }
  async watch(...names: string[]): Promise<DailyPublicationTransaction> {
    this.calls.push('watch');
    this.fail('watch');
    assert.deepEqual(names, [key]);
    const watched = names.map((name) => ({
      name,
      version: this.versions.get(name) ?? 0,
    }));
    const queued: { name: string; value: string }[] = [];
    let state: 'watch' | 'multi' | 'closed' = 'watch';
    this.activeTransactions++;
    const close = () => {
      assert.notEqual(state, 'closed');
      state = 'closed';
      this.activeTransactions--;
    };
    return {
      multi: async () => {
        this.calls.push('multi');
        assert.equal(state, 'watch');
        this.fail('multi-before');
        state = 'multi';
        this.fail('multi-after');
      },
      set: async (name, value) => {
        this.calls.push('set');
        assert.equal(state, 'multi');
        this.setArguments.push([name, value]);
        queued.push({ name, value });
        this.fail('set');
      },
      exec: async () => {
        this.calls.push('exec');
        assert.equal(state, 'multi');
        this.fail('exec');
        await this.beforeExec?.();
        if (
          watched.some(
            (entry) => (this.versions.get(entry.name) ?? 0) !== entry.version
          )
        ) {
          close();
          if (this.conflictThrows) throw new Error(privateError);
          return [];
        }
        if (this.nonCommit) {
          close();
          return this.reply;
        }
        for (const entry of queued) this.seed(entry.name, entry.value);
        close();
        this.afterCommit?.();
        if (this.loseReply) throw new Error(privateError);
        return this.reply;
      },
      discard: async () => {
        this.calls.push('discard');
        assert.equal(state, 'multi');
        close();
        this.fail('discard-after');
      },
      unwatch: async () => {
        this.calls.push('unwatch');
        assert.equal(state, 'watch');
        close();
        this.fail('unwatch-after');
      },
    };
  }
}

async function safeRejection(operation: Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /^Daily publication storage /);
    assert.ok(!error.message.includes(privateError));
    return true;
  });
}

void test('publication key is stable and scoped to a canonical Reddit community', () => {
  assert.equal(dailyPublicationKey(scope), key);
  assert.notEqual(dailyPublicationKey('t5_other'), key);
  for (const invalid of ['', 'r/racing', 't5_UPPER', 't5_a:other', 't5_a\n'])
    assert.throws(() => dailyPublicationKey(invalid));
});

void test('raw reads preserve missing, empty and unparsed journal values', async () => {
  const redis = new PublicationRedis();
  const store = createRedisDailyPublicationStore(scope, redis);
  assert.equal(await store.read(), undefined);
  redis.getReply = () => null;
  assert.equal(await store.read(), undefined);
  redis.getReply = undefined;
  for (const value of ['', 'not JSON', '{"owner":"one"}']) {
    redis.seed(key, value);
    assert.equal(await store.read(), value);
  }
});

void test('CAS watches before ordinary reads and commits exactly one permanent SET', async () => {
  const redis = new PublicationRedis();
  const store = createRedisDailyPublicationStore(scope, redis);
  assert.equal(await store.compareAndSwap(undefined, 'first'), true);
  assert.deepEqual(redis.calls, [
    'watch',
    'type',
    'get',
    'multi',
    'set',
    'exec',
    'type',
    'get',
  ]);
  assert.deepEqual(redis.setArguments, [[key, 'first']]);
  assert.equal(redis.activeTransactions, 0);
  assert.equal(await store.compareAndSwap('first', 'next'), true);
  assert.equal(await store.read(), 'next');
  assert.equal(redis.activeTransactions, 0);
});

void test('stale raw expectations and empty versus absent release WATCH without writing', async () => {
  for (const value of ['', 'someone else']) {
    const redis = new PublicationRedis();
    redis.seed(key, value);
    const store = createRedisDailyPublicationStore(scope, redis);
    assert.equal(await store.compareAndSwap(undefined, 'ours'), false);
    assert.equal(redis.values.get(key), value);
    assert.deepEqual(redis.calls, ['watch', 'type', 'get', 'unwatch']);
    assert.equal(redis.activeTransactions, 0);
    assert.equal(await store.compareAndSwap(value, 'ours'), true);
  }
});

void test('competing watched versions allow one writer, including throwing conflicts', async () => {
  for (const conflictThrows of [false, true]) {
    const redis = new PublicationRedis();
    redis.conflictThrows = conflictThrows;
    const store = createRedisDailyPublicationStore(scope, redis);
    let entered = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    redis.beforeExec = async () => {
      if (++entered === 2) release();
      await gate;
    };
    const results = await Promise.all([
      store.compareAndSwap(undefined, 'writer one'),
      store.compareAndSwap(undefined, 'writer two'),
    ]);
    assert.deepEqual([...results].sort(), [false, true]);
    assert.equal(redis.versions.get(key), 1);
    assert.equal(redis.activeTransactions, 0);
    assert.equal(
      redis.values.get(key),
      results[0] ? 'writer one' : 'writer two'
    );
  }
});

void test('a lost post-commit EXEC reply succeeds only through exact persisted readback', async () => {
  for (const overwritten of [false, true]) {
    const redis = new PublicationRedis();
    redis.loseReply = true;
    if (overwritten) redis.afterCommit = () => redis.seed(key, 'newer owner');
    const store = createRedisDailyPublicationStore(scope, redis);
    assert.equal(await store.compareAndSwap(undefined, 'ours'), !overwritten);
    assert.ok(redis.calls.includes('discard'));
    assert.ok(redis.calls.includes('unwatch'));
    assert.equal(redis.activeTransactions, 0);
  }
});

void test('truthy EXEC without a commit and mismatched readback never claim ownership', async () => {
  const redis = new PublicationRedis();
  redis.nonCommit = true;
  const store = createRedisDailyPublicationStore(scope, redis);
  assert.equal(await store.compareAndSwap(undefined, 'ours'), false);
  assert.equal(redis.values.has(key), false);
  assert.equal(redis.activeTransactions, 0);

  const changed = new PublicationRedis();
  changed.afterCommit = () => changed.seed(key, 'newer owner');
  assert.equal(
    await createRedisDailyPublicationStore(scope, changed).compareAndSwap(
      undefined,
      'ours'
    ),
    false
  );
});

void test('empty, null and malformed EXEC acknowledgements require exact stored readback', async () => {
  for (const reply of [[], null, {}, true, ['OK', 'OK'], [null], ['QUEUED']]) {
    for (const persistence of ['missing', 'exact', 'overwritten']) {
      const redis = new PublicationRedis();
      redis.reply = reply;
      redis.nonCommit = persistence === 'missing';
      if (persistence === 'overwritten')
        redis.afterCommit = () => redis.seed(key, 'newer owner');
      assert.equal(
        await createRedisDailyPublicationStore(scope, redis).compareAndSwap(
          undefined,
          'ours'
        ),
        persistence === 'exact'
      );
      assert.equal(redis.activeTransactions, 0);
    }
  }
});

void test('wrong key types and corrupt ordinary replies fail closed and release WATCH', async () => {
  for (const corrupt of ['zset', false, {}, null]) {
    const redis = new PublicationRedis();
    redis.typeReply = () => corrupt;
    const store = createRedisDailyPublicationStore(scope, redis);
    await safeRejection(store.read());
    await safeRejection(store.compareAndSwap(undefined, 'ours'));
    assert.equal(redis.values.has(key), false);
    assert.equal(redis.activeTransactions, 0);
    assert.ok(redis.calls.includes('unwatch'));
  }
  for (const corrupt of [false, {}, 1, ['journal']]) {
    const redis = new PublicationRedis();
    redis.getReply = () => corrupt;
    const store = createRedisDailyPublicationStore(scope, redis);
    await safeRejection(store.read());
    await safeRejection(store.compareAndSwap(undefined, 'ours'));
    assert.equal(redis.activeTransactions, 0);
  }
});

void test('readback errors and wrong types never turn committed or lost replies into success', async () => {
  for (const loseReply of [false, true]) {
    for (const mode of ['read', 'type', 'corrupt']) {
      const redis = new PublicationRedis();
      redis.loseReply = loseReply;
      redis.afterCommit = () => {
        if (mode === 'read') redis.failAt = 'get';
        if (mode === 'type') redis.typeReply = () => 'zset';
        if (mode === 'corrupt') redis.getReply = () => false;
      };
      await safeRejection(
        createRedisDailyPublicationStore(scope, redis).compareAndSwap(
          undefined,
          'ours'
        )
      );
      assert.equal(redis.activeTransactions, 0);
    }
  }
});

void test('watch, read, MULTI and queue failures expose fixed errors and release live transactions', async () => {
  for (const failAt of [
    'watch',
    'type',
    'get',
    'multi-before',
    'multi-after',
    'set',
  ]) {
    const redis = new PublicationRedis();
    redis.failAt = failAt;
    await safeRejection(
      createRedisDailyPublicationStore(scope, redis).compareAndSwap(
        undefined,
        'ours'
      )
    );
    assert.equal(redis.values.has(key), false);
    assert.equal(redis.activeTransactions, 0, failAt);
    if (failAt !== 'watch')
      assert.ok(
        redis.calls.includes('discard') || redis.calls.includes('unwatch')
      );
  }
});

void test('an uncommitted EXEC failure is unconfirmed and discards queued writes', async () => {
  const redis = new PublicationRedis();
  redis.failAt = 'exec';
  assert.equal(
    await createRedisDailyPublicationStore(scope, redis).compareAndSwap(
      undefined,
      'ours'
    ),
    false
  );
  assert.equal(redis.values.has(key), false);
  assert.equal(redis.activeTransactions, 0);
  assert.ok(redis.calls.includes('discard'));
});

void test('cleanup acknowledgements lost after release cannot mask a safe result', async () => {
  const stale = new PublicationRedis();
  stale.seed(key, 'someone else');
  stale.failAt = 'unwatch-after';
  assert.equal(
    await createRedisDailyPublicationStore(scope, stale).compareAndSwap(
      undefined,
      'ours'
    ),
    false
  );
  assert.equal(stale.activeTransactions, 0);

  const uncommitted = new PublicationRedis();
  uncommitted.failAt = 'discard-after';
  uncommitted.beforeExec = async () => {
    throw new Error(privateError);
  };
  assert.equal(
    await createRedisDailyPublicationStore(scope, uncommitted).compareAndSwap(
      undefined,
      'ours'
    ),
    false
  );
  assert.equal(uncommitted.activeTransactions, 0);
  assert.ok(uncommitted.calls.includes('discard'));
  assert.ok(uncommitted.calls.includes('unwatch'));
  assert.equal(uncommitted.values.has(key), false);
});
