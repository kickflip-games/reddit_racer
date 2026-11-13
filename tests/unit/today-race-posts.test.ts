import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Post } from '@devvit/web/server';
import {
  dailyChallengeKey,
  postBindingsKey,
} from '../../src/server/core/daily-challenges.ts';
import { completeCreatedRacePost } from '../../src/server/core/post.ts';
import {
  dailyRacePostsKey,
  MAX_TODAY_POST_READ_ATTEMPTS,
} from '../../src/server/core/today-race-posts.ts';
import { readTrustedRacePost } from '../../src/server/devvit-today-race-posts.ts';
import {
  DailyChallengeError,
  DAY_MILLISECONDS,
  serializeDailyChallengeRecord,
} from '../../src/shared/daily-challenge.ts';
import {
  canonicalRacePostUrl,
  parseTodayRacePostView,
} from '../../src/shared/today-race-post.ts';
import {
  todayPostFixture,
  todayPostNoon,
  todayPostScope,
} from './fixtures/today-post-fixture.ts';

const todayKey = dailyRacePostsKey(todayPostScope),
  day = '2026-11-12',
  nextDay = '2026-11-13',
  midnight = Date.parse('2026-11-13T00:00:00Z');
const input = (postId: string) => ({ subredditId: todayPostScope, postId });
function kind(expected: DailyChallengeError['kind']) {
  return (error: unknown) =>
    error instanceof DailyChallengeError && error.kind === expected;
}

void test('strict public today-post metadata permits only canonical Reddit navigation and coherent UTC readiness', () => {
  const view = {
    schemaVersion: 1,
    currentDay: day,
    serverNowMs: todayPostNoon,
    nextResetAtMs: midnight,
    status: 'ready',
    post: { postId: 't3_race', url: canonicalRacePostUrl('t3_race') },
  };
  assert.deepEqual(parseTodayRacePostView(view), view);
  assert.equal(
    parseTodayRacePostView({ ...view, status: 'not-ready', post: null }).post,
    null
  );
  for (const malformed of [
    { ...view, schemaVersion: 2 },
    { ...view, currentDay: nextDay },
    { ...view, nextResetAtMs: midnight + 1 },
    { ...view, status: 'not-ready' },
    { ...view, post: null },
    { ...view, userId: 't2_forged' },
    { ...view, post: { postId: 't3_race', url: 'https://example.com/' } },
    {
      ...view,
      post: {
        postId: 't3_race',
        url: 'https://www.reddit.com/comments/race/?redirect=elsewhere',
      },
    },
    {
      ...view,
      post: { postId: 't3_other', url: canonicalRacePostUrl('t3_race') },
    },
    {
      ...view,
      post: { postId: 't3_race/elsewhere', url: 'https://www.reddit.com/' },
    },
  ])
    assert.throws(() => parseTodayRacePostView(malformed));
});

void test('no published pointer is honest not-ready and a today query never generates or binds a course', async () => {
  const h = await todayPostFixture();
  h.addPost('t3_unregistered');
  const beforeWrites = h.store.writes.length;
  const view = await h.service.getTodayPost({ subredditId: todayPostScope });
  assert.equal(view.status, 'not-ready');
  assert.equal(view.post, null);
  assert.equal(view.currentDay, day);
  assert.equal(view.nextResetAtMs, midnight);
  h.setClock(midnight + 2 * DAY_MILLISECONDS);
  assert.equal(
    (await h.service.getTodayPost({ subredditId: todayPostScope })).status,
    'not-ready'
  );
  assert.equal(h.store.writes.length, beforeWrites);
  assert.equal(h.generateCalls, 0);
});

