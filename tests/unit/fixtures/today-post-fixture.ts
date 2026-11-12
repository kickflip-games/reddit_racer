import {
  createDailyChallengeService,
  dailyChallengeKey,
} from '../../../src/server/core/daily-challenges.ts';
import type { DailyChallengeStore } from '../../../src/server/core/daily-challenges.ts';
import {
  createTodayRacePostsService,
  dailyRacePostsKey,
} from '../../../src/server/core/today-race-posts.ts';
import type { TrustedRacePost } from '../../../src/server/core/today-race-posts.ts';
import {
  createDailyChallengeRecord,
  serializeDailyChallengeRecord,
} from '../../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../../src/shared/circuit-quality.ts';
import { FALLBACK_CIRCUIT_SEED } from '../../../src/shared/circuit-generator.ts';

export const todayPostNoon = Date.parse('2026-11-12T12:00:00Z');
export const todayPostScope = 't5_home';
const generated = generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
  generator: { maxAttempts: 1 },
  maxQualityAttempts: 1,
});
const records = Promise.all(
  ['2026-11-12', '2026-11-13'].map((day) =>
    createDailyChallengeRecord({
      subredditId: todayPostScope,
      day,
      createdAtMs: Date.parse(`${day}T12:00:00Z`),
      requestedSeed: 'today-post-fixture',
      generated,
    })
  )
);

/** HSETNX check/write is synchronous after any explicit race barrier. */
export class TodayPostHashStore implements DailyChallengeStore {
  readonly values = new Map<string, Map<string, string>>();
  readonly reads: { key: string; field: string }[] = [];
  readonly writes: { key: string; field: string; won: boolean }[] = [];
  beforeNx: ((key: string, field: string) => Promise<void>) | undefined;
  afterGet: ((key: string, field: string) => void) | undefined;
  dropPointerWrites = false;
  throwReads = false;
  async hGet(key: string, field: string): Promise<string | undefined> {
    if (this.throwReads) throw new Error('Injected storage outage');
    this.reads.push({ key, field });
    const value = this.values.get(key)?.get(field);
    this.afterGet?.(key, field);
    return value;
  }
  async hSetNX(key: string, field: string, value: string): Promise<number> {
    await this.beforeNx?.(key, field);
    if (this.dropPointerWrites && key === dailyRacePostsKey(todayPostScope)) {
      this.writes.push({ key, field, won: false });
      return 1;
    }
    const existing = this.values.get(key)?.has(field) ?? false;
    this.writes.push({ key, field, won: !existing });
    if (existing) return 0;
    this.inject(key, field, value);
    return 1;
  }
  inject(key: string, field: string, value: string): void {
    let hash = this.values.get(key);
    if (!hash) {
      hash = new Map();
      this.values.set(key, hash);
    }
    hash.set(field, value);
  }
}

export async function todayPostFixture() {
  let clock = todayPostNoon,
    generateCalls = 0,
    lookupFailure = false;
  const store = new TodayPostHashStore();
  const posts = new Map<string, TrustedRacePost>();
  const saved = await records;
  for (const record of saved)
    store.inject(
      dailyChallengeKey(todayPostScope, record.day),
      'record',
      serializeDailyChallengeRecord(record)
    );
  const daily = createDailyChallengeService({
    store,
    now: () => clock,
    getPost: async (id) => {
      const post = posts.get(id);
      if (!post) throw new Error('Trusted originating post is missing');
      return post;
    },
    generate: () => {
      generateCalls++;
      throw new Error('Today pointer reads must never generate a track');
    },
    reserve: () => {
      throw new Error('Today pointer reads must never generate a reserve');
    },
  });
  const service = createTodayRacePostsService({
    store,
    daily,
    now: () => clock,
    getPost: async (id) => {
      if (lookupFailure) throw new Error('Injected Reddit outage');
      return posts.get(id);
    },
  });
  function addPost(id: string, createdAtMs = todayPostNoon): TrustedRacePost {
    const post = {
      id,
      subredditId: todayPostScope,
      createdAtMs,
      available: true,
    };
    posts.set(id, post);
    return post;
  }
  return {
    store,
    posts,
    daily,
    service,
    saved,
    addPost,
    get generateCalls() {
      return generateCalls;
    },
    setClock: (value: number) => {
      clock = value;
    },
    setLookupFailure: (value: boolean) => {
      lookupFailure = value;
    },
  };
}
