import {
  createDailyChallengeRecord,
  dailyChallengeView,
  DailyChallengeError,
  parseDailyChallengeRecord,
  serializeDailyChallengeRecord,
  utcDay,
  utcDayWindow,
  validateSubredditId,
} from '../../shared/daily-challenge.ts';
import type {
  DailyChallengeRecord,
  DailyChallengeView,
} from '../../shared/daily-challenge.ts';
import type { ValidatedCircuit } from '../../shared/circuit-quality.ts';

export { DailyChallengeError } from '../../shared/daily-challenge.ts';
export type DailyChallengeStore = {
  hGet: (key: string, field: string) => Promise<string | undefined>;
  hSetNX: (key: string, field: string, value: string) => Promise<number>;
};
export type TrustedChallengePost = {
  id: string;
  subredditId: string;
  createdAtMs: number;
};
export type PostBinding = {
  schemaVersion: 1;
  postId: string;
  subredditId: string;
  day: string;
  createdAtMs: number;
};
export type DailyChallengeServiceDependencies = {
  store: DailyChallengeStore;
  now: () => number;
  getPost: (postId: string) => Promise<TrustedChallengePost>;
  generate: (seed: string) => ValidatedCircuit | Promise<ValidatedCircuit>;
  reserve: () => ValidatedCircuit | Promise<ValidatedCircuit>;
};
export type DailyPostInput = { subredditId: string; postId: string };
export type DailyRecordInput = { subredditId: string; day: string };
export type DailyChallengeService = {
  getForPost: (input: DailyPostInput) => Promise<DailyChallengeView>;
  bindPost: (input: DailyPostInput) => Promise<PostBinding>;
  getOrCreate: (input: DailyRecordInput) => Promise<DailyChallengeRecord>;
  read: (input: DailyRecordInput) => Promise<DailyChallengeRecord | null>;
};

/** Logical keys deliberately exclude code/schema versions: deployments cannot fork a day. */
export function dailyChallengeKey(subredditId: string, day: string): string {
  validateSubredditId(subredditId);
  utcDayWindow(day);
  return `racer:daily:${subredditId}:${day}`;
}
export function postBindingsKey(subredditId: string): string {
  validateSubredditId(subredditId);
  return `racer:posts:${subredditId}`;
}
function validatePostId(postId: string): void {
  if (
    typeof postId !== 'string' ||
    postId.length > 40 ||
    !/^t3_[a-z0-9]+$/.test(postId)
  )
    throw new DailyChallengeError(
      'invalid',
      'A trusted originating Reddit post ID is required'
    );
}
function decoded(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new DailyChallengeError(
      'integrity',
      'Stored challenge data is not valid JSON'
    );
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseBinding(value: unknown, expected: DailyPostInput): PostBinding {
  if (!record(value))
    throw new DailyChallengeError(
      'integrity',
      'Stored post binding is malformed'
    );
  if (value.schemaVersion !== 1)
    throw new DailyChallengeError(
      'unsupported',
      'Stored post binding schema is unsupported'
    );
  const keys = ['schemaVersion', 'postId', 'subredditId', 'day', 'createdAtMs'];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key)) ||
    value.postId !== expected.postId ||
    value.subredditId !== expected.subredditId ||
    typeof value.day !== 'string' ||
    typeof value.createdAtMs !== 'number' ||
    !Number.isSafeInteger(value.createdAtMs) ||
    value.createdAtMs < 0
  )
    throw new DailyChallengeError(
      'integrity',
      'Stored post binding does not match its originating post'
    );
  let day: string;
  try {
    day = utcDay(value.createdAtMs);
  } catch {
    throw new DailyChallengeError(
      'integrity',
      'Stored post creation timestamp is invalid'
    );
  }
  if (value.day !== day)
    throw new DailyChallengeError(
      'integrity',
      'Stored post day does not match its creation timestamp'
    );
  return {
    schemaVersion: 1,
    postId: expected.postId,
    subredditId: expected.subredditId,
    day,
    createdAtMs: value.createdAtMs,
  };
}