void test('a trusted current pointer opens a new post while the old post retains its original immutable circuit', async () => {
  const h = await todayPostFixture();
  h.addPost('t3_original');
  await h.service.registerCreatedPost(input('t3_original'));
  const original = await h.daily.getForPost(input('t3_original'));
  const originalRecord = h.saved[0];
  assert.ok(originalRecord);
  const originalStored = serializeDailyChallengeRecord(originalRecord);
  h.setClock(midnight + 1000);
  h.addPost('t3_fresh', midnight + 500);
  await h.service.registerCreatedPost(input('t3_fresh'));
  const view = await h.service.getTodayPost({ subredditId: todayPostScope });
  assert.equal(view.currentDay, nextDay);
  assert.equal(view.status, 'ready');
  assert.deepEqual(view.post, {
    postId: 't3_fresh',
    url: 'https://www.reddit.com/comments/fresh/',
  });
  const archived = await h.daily.getForPost(input('t3_original'));
  assert.equal(archived.isCurrent, false);
  assert.equal(
    archived.challenge.challengeHash,
    original.challenge.challengeHash
  );
  assert.equal(archived.challenge.day, day);
  assert.equal(
    await h.store.hGet(dailyChallengeKey(todayPostScope, day), 'record'),
    originalStored
  );
  assert.equal(h.generateCalls, 0);
});

void test('concurrent moderator posts read back one HSETNX navigation winner and keep both permanent bindings', async () => {
  const h = await todayPostFixture();
  h.addPost('t3_alpha');
  h.addPost('t3_beta');
  let arrivals = 0,
    release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  h.store.beforeNx = async (key) => {
    if (key !== todayKey) return;
    if (++arrivals === 2) release();
    await gate;
  };
  const [a, b] = await Promise.all([
    h.service.registerCreatedPost(input('t3_alpha')),
    h.service.registerCreatedPost(input('t3_beta')),
  ]);
  assert.ok(a && b);
  assert.deepEqual(a, b);
  assert.equal(
    h.store.writes.filter((entry) => entry.key === todayKey && entry.won)
      .length,
    1
  );
  assert.ok(await h.store.hGet(postBindingsKey(todayPostScope), 't3_alpha'));
  assert.ok(await h.store.hGet(postBindingsKey(todayPostScope), 't3_beta'));
  assert.equal(
    (await h.service.getTodayPost({ subredditId: todayPostScope })).post
      ?.postId,
    a.postId
  );
});

void test('creation metadata crossing midnight registers its actual original day rather than the server load day', async () => {
  const h = await todayPostFixture();
  h.setClock(midnight + 1000);
  h.addPost('t3_before', midnight - 1);
  const pointer = await h.service.registerCreatedPost(input('t3_before'));
  assert.equal(pointer?.day, day);
  assert.ok(await h.store.hGet(todayKey, day));
  assert.equal(await h.store.hGet(todayKey, nextDay), undefined);
  assert.equal(
    (await h.service.getTodayPost({ subredditId: todayPostScope })).status,
    'not-ready'
  );
});

void test('midnight during a pointer lookup retries the current day and repeated rollovers stop at the hard bound', async () => {
  const h = await todayPostFixture();
  h.addPost('t3_old');
  h.addPost('t3_new', midnight + 100);
  await h.service.registerCreatedPost(input('t3_old'));
  await h.service.registerCreatedPost(input('t3_new'));
  h.setClock(midnight - 1);
  h.store.afterGet = (key, field) => {
    if (key === todayKey && field === day) h.setClock(midnight + 1);
  };
  const view = await h.service.getTodayPost({ subredditId: todayPostScope });
  assert.equal(view.currentDay, nextDay);
  assert.equal(view.post?.postId, 't3_new');
  let rollovers = 0;
  h.store.afterGet = (key) => {
    if (key === todayKey) h.setClock(midnight + ++rollovers * DAY_MILLISECONDS);
  };
  await assert.rejects(
    h.service.getTodayPost({ subredditId: todayPostScope }),
    kind('unavailable')
  );
  assert.equal(rollovers, MAX_TODAY_POST_READ_ATTEMPTS);
});

