import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Post } from '@devvit/web/server';
import { resolveCreatedRacePost } from '../../src/server/core/post.ts';
import type { DailyPublicationResult } from '../../src/server/core/daily-publication.ts';

const now = Date.parse('2026-11-13T12:00:00Z');
const scope = 't5_private';
const day = '2026-11-13';
type Metadata = Pick<
  Post,
  'id' | 'subredditId' | 'createdAt' | 'removed' | 'spam' | 'removedByCategory'
>;
const current: Metadata = {
  id: 't3_current',
  subredditId: scope,
  createdAt: new Date(now - 60_000),
  removed: false,
  spam: false,
  removedByCategory: undefined,
};
function result(
  status: DailyPublicationResult['status'] = 'unavailable',
  postId: string | null = current.id
): DailyPublicationResult {
  return { status, postId, day };
}
function safeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'The daily race post is not ready yet.'
  );
}

void test('a ready coordinator result remains usable without another SDK lookup', async () => {
  const post = await resolveCreatedRacePost(result('ready'), {
    subredditId: scope,
    now: () => now,
    lookup: async () =>
      assert.fail('Ready result already validated by coordinator'),
  });
  assert.deepEqual(post, { id: current.id });
});

void test('an available current post remains navigable while metadata repair is pending', async () => {
  const statuses: DailyPublicationResult['status'][] = [
    'busy',
    'uncertain',
    'unavailable',
  ];
  for (const status of statuses) {
    const outcome = result(status);
    let reads = 0;
    assert.deepEqual(
      await resolveCreatedRacePost(outcome, {
        subredditId: scope,
        now: () => now,
        lookup: async (id) => {
          reads++;
          assert.equal(id, current.id);
          return current;
        },
      }),
      { id: current.id }
    );
    assert.equal(reads, 1);
  }
});

void test('removed, spam, deleted and missing known posts never become fallback links', async () => {
  for (const post of [
    { ...current, removed: true },
    { ...current, spam: true },
    { ...current, removedByCategory: 'deleted' },
  ]) {
    await assert.rejects(
      resolveCreatedRacePost(result(), {
        subredditId: scope,
        now: () => now,
        lookup: async () => post,
      }),
      safeError
    );
  }
  await assert.rejects(
    resolveCreatedRacePost(result(), {
      subredditId: scope,
      now: () => now,
      lookup: async () => {
        throw { status: 404 };
      },
    }),
    safeError
  );
});

void test('old-day, different-ID or different-community metadata is rejected', async () => {
  const wrongId: Metadata = { ...current, id: 't3_wrong' };
  const wrongScope: Metadata = { ...current, subredditId: 't5_other' };
  const old: Metadata = { ...current, createdAt: new Date(now - 86_400_000) };
  for (const post of [wrongId, wrongScope, old]) {
    await assert.rejects(
      resolveCreatedRacePost(result(), {
        subredditId: scope,
        now: () => now,
        lookup: async () => post,
      }),
      safeError
    );
  }
});

void test('a UTC change before or during lookup never returns a stale fallback', async () => {
  await assert.rejects(
    resolveCreatedRacePost(result(), {
      subredditId: scope,
      now: () => now + 86_400_000,
      lookup: async () => assert.fail('Already stale before lookup'),
    }),
    safeError
  );
  let currentTime = now;
  await assert.rejects(
    resolveCreatedRacePost(result(), {
      subredditId: scope,
      now: () => currentTime,
      lookup: async () => {
        currentTime += 86_400_000;
        return current;
      },
    }),
    safeError
  );
});

void test('malformed IDs, missing IDs, lookup outages and invalid clocks expose only the fixed safe error', async () => {
  for (const postId of [null, 'invalid/post']) {
    await assert.rejects(
      resolveCreatedRacePost(result('unavailable', postId), {
        subredditId: scope,
        now: () => now,
        lookup: async () => assert.fail('Invalid IDs cannot select a lookup'),
      }),
      safeError
    );
  }
  await assert.rejects(
    resolveCreatedRacePost(result(), {
      subredditId: scope,
      now: () => now,
      lookup: async () => {
        throw new Error('Private SDK token detail');
      },
    }),
    safeError
  );
  await assert.rejects(
    resolveCreatedRacePost(result(), {
      subredditId: scope,
      now: () => NaN,
      lookup: async () => current,
    }),
    safeError
  );
});
