import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createDailyPublicationService,
  DailyPublicationError,
  PUBLICATION_SUBMIT_GRACE_MS,
  parseDailyPublicationJournal,
  serializeDailyPublicationJournal,
  type DailyPublicationDependencies,
  type DailyPublicationJournal,
  type DailyPublicationPost,
  type DailyPublicationStore,
} from '../../src/server/core/daily-publication.ts';
import { utcDay } from '../../src/shared/daily-challenge.ts';

const scope = 't5_private';
const epoch = Date.parse('2026-11-13T12:00:00Z');
const dayMs = 86_400_000;
const hash = 'a'.repeat(64);
function latch() {
  let resolve: () => void = () => assert.fail('Uninitialized latch');
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Exact revisions and commit-before-reply behavior; no fake distributed lock. */
class Store implements DailyPublicationStore {
  raw: string | undefined;
  calls = 0;
  before:
    ((expected: string | undefined, next: string) => Promise<void>) | undefined;
  after: ((next: string) => Promise<void>) | undefined;
  refuse: ((next: string) => boolean) | undefined;
  readFailure = false;
  async read(): Promise<string | undefined> {
    if (this.readFailure) throw new Error('Private storage metadata');
    return this.raw;
  }
  async compareAndSwap(
    expected: string | undefined,
    next: string
  ): Promise<boolean> {
    this.calls++;
    await this.before?.(expected, next);
    if (this.raw !== expected || this.refuse?.(next)) return false;
    this.raw = next; // No await between revision comparison and atomic mutation.
    await this.after?.(next);
    return true;
  }
}

class Harness {
  readonly store = new Store();
  readonly posts = new Map<string, DailyPublicationPost>();
  readonly pointers = new Map<string, DailyPublicationPost>();
  nowMs = epoch;
  submits = 0;
  prepares = 0;
  repairs = 0;
  reconciles = 0;
  nonces = 0;
  submitOverride: DailyPublicationDependencies['submit'] | undefined;
  repairFailure = false;
  prepareFailure = false;
  prepareHook: (() => void) | undefined;
  reconcileOverride: DailyPublicationDependencies['reconcile'] | undefined;
  lookupOverride: DailyPublicationDependencies['lookup'] | undefined;
  makePost(
    operationId: string,
    id = `t3_post${this.submits}`,
    createdAtMs = this.nowMs
  ): DailyPublicationPost {
    const post = {
      id,
      subredditId: scope,
      createdAtMs,
      available: true,
      operationId,
    };
    this.posts.set(id, post);
    return post;
  }
  readonly deps: DailyPublicationDependencies = {
    store: this.store,
    subredditId: scope,
    now: () => this.nowMs,
    newOperationId: () => `operation_token_${++this.nonces}`,
    prepare: async (day) => {
      this.prepares++;
      if (this.prepareFailure) throw new Error('Secret generator detail');
      this.prepareHook?.();
      return { day, challengeHash: hash };
    },
    readCurrentPost: async (day) => this.pointers.get(day),
    submit: async (input) => {
      this.submits++;
      return this.submitOverride
        ? this.submitOverride(input)
        : this.makePost(input.operationId);
    },
    lookup: async (id) =>
      this.lookupOverride ? this.lookupOverride(id) : this.posts.get(id),
    repair: async ({ post, operationId }) => {
      this.repairs++;
      if (this.repairFailure) throw new Error('Private metadata failure');
      const updated = { ...post, operationId };
      this.posts.set(post.id, updated);
      if (!this.pointers.has(utcDay(post.createdAtMs)))
        this.pointers.set(utcDay(post.createdAtMs), updated);
    },
    reconcile: async (operation) => {
      this.reconciles++;
      return this.reconcileOverride
        ? this.reconcileOverride(operation)
        : [...this.posts.values()]
            .filter((post) => post.operationId === operation.operationId)
            .slice(0, 2);
    },
  };
  service() {
    return createDailyPublicationService(this.deps);
  }
  journal(): DailyPublicationJournal {
    assert.ok(this.store.raw !== undefined);
    return parseDailyPublicationJournal(this.store.raw, scope);
  }
  setJournal(
    phase: 'submitting' | 'uncertain' = 'uncertain',
    intendedDay = utcDay(this.nowMs)
  ): void {
    this.store.raw = serializeDailyPublicationJournal({
      schemaVersion: 1,
      subredditId: scope,
      operationId: 'operation_previous',
      submittedAtMs: this.nowMs,
      intendedDay,
      challengeHash: hash,
      phase,
    });
  }
}

void test('an observer leaves a freshly committed claim untouched before its owner confirms it', async () => {
  const h = new Harness();
  let observerStatus: string | undefined;
  h.store.after = async (raw) => {
    if (parseDailyPublicationJournal(raw, scope).phase !== 'submitting') return;
    assert.equal(h.submits, 0);
    const before = h.store.raw;
    observerStatus = (await h.service().ensureToday()).status;
    assert.equal(observerStatus, 'busy');
    assert.equal(h.store.raw, before);
    assert.equal(h.store.calls, 1);
    assert.equal(h.reconciles, 0);
    assert.equal(h.submits, 0);
  };
  const accepted = await h.service().ensureToday();
  assert.equal(observerStatus, 'busy');
  assert.equal(accepted.status, 'ready');
  assert.equal(h.submits, 1);
  assert.equal(h.journal().phase, 'ready');
  assert.deepEqual(await h.service().ensureToday(), accepted);
  assert.equal(h.submits, 1);
});

void test('after the grace an observer can mark uncertainty during a delayed submit, without authorizing another submit', async () => {
  const h = new Harness();
  const entered = latch(),
    release = latch();
  h.submitOverride = async ({ operationId }) => {
    entered.resolve();
    await release.promise;
    return h.makePost(operationId);
  };
  const first = h.service().ensureToday();
  await entered.promise;
  h.nowMs += PUBLICATION_SUBMIT_GRACE_MS;
  const second = await h.service().ensureToday();
  assert.equal(second.status, 'uncertain');
  assert.equal(h.journal().phase, 'uncertain');
  release.resolve();
  const accepted = await first;
  assert.equal(accepted.status, 'ready');
  assert.equal(accepted.postId, 't3_post1');
  assert.equal(h.submits, 1);
  assert.equal(h.journal().phase, 'ready');
  const calls = h.store.calls;
  assert.deepEqual(await h.service().ensureToday(), accepted);
  assert.equal(h.store.calls, calls);
  assert.equal(h.submits, 1);
});

void test('CAS lost replies are recovered by exact read-back before issuing the one side effect', async () => {
  const h = new Harness();
  h.store.after = async () => {
    throw new Error('Lost EXEC reply');
  };
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.equal(h.submits, 1);
  assert.equal(h.store.calls, 3);
  assert.equal(h.journal().phase, 'ready');
  const denied = new Harness();
  denied.store.refuse = () => true;
  assert.equal((await denied.service().ensureToday()).status, 'busy');
  assert.equal(denied.submits, 0);
  assert.equal(denied.store.raw, undefined);
});

void test('a committed claim with unavailable confirmation never submits and later callers cannot inherit submission authority', async () => {
  const h = new Harness();
  h.store.after = async () => {
    h.store.readFailure = true;
    throw new Error('Reply disappeared');
  };
  await assert.rejects(
    h.service().ensureToday(),
    (error: unknown) =>
      error instanceof DailyPublicationError && error.kind === 'unavailable'
  );
  assert.equal(h.submits, 0);
  h.store.readFailure = false;
  h.store.after = undefined;
  assert.equal((await h.service().ensureToday()).status, 'busy');
  assert.equal(h.journal().phase, 'submitting');
  assert.equal(h.reconciles, 0);
  h.nowMs += PUBLICATION_SUBMIT_GRACE_MS;
  assert.equal((await h.service().ensureToday()).status, 'uncertain');
  assert.equal(h.submits, 0);
  h.nowMs += dayMs;
  assert.equal((await h.service().ensureToday()).status, 'uncertain');
  assert.equal(h.submits, 0);
});

void test('pre-submit preparation errors are safe to retry without poisoning a publication claim', async () => {
  const h = new Harness();
  h.prepareFailure = true;
  await assert.rejects(h.service().ensureToday(), DailyPublicationError);
  assert.equal(h.store.raw, undefined);
  assert.equal(h.submits, 0);
  h.prepareFailure = false;
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.equal(h.submits, 1);
});

void test('known post IDs survive metadata failures and repair the same ID on the next invocation', async () => {
  const h = new Harness();
  h.repairFailure = true;
  const pending = await h.service().ensureToday();
  assert.equal(pending.postId, 't3_post1');
  assert.equal(pending.status, 'unavailable');
  assert.equal(h.journal().phase, 'created');
  h.repairFailure = false;
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.equal(h.submits, 1);
  assert.equal(h.posts.get('t3_post1')?.operationId, h.journal().operationId);
});

void test('a lost post-ID write remains guarded, returns the known ID and adopts only a positive orphan later', async () => {
  const h = new Harness();
  h.store.refuse = (raw) => JSON.parse(raw).phase === 'created';
  const pending = await h.service().ensureToday();
  assert.equal(pending.status, 'unavailable');
  assert.equal(pending.postId, 't3_post1');
  assert.equal(h.store.calls, 3);
  assert.equal(h.journal().phase, 'submitting');
  assert.equal(h.repairs, 0);
  h.store.refuse = undefined;
  h.nowMs += PUBLICATION_SUBMIT_GRACE_MS;
  const calls = h.store.calls;
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.ok(h.store.calls - calls <= 3);
  assert.equal(h.submits, 1);
});

void test('storage becoming unreadable after confirmed Reddit creation still returns the known post ID', async () => {
  const h = new Harness();
  h.submitOverride = async ({ operationId }) => {
    const post = h.makePost(operationId);
    h.store.readFailure = true;
    return post;
  };
  const outcome = await h.service().ensureToday();
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.postId, 't3_post1');
  assert.equal(h.submits, 1);
  h.store.readFailure = false;
  assert.equal(h.journal().phase, 'submitting');
  h.nowMs += PUBLICATION_SUBMIT_GRACE_MS;
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.equal(h.submits, 1);
});

