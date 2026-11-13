import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DailyPublicationError } from '../../src/server/core/daily-publication.ts';
import {
  PRIVATE_RACE_APP,
  PRIVATE_RACE_COMMUNITY,
  PRIVATE_RACE_SUBREDDIT_ID,
  requirePrivatePublicationScope,
} from '../../src/server/devvit-daily-publication.ts';
import type { PrivatePublicationScopeInput } from '../../src/server/devvit-daily-publication.ts';

const privateScope = {
  appSlug: 'full-throttle-dev',
  subredditId: 't5_kv7foq',
  subredditName: 'full_throttle_dev_dev',
};
const privateMetadata = {
  id: privateScope.subredditId,
  name: privateScope.subredditName,
  type: 'private',
};
function unavailable(error: unknown): boolean {
  return error instanceof DailyPublicationError && error.kind === 'unavailable';
}

void test('publication guard requires the registered app, exact private community and a trusted SDK read', async () => {
  assert.equal(PRIVATE_RACE_APP, privateScope.appSlug);
  assert.equal(PRIVATE_RACE_COMMUNITY, privateScope.subredditName);
  assert.equal(PRIVATE_RACE_SUBREDDIT_ID, privateScope.subredditId);
  const lookedUp: string[] = [];
  const input: PrivatePublicationScopeInput = {
    ...privateScope,
    getSubreddit: async (id) => {
      lookedUp.push(id);
      return privateMetadata;
    },
  };
  assert.deepEqual(await requirePrivatePublicationScope(input), privateScope);
  assert.deepEqual(lookedUp, ['t5_kv7foq']);

  // Reddit community names are case-insensitive; returned scope stays canonical.
  assert.deepEqual(
    await requirePrivatePublicationScope({
      ...input,
      subredditName: 'Full_Throttle_Dev_Dev',
      getSubreddit: async () => ({
        ...privateMetadata,
        name: 'FULL_THROTTLE_DEV_DEV',
      }),
    }),
    privateScope
  );
});

void test('missing, non-string and wrong request-local app/community fields fail before any SDK read', async () => {
  const invalid: Partial<PrivatePublicationScopeInput>[] = [
    { appSlug: undefined },
    { appSlug: null },
    { appSlug: 1 },
    { appSlug: '' },
    { appSlug: 'other-racer' },
    { subredditId: undefined },
    { subredditId: null },
    { subredditId: 1 },
    { subredditId: 't5_elsewhere' },
    { subredditId: 't5_KV7FOQ' },
    { subredditId: 't5_kv7foq:other' },
    { subredditName: undefined },
    { subredditName: null },
    { subredditName: false },
    { subredditName: '' },
    { subredditName: 'another_community' },
  ];
  for (const changed of invalid) {
    let reads = 0;
    await assert.rejects(
      requirePrivatePublicationScope({
        ...privateScope,
        ...changed,
        getSubreddit: async () => {
          reads++;
          return privateMetadata;
        },
      }),
      unavailable
    );
    assert.equal(reads, 0);
  }
});

void test('caller body, post data and claimed SDK metadata cannot replace the guarded scope', async () => {
  let reads = 0;
  const spoofed = {
    appSlug: 'another-app',
    subredditId: 't5_elsewhere',
    subredditName: 'another_community',
    body: privateScope,
    postData: { ...privateScope, private: true },
    sdkMetadata: privateMetadata,
    getSubreddit: async () => {
      reads++;
      return privateMetadata;
    },
  };
  await assert.rejects(requirePrivatePublicationScope(spoofed), unavailable);
  assert.equal(reads, 0);

  // Even matching request fields cannot bypass contradictory SDK metadata.
  await assert.rejects(
    requirePrivatePublicationScope({
      ...spoofed,
      ...privateScope,
      getSubreddit: async () => ({ ...privateMetadata, type: 'public' }),
    }),
    unavailable
  );
});

void test('actual public, restricted or mismatched SDK community metadata rejects publication', async () => {
  for (const metadata of [
    undefined,
    { ...privateMetadata, type: 'public' },
    { ...privateMetadata, type: 'restricted' },
    { ...privateMetadata, type: '' },
    { ...privateMetadata, id: 't5_elsewhere' },
    { ...privateMetadata, name: 'another_community' },
  ]) {
    const lookedUp: string[] = [];
    await assert.rejects(
      requirePrivatePublicationScope({
        ...privateScope,
        getSubreddit: async (id) => {
          lookedUp.push(id);
          return metadata;
        },
      }),
      unavailable
    );
    assert.deepEqual(lookedUp, [privateScope.subredditId]);
  }
});

void test('an unavailable SDK community read cannot grant publication permission', async () => {
  let reads = 0;
  await assert.rejects(
    requirePrivatePublicationScope({
      ...privateScope,
      getSubreddit: async (id) => {
        reads++;
        assert.equal(id, privateScope.subredditId);
        throw new Error('Injected SDK read failure');
      },
    })
  );
  assert.equal(reads, 1);
});