void test('corrupt pointer identity, permanent binding or immutable hash fails closed without replacing data', async () => {
  for (const corruption of [
    'hash',
    'scope',
    'day',
    'schema',
    'binding',
    'record',
  ]) {
    const h = await todayPostFixture();
    h.addPost('t3_race');
    const pointer = await h.service.registerCreatedPost(input('t3_race'));
    assert.ok(pointer);
    if (corruption === 'binding')
      h.store.values.get(postBindingsKey(todayPostScope))?.delete('t3_race');
    else if (corruption === 'record')
      h.store.values
        .get(dailyChallengeKey(todayPostScope, day))
        ?.delete('record');
    else
      h.store.inject(
        todayKey,
        day,
        JSON.stringify({
          ...pointer,
          ...(corruption === 'hash' ? { challengeHash: 'f'.repeat(64) } : {}),
          ...(corruption === 'scope' ? { subredditId: 't5_elsewhere' } : {}),
          ...(corruption === 'day' ? { day: nextDay } : {}),
          ...(corruption === 'schema' ? { schemaVersion: 2 } : {}),
        })
      );
    const stored = await h.store.hGet(todayKey, day),
      writes = h.store.writes.length;
    await assert.rejects(
      h.service.getTodayPost({ subredditId: todayPostScope }),
      kind(corruption === 'schema' ? 'unsupported' : 'integrity')
    );
    assert.equal(await h.store.hGet(todayKey, day), stored);
    assert.equal(h.store.writes.length, writes);
  }
});

void test('removed/deleted posts are not-ready while metadata contradictions and transient outages fail closed', async () => {
  const h = await todayPostFixture();
  const post = h.addPost('t3_race');
  await h.service.registerCreatedPost(input('t3_race'));
  post.available = false;
  assert.equal(
    (await h.service.getTodayPost({ subredditId: todayPostScope })).status,
    'not-ready'
  );
  h.posts.delete(post.id);
  assert.equal(
    (await h.service.getTodayPost({ subredditId: todayPostScope })).post,
    null
  );
  h.posts.set(post.id, { ...post, available: true, subredditId: 't5_other' });
  await assert.rejects(
    h.service.getTodayPost({ subredditId: todayPostScope }),
    kind('integrity')
  );
  h.posts.set(post.id, { ...post, available: true });
  h.setLookupFailure(true);
  await assert.rejects(
    h.service.getTodayPost({ subredditId: todayPostScope }),
    kind('unavailable')
  );
  h.setLookupFailure(false);
  h.store.throwReads = true;
  await assert.rejects(
    h.service.getTodayPost({ subredditId: todayPostScope }),
    kind('unavailable')
  );
});

void test('unconfirmed pointer writes and unpersisted courses cannot advertise a locally invented winner', async () => {
  const h = await todayPostFixture();
  h.addPost('t3_race');
  h.store.dropPointerWrites = true;
  await assert.rejects(
    h.service.registerCreatedPost(input('t3_race')),
    kind('unavailable')
  );
  assert.equal(await h.store.hGet(todayKey, day), undefined);
  h.store.dropPointerWrites = false;
  h.store.values.get(dailyChallengeKey(todayPostScope, day))?.delete('record');
  await assert.rejects(
    h.service.registerCreatedPost(input('t3_race')),
    kind('integrity')
  );
  assert.equal(await h.store.hGet(todayKey, day), undefined);
  assert.equal(h.generateCalls, 0);
});

void test('post-submission repair or registration failure returns the created post and logs only a fixed warning', async () => {
  for (const failed of ['binding', 'post-data', 'pointer', 'none']) {
    const h = await todayPostFixture(),
      events: string[] = [],
      warnings: string[] = [];
    h.addPost('t3_created', midnight + 10);
    h.setClock(midnight + 20);
    const post = {
      id: 't3_created',
      setPostData: async (data: {
        challengeSchema: number;
        challengeDay: string;
        challengeHash: string;
      }) => {
        events.push('post-data');
        assert.equal(data.challengeDay, nextDay);
        if (failed === 'post-data') throw new Error('secret SDK metadata');
      },
    };
    const result = await completeCreatedRacePost(post, {
      subredditId: todayPostScope,
      daily: {
        getForPost: async (selected) => {
          events.push('binding');
          if (failed === 'binding') throw new Error('secret SDK metadata');
          return h.daily.getForPost(selected);
        },
      },
      todayPosts: {
        registerCreatedPost: async (selected) => {
          events.push('pointer');
          if (failed === 'pointer') throw new Error('secret SDK metadata');
          return h.service.registerCreatedPost(selected);
        },
      },
      warn: (message) => warnings.push(message),
    });
    assert.equal(result, post);
    assert.equal(warnings.length, failed === 'none' ? 0 : 1);
    assert.ok(warnings.every((message) => !message.includes('secret')));
    assert.deepEqual(
      events,
      failed === 'binding'
        ? ['binding']
        : failed === 'post-data'
          ? ['binding', 'post-data']
          : ['binding', 'post-data', 'pointer']
    );
  }
});