void test('ambiguous submission never retries on negative listings, even on another UTC day', async () => {
  const h = new Harness();
  h.submitOverride = async () => {
    throw new Error('Submit may have reached Reddit');
  };
  assert.equal((await h.service().ensureToday()).status, 'uncertain');
  const uncertain = h.store.raw;
  h.nowMs += dayMs;
  assert.equal((await h.service().ensureToday()).status, 'uncertain');
  assert.equal(h.store.raw, uncertain);
  assert.equal(h.submits, 1);
  const state = h.journal();
  h.makePost(state.operationId, 't3_orphan', epoch + 1000);
  await h.service().ensureToday();
  assert.equal(h.journal().phase, 'ready');
  assert.equal(h.submits, 1);
  h.submitOverride = undefined;
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.equal(h.submits, 2);
});

void test('positive orphan reconciliation requires one consistent operation-marked post', async () => {
  const h = new Harness();
  h.setJournal();
  h.makePost(h.journal().operationId, 't3_orphan');
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.equal(h.submits, 0);
  const conflicting = new Harness();
  conflicting.setJournal();
  conflicting.makePost(conflicting.journal().operationId, 't3_first');
  conflicting.makePost(conflicting.journal().operationId, 't3_second');
  const raw = conflicting.store.raw;
  await assert.rejects(
    conflicting.service().ensureToday(),
    (error: unknown) =>
      error instanceof DailyPublicationError && error.kind === 'integrity'
  );
  assert.equal(conflicting.store.raw, raw);
  assert.equal(conflicting.repairs, 0);
  const wrong = new Harness();
  wrong.setJournal();
  wrong.reconcileOverride = async () => [
    wrong.makePost('different_operation', 't3_wrong'),
  ];
  await assert.rejects(wrong.service().ensureToday(), DailyPublicationError);
  assert.equal(wrong.journal().phase, 'uncertain');
});