/** All platform state is injected. The service never accepts client identity, day or post time. */
export function createDailyChallengeService(
  deps: DailyChallengeServiceDependencies
): DailyChallengeService {
  async function readField(
    key: string,
    field: string
  ): Promise<string | undefined> {
    try {
      return await deps.store.hGet(key, field);
    } catch {
      throw new DailyChallengeError(
        'unavailable',
        'Daily challenge storage is unavailable'
      );
    }
  }
  async function putIfAbsent(
    key: string,
    field: string,
    value: string
  ): Promise<void> {
    try {
      await deps.store.hSetNX(key, field, value);
    } catch {
      throw new DailyChallengeError(
        'unavailable',
        'Daily challenge storage could not confirm an atomic write'
      );
    }
  }
  function now(): number {
    let value: number;
    try {
      value = deps.now();
      utcDay(value);
    } catch {
      throw new DailyChallengeError(
        'unavailable',
        'The authoritative server clock is unavailable'
      );
    }
    return value;
  }
  async function read(
    input: DailyRecordInput
  ): Promise<DailyChallengeRecord | null> {
    const key = dailyChallengeKey(input.subredditId, input.day);
    const value = await readField(key, 'record');
    if (value === undefined) return null;
    const challenge = await parseDailyChallengeRecord(decoded(value));
    if (
      challenge.subredditId !== input.subredditId ||
      challenge.day !== input.day
    )
      throw new DailyChallengeError(
        'integrity',
        'Stored challenge does not match its logical daily key'
      );
    return challenge;
  }
  async function getOrCreate(
    input: DailyRecordInput
  ): Promise<DailyChallengeRecord> {
    const existing = await read(input);
    if (existing) return existing;
    const requestedSeed = `daily:${input.subredditId}:${input.day}`;
    const makeRecord = async (
      reserve: boolean
    ): Promise<DailyChallengeRecord> => {
      const generated = reserve
        ? await deps.reserve()
        : await deps.generate(requestedSeed);
      return createDailyChallengeRecord({
        subredditId: input.subredditId,
        day: input.day,
        createdAtMs: now(),
        requestedSeed,
        generated,
        generatorFallback: reserve,
      });
    };
    let candidate: DailyChallengeRecord;
    try {
      candidate = await makeRecord(false);
    } catch {
      try {
        candidate = await makeRecord(true);
      } catch {
        throw new DailyChallengeError(
          'unavailable',
          'Generation and its quality-approved reserve are unavailable'
        );
      }
    }
    await putIfAbsent(
      dailyChallengeKey(input.subredditId, input.day),
      'record',
      serializeDailyChallengeRecord(candidate)
    );
    // Never return a local losing candidate, even if the Redis write reported success.
    const winner = await read(input);
    if (!winner)
      throw new DailyChallengeError(
        'unavailable',
        'Daily challenge storage did not confirm an accepted record'
      );
    return winner;
  }
  async function bindPost(input: DailyPostInput): Promise<PostBinding> {
    validateSubredditId(input.subredditId);
    validatePostId(input.postId);
    const key = postBindingsKey(input.subredditId);
    const existing = await readField(key, input.postId);
    if (existing !== undefined) return parseBinding(decoded(existing), input);
    let post: TrustedChallengePost;
    try {
      post = await deps.getPost(input.postId);
    } catch {
      throw new DailyChallengeError(
        'unavailable',
        'The originating Reddit post creation date could not be loaded'
      );
    }
    if (
      post.id !== input.postId ||
      post.subredditId !== input.subredditId ||
      !Number.isSafeInteger(post.createdAtMs) ||
      post.createdAtMs < 0
    )
      throw new DailyChallengeError(
        'integrity',
        'Trusted post metadata does not match this installation'
      );
    let day: string;
    try {
      day = utcDay(post.createdAtMs);
    } catch {
      throw new DailyChallengeError(
        'integrity',
        'Trusted post creation date is invalid'
      );
    }
    const binding: PostBinding = {
      schemaVersion: 1,
      postId: input.postId,
      subredditId: input.subredditId,
      day,
      createdAtMs: post.createdAtMs,
    };
    await putIfAbsent(key, input.postId, JSON.stringify(binding));
    const stored = await readField(key, input.postId);
    if (stored === undefined)
      throw new DailyChallengeError(
        'unavailable',
        'Post binding storage did not confirm the originating day'
      );
    return parseBinding(decoded(stored), input);
  }
  async function getForPost(
    input: DailyPostInput
  ): Promise<DailyChallengeView> {
    const binding = await bindPost(input);
    const challenge = await getOrCreate({
      subredditId: binding.subredditId,
      day: binding.day,
    });
    return dailyChallengeView(challenge, now());
  }
  return { read, getOrCreate, bindPost, getForPost };
}
