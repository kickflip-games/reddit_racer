import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createApiApp } from '../../src/server/app.ts';
import type { AppRouter } from '../../src/server/trpc.ts';
import { dailyRacePostsKey } from '../../src/server/core/today-race-posts.ts';
import { parseTodayRacePostView } from '../../src/shared/today-race-post.ts';
import {
  todayPostFixture,
  todayPostScope,
} from './fixtures/today-post-fixture.ts';

async function harness() {
  const h = await todayPostFixture();
  h.addPost('t3_origin');
  const app = createApiApp(() => ({
    getDailyChallenge: () =>
      h.daily.getForPost({ subredditId: todayPostScope, postId: 't3_origin' }),
    todayRacePost: () =>
      h.service.getTodayPost({ subredditId: todayPostScope }),
    startRankedRace: async () => {
      throw new Error('Unexpected ranked session');
    },
    submitRun: async () => {
      throw new Error('Unexpected ranked submission');
    },
    getLeaderboard: async () => {
      throw new Error('Unexpected leaderboard query');
    },
  }));
  const client = createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: 'http://racer.test/api/trpc',
        fetch: async (url, init) =>
          app.request(
            new Request(url, {
              method: init?.method ?? 'GET',
              ...(init?.headers ? { headers: init.headers } : {}),
              ...(typeof init?.body === 'string' ? { body: init.body } : {}),
            })
          ),
      }),
    ],
  });
  return { ...h, app, client };
}

void test('HTTP todayRacePost needs no account and distinguishes a missing post from a verified canonical link', async () => {
  const h = await harness();
  assert.equal((await h.client.todayRacePost.query()).status, 'not-ready');
  await h.service.registerCreatedPost({
    subredditId: todayPostScope,
    postId: 't3_origin',
  });
  const view = parseTodayRacePostView(await h.client.todayRacePost.query());
  assert.equal(view.status, 'ready');
  assert.deepEqual(view.post, {
    postId: 't3_origin',
    url: 'https://www.reddit.com/comments/origin/',
  });
  const response = await h.app.request('/api/trpc/todayRacePost');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.status, 200);
});

void test('HTTP todayRacePost rejects caller-selected dates/posts/URLs/scopes and ignores identity headers', async () => {
  const h = await harness();
  for (const input of [
    null,
    {},
    { day: '2026-11-13' },
    { postId: 't3_other' },
    { subredditId: 't5_other' },
    { url: 'https://example.com' },
  ]) {
    const response = await h.app.request(
      `/api/trpc/todayRacePost?input=${encodeURIComponent(JSON.stringify(input))}`
    );
    assert.equal(response.status, 400);
  }
  const response = await h.app.request('/api/trpc/todayRacePost', {
    headers: { 'X-Subreddit-Id': 't5_other', 'X-User-Id': 't2_fake' },
  });
  assert.equal(response.status, 200);
  assert.equal(h.generateCalls, 0);
});

void test('HTTP archive navigation targets today while the loaded original daily course stays immutable', async () => {
  const h = await harness();
  const original = await h.client.dailyChallenge.query();
  const nextMidnight = Date.parse('2026-11-13T00:00:00Z');
  h.setClock(nextMidnight + 1000);
  h.addPost('t3_fresh', nextMidnight + 500);
  await h.service.registerCreatedPost({
    subredditId: todayPostScope,
    postId: 't3_fresh',
  });
  const view = await h.client.todayRacePost.query();
  assert.equal(view.currentDay, '2026-11-13');
  assert.equal(view.post?.postId, 't3_fresh');
  const archived = await h.client.dailyChallenge.query();
  assert.equal(archived.isCurrent, false);
  assert.equal(
    archived.challenge.challengeHash,
    original.challenge.challengeHash
  );
  assert.equal(archived.challenge.day, original.challenge.day);
});

void test('HTTP corrupt pointers fail412 and transient storage outages fail503 without changing practice data', async () => {
  const h = await harness();
  const original = await h.client.dailyChallenge.query();
  await h.service.registerCreatedPost({
    subredditId: todayPostScope,
    postId: 't3_origin',
  });
  const key = dailyRacePostsKey(todayPostScope);
  h.store.inject(key, '2026-11-12', '{broken');
  assert.equal((await h.app.request('/api/trpc/todayRacePost')).status, 412);
  assert.equal(
    (await h.client.dailyChallenge.query()).challenge.challengeHash,
    original.challenge.challengeHash
  );
  h.store.throwReads = true;
  const response = await h.app.request('/api/trpc/todayRacePost');
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('Injected storage outage'));
});