void test('late failed submissions never downgrade a concurrently reconciled ready post', async () => {
  const h = new Harness();
  const entered = latch(),
    release = latch();
  h.submitOverride = async ({ operationId }) => {
    h.makePost(operationId);
    entered.resolve();
    await release.promise;
    throw new Error('Late transport rejection after success');
  };
  const original = h.service().ensureToday();
  await entered.promise;
  h.nowMs += PUBLICATION_SUBMIT_GRACE_MS;
  assert.equal((await h.service().ensureToday()).status, 'ready');
  const saved = h.store.raw;
  release.resolve();
  assert.equal((await original).status, 'ready');
  assert.equal(h.store.raw, saved);
  assert.equal(h.submits, 1);
});

void test('a late conflicting returned ID cannot overwrite a positively reconciled operation', async () => {
  const h = new Harness();
  const entered = latch(),
    release = latch();
  h.submitOverride = async ({ operationId }) => {
    h.makePost(operationId, 't3_positive');
    entered.resolve();
    await release.promise;
    return h.makePost(operationId, 't3_conflict');
  };
  const original = h.service().ensureToday();
  await entered.promise;
  h.nowMs += PUBLICATION_SUBMIT_GRACE_MS;
  assert.equal((await h.service().ensureToday()).postId, 't3_positive');
  const saved = h.store.raw;
  release.resolve();
  await assert.rejects(original, DailyPublicationError);
  assert.equal(h.store.raw, saved);
});

