import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DailyPublicationError } from '../../src/server/core/daily-publication.ts';
import {
  PRIVATE_RACE_APP,
  PUBLIC_RACE_COMMUNITY,
  PUBLIC_RACE_SUBREDDIT_ID,
  PRIVATE_RACE_COMMUNITY,
  PRIVATE_RACE_SUBREDDIT_ID,
  requirePublicationScope,
} from '../../src/server/devvit-daily-publication.ts';
import type { PublicationScopeInput } from '../../src/server/devvit-daily-publication.ts';

const privateScope = {
  appSlug: 'the-daily-lap',
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
  const input: PublicationScopeInput = {
    ...privateScope,
    getSubreddit: async (id) => {
      lookedUp.push(id);
      return privateMetadata;
    },
  };
  assert.deepEqual(await requirePublicationScope(input), privateScope);
  assert.deepEqual(lookedUp, ['t5_kv7foq']);

  // Reddit community names are case-insensitive; returned scope stays canonical.
  assert.deepEqual(
    await requirePublicationScope({
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
  const invalid: Partial<PublicationScopeInput>[] = [
    { appSlug: undefined },
    { appSlug: null },
    { appSlug: 1 },
    { appSlug: '' },
    { appSlug: 'other-racer' },
    { appSlug: 'full-throttle-dev' },
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
      requirePublicationScope({
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
  await assert.rejects(requirePublicationScope(spoofed), unavailable);
  assert.equal(reads, 0);

  // Even matching request fields cannot bypass contradictory SDK metadata.
  await assert.rejects(
    requirePublicationScope({
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
      requirePublicationScope({
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
    requirePublicationScope({
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

const publicScope = {
  appSlug: 'the-daily-lap',
  subredditId: 't5_kyc33w',
  subredditName: 'theDailyLap',
};
const publicMetadata = {
  id: publicScope.subredditId,
  name: publicScope.subredditName,
  type: 'public',
};
void test('the authorized public community returns its own canonical scope', async () => {
  assert.equal(PUBLIC_RACE_SUBREDDIT_ID, publicScope.subredditId);
  assert.equal(PUBLIC_RACE_COMMUNITY, publicScope.subredditName);
  for (const name of ['theDailyLap', 'THEDAILYLAP']) {
    const reads: string[] = [];
    const result = await requirePublicationScope({
      ...publicScope,
      subredditName: name,
      getSubreddit: async (id) => {
        reads.push(id);
        return { ...publicMetadata, name: 'thedailylap' };
      },
    });
    assert.deepEqual(result, publicScope);
    assert.deepEqual(reads, [publicScope.subredditId]);
  }
});
void test('crossed scope IDs/names and arbitrary public communities fail before lookup', async () => {
  for (const input of [
    { ...publicScope, subredditId: privateScope.subredditId },
    { ...privateScope, subredditId: publicScope.subredditId },
    { ...publicScope, subredditId: 't5_elsewhere' },
    { ...publicScope, subredditName: 'another_public_community' },
    { ...publicScope, appSlug: 'another-app' },
  ]) {
    let reads = 0;
    await assert.rejects(
      requirePublicationScope({
        ...input,
        getSubreddit: async () => {
          reads++;
          return publicMetadata;
        },
      }),
      unavailable
    );
    assert.equal(reads, 0);
  }
});
void test('public scope requires its own trusted ID/name and public visibility', async () => {
  for (const metadata of [
    undefined,
    { ...publicMetadata, id: privateScope.subredditId },
    { ...publicMetadata, name: privateScope.subredditName },
    { ...publicMetadata, type: 'private' },
    { ...publicMetadata, type: 'restricted' },
    { ...publicMetadata, type: '' },
  ]) {
    await assert.rejects(
      requirePublicationScope({
        ...publicScope,
        getSubreddit: async () => metadata,
      }),
      unavailable
    );
  }
  await assert.rejects(
    requirePublicationScope({
      ...publicScope,
      getSubreddit: async () => {
        throw new Error('SDK unavailable');
      },
    })
  );
});