void test('SDK post lookup distinguishes explicit absence/removal from an account deletion or transient service error', async () => {
  const post: Pick<
    Post,
    | 'id'
    | 'subredditId'
    | 'createdAt'
    | 'removed'
    | 'spam'
    | 'removedByCategory'
  > = {
    id: 't3_race',
    subredditId: 't5_home',
    createdAt: new Date(todayPostNoon),
    removed: false,
    spam: false,
    removedByCategory: undefined,
  };
  const lookup = async () => post;
  assert.equal((await readTrustedRacePost('t3_race', lookup))?.available, true);
  assert.equal(
    (
      await readTrustedRacePost('t3_race', async () => ({
        ...post,
        removed: true,
      }))
    )?.available,
    false
  );
  assert.equal(
    (
      await readTrustedRacePost('t3_race', async () => ({
        ...post,
        spam: true,
      }))
    )?.available,
    false
  );
  assert.equal(
    (
      await readTrustedRacePost('t3_race', async () => ({
        ...post,
        removedByCategory: 'deleted',
      }))
    )?.available,
    false
  );
  for (const absence of [
    new Error('no post t3_race'),
    { status: 404 },
    { code: 5 },
  ])
    assert.equal(
      await readTrustedRacePost('t3_race', async () => {
        throw absence;
      }),
      undefined
    );
  await assert.rejects(
    readTrustedRacePost('t3_race', async () => {
      throw new Error('gateway offline');
    })
  );
  await assert.rejects(
    readTrustedRacePost('t3_race/redirect', lookup),
    kind('integrity')
  );
});

void test('a registered historical day is read unchanged after later UTC days without generating or rebinding', async () => {
  const h = await todayPostFixture();
  const original = h.addPost('t3_historical');
  await h.service.registerCreatedPost(input(original.id));
  const before = structuredClone(h.store.values);
  const writes = h.store.writes.length;
  h.setClock(midnight + 5 * DAY_MILLISECONDS);

  assert.deepEqual(
    await h.service.readRegisteredPost({ subredditId: todayPostScope, day }),
    original
  );
  assert.deepEqual(h.store.values, before);
  assert.equal(h.store.writes.length, writes);
  assert.equal(h.generateCalls, 0);
  assert.ok(await h.store.hGet(postBindingsKey(todayPostScope), original.id));
  assert.ok(
    await h.store.hGet(dailyChallengeKey(todayPostScope, day), 'record')
  );
  assert.ok(await h.store.hGet(todayKey, day));
  assert.equal(await h.store.hGet(todayKey, '2026-11-18'), undefined);
});

void test('internal reads distinguish no pointer from an unavailable registered post and preserve its metadata', async () => {
  const h = await todayPostFixture();
  const initial = structuredClone(h.store.values);
  assert.equal(
    await h.service.readRegisteredPost({ subredditId: todayPostScope, day }),
    undefined
  );
  assert.deepEqual(h.store.values, initial);
  assert.equal(h.store.writes.length, 0);

  const post = h.addPost('t3_unavailable');
  await h.service.registerCreatedPost(input(post.id));
  const registered = structuredClone(h.store.values);
  const writes = h.store.writes.length;
  const expected = { ...post, available: false };
  h.setClock(midnight + 5 * DAY_MILLISECONDS);
  post.available = false;
  assert.deepEqual(
    await h.service.readRegisteredPost({ subredditId: todayPostScope, day }),
    expected
  );
  h.posts.delete(post.id);
  assert.deepEqual(
    await h.service.readRegisteredPost({ subredditId: todayPostScope, day }),
    expected
  );
  assert.deepEqual(h.store.values, registered);
  assert.equal(h.store.writes.length, writes);
  assert.equal(h.generateCalls, 0);
});