void test('healthy legacy pointers and removed winners do not clear unrelated unresolved ownership', async () => {
  const h = new Harness();
  h.setJournal('uncertain', '2026-11-12');
  const existing = {
    ...h.makePost('unrelated_operation', 't3_existing'),
    operationId: undefined,
  };
  h.pointers.set(utcDay(h.nowMs), existing);
  const raw = h.store.raw;
  assert.equal((await h.service().ensureToday()).postId, existing.id);
  assert.equal(h.store.raw, raw);
  assert.equal(h.submits, 0);
  h.pointers.set(utcDay(h.nowMs), { ...existing, available: false });
  assert.equal((await h.service().ensureToday()).status, 'unavailable');
  assert.equal(h.store.raw, raw);
  assert.equal(h.submits, 0);
});

void test('moderation before ready settles known creation without reposting, allowing a later day', async () => {
  const h = new Harness();
  h.submitOverride = async ({ operationId }) => ({
    ...h.makePost(operationId),
    available: false,
  });
  assert.equal((await h.service().ensureToday()).status, 'unavailable');
  const settled = h.journal();
  assert.equal(settled.phase, 'ready');
  if (settled.phase === 'ready')
    assert.equal(settled.availability, 'unavailable');
  assert.equal((await h.service().ensureToday()).status, 'unavailable');
  assert.equal(h.submits, 1);
  h.nowMs += dayMs;
  h.submitOverride = undefined;
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.equal(h.submits, 2);
});

void test('unknown creation metadata stays guarded until positively learned, including a missing known ID', async () => {
  const h = new Harness();
  h.submitOverride = async ({ operationId }) => ({
    ...h.makePost(operationId),
    createdAtMs: NaN,
  });
  h.lookupOverride = async () => undefined;
  assert.equal((await h.service().ensureToday()).status, 'unavailable');
  const created = h.journal();
  assert.equal(created.phase, 'created');
  if (created.phase === 'created')
    assert.equal(created.actualCreatedAtMs, null);
  h.nowMs += dayMs;
  await h.service().ensureToday();
  assert.equal(h.submits, 1);
  assert.equal(h.journal().phase, 'created');
  h.lookupOverride = async () => ({
    ...h.makePost(created.operationId, 't3_post1', epoch),
    available: false,
  });
  await h.service().ensureToday();
  assert.equal(h.journal().phase, 'ready');
  assert.equal(h.submits, 1);
});

void test('UTC selection retries preparation at most twice and post creation uses its actual midnight date', async () => {
  const h = new Harness();
  h.nowMs = Date.parse('2026-11-13T23:59:59.900Z');
  h.prepareHook = () => {
    if (h.prepares === 1) h.nowMs += 1000;
  };
  assert.equal((await h.service().ensureToday()).day, '2026-11-14');
  assert.equal(h.prepares, 2);
  assert.equal(h.submits, 1);

  const crossing = new Harness();
  crossing.nowMs = Date.parse('2026-11-13T23:59:59.900Z');
  crossing.submitOverride = async ({ operationId }) => {
    crossing.nowMs += 1000;
    return crossing.makePost(operationId);
  };
  const posted = await crossing.service().ensureToday();
  assert.equal(posted.status, 'ready');
  assert.equal(posted.day, '2026-11-14');
  const journal = crossing.journal();
  assert.equal(journal.intendedDay, '2026-11-13');
  assert.equal(journal.phase, 'ready');
  if (journal.phase === 'ready')
    assert.equal(journal.actualPostDay, '2026-11-14');
  crossing.nowMs -= dayMs;
  await crossing.service().ensureToday();
  assert.equal(crossing.submits, 1);
  crossing.nowMs += dayMs;
  crossing.pointers.clear();
  await crossing.service().ensureToday();
  assert.equal(crossing.submits, 1);
  crossing.nowMs += dayMs;
  crossing.submitOverride = undefined;
  assert.equal((await crossing.service().ensureToday()).status, 'ready');
  assert.equal(crossing.submits, 2);
});

void test('actual creation earlier than intended day cannot reopen the intended day after clock skew', async () => {
  const h = new Harness();
  h.submitOverride = async ({ operationId }) =>
    h.makePost(operationId, undefined, h.nowMs - dayMs);
  await h.service().ensureToday();
  const state = h.journal();
  assert.equal(state.phase, 'ready');
  if (state.phase === 'ready') assert.equal(state.actualPostDay, '2026-11-12');
  await h.service().ensureToday();
  assert.equal(h.submits, 1);
  h.nowMs += dayMs;
  h.submitOverride = undefined;
  assert.equal((await h.service().ensureToday()).status, 'ready');
  assert.equal(h.submits, 2);
});

void test('repeated UTC changes exhaust two preparation selections without submitting stale-day data', async () => {
  const h = new Harness();
  h.prepareHook = () => {
    h.nowMs += dayMs;
  };
  const outcome = await h.service().ensureToday();
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.day, '2026-11-15');
  assert.equal(h.prepares, 2);
  assert.equal(h.submits, 0);
  assert.equal(h.store.calls, 0);
});

void test('rollover during final pointer lookup never reports a previous-day link as ready today', async () => {
  const h = new Harness();
  h.deps.readCurrentPost = async (day) => {
    const existing = h.pointers.get(day);
    if (h.store.raw && h.journal().phase === 'ready') h.nowMs += dayMs;
    return existing;
  };
  const outcome = await h.service().ensureToday();
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.day, '2026-11-14');
  assert.equal(h.submits, 1);
  assert.equal(h.journal().phase, 'ready');
});

void test('permanent known metadata can settle a later404 while unknown metadata cannot', async () => {
  const h = new Harness();
  h.repairFailure = true;
  await h.service().ensureToday();
  h.posts.clear();
  const outcome = await h.service().ensureToday();
  assert.equal(outcome.status, 'unavailable');
  const journal = h.journal();
  assert.equal(journal.phase, 'ready');
  if (journal.phase === 'ready')
    assert.equal(journal.availability, 'unavailable');
  assert.equal(h.submits, 1);
});

void test('corrupt journals, unavailable storage and untrusted metadata fail closed without submitting', async () => {
  for (const raw of ['', '{', '{}', '{"schemaVersion":2}']) {
    const h = new Harness();
    h.store.raw = raw;
    await assert.rejects(
      h.service().ensureToday(),
      (error: unknown) =>
        error instanceof DailyPublicationError && error.kind === 'integrity'
    );
    assert.equal(h.submits, 0);
  }
  const h = new Harness();
  h.setJournal();
  const normal = h.journal();
  for (const value of [
    { ...normal, secret: 'unexpected' },
    { ...normal, subredditId: 't5_other' },
    { ...normal, intendedDay: 'not-a-day' },
  ])
    assert.throws(
      () => parseDailyPublicationJournal(JSON.stringify(value), scope),
      DailyPublicationError
    );
  assert.equal(serializeDailyPublicationJournal(normal), h.store.raw);
  h.store.readFailure = true;
  await assert.rejects(h.service().ensureToday(), DailyPublicationError);
  assert.equal(h.submits, 0);
});
