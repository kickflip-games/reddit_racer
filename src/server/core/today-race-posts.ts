import {
  dailyChallengeId,
  DailyChallengeError,
  utcDay,
  utcDayWindow,
  validateSubredditId,
} from '../../shared/daily-challenge.ts';
import {
  canonicalRacePostUrl,
  isRacePostId,
  parseTodayRacePostView,
} from '../../shared/today-race-post.ts';
import type { TodayRacePostView } from '../../shared/today-race-post.ts';
import { parsePostBinding, postBindingsKey } from './daily-challenges.ts';
import type {
  DailyChallengeService,
  DailyChallengeStore,
  DailyPostInput,
} from './daily-challenges.ts';

export const MAX_TODAY_POST_READ_ATTEMPTS = 2;
export type TrustedRacePost = {
  id: string;
  subredditId: string;
  createdAtMs: number;
  available: boolean;
};
export type DailyRacePostPointer = {
  schemaVersion: 1;
  subredditId: string;
  day: string;
  postId: string;
  createdAtMs: number;
  challengeId: string;
  challengeHash: string;
};
export type TodayRacePostsDependencies = {
  store: DailyChallengeStore;
  daily: Pick<DailyChallengeService, 'bindPost' | 'read'>;
  now: () => number;
  getPost: (postId: string) => Promise<TrustedRacePost | undefined>;
};
export type TodayRacePostsService = {
  /** Trusted internal read; absence and an unavailable registered post differ. */
  readRegisteredPost: (input: {
    subredditId: string;
    day: string;
  }) => Promise<TrustedRacePost | undefined>;
  registerCreatedPost: (
    input: DailyPostInput
  ) => Promise<DailyRacePostPointer | null>;
  getTodayPost: (input: { subredditId: string }) => Promise<TodayRacePostView>;
};

/** Separate navigation metadata never changes a permanent post/day binding. */
export function dailyRacePostsKey(subredditId: string): string {
  validateSubredditId(subredditId);
  return `racer:daily-posts:${subredditId}`;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function decoded(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new DailyChallengeError('integrity', 'Stored race post is malformed');
  }
}
export function parseDailyRacePostPointer(
  value: unknown,
  expected: { subredditId: string; day: string }
): DailyRacePostPointer {
  const raw = typeof value === 'string' ? decoded(value) : value;
  if (!record(raw))
    throw new DailyChallengeError('integrity', 'Stored race post is malformed');
  if (raw.schemaVersion !== 1)
    throw new DailyChallengeError(
      'unsupported',
      'Stored race post schema is unsupported'
    );
  const fields = [
    'schemaVersion',
    'subredditId',
    'day',
    'postId',
    'createdAtMs',
    'challengeId',
    'challengeHash',
  ];
  if (
    Object.keys(raw).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(raw, key)) ||
    raw.subredditId !== expected.subredditId ||
    raw.day !== expected.day ||
    !isRacePostId(raw.postId) ||
    typeof raw.createdAtMs !== 'number' ||
    !Number.isSafeInteger(raw.createdAtMs) ||
    raw.createdAtMs < 0 ||
    raw.challengeId !== dailyChallengeId(expected.subredditId, expected.day) ||
    typeof raw.challengeHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(raw.challengeHash)
  )
    throw new DailyChallengeError(
      'integrity',
      'Stored race post does not match its daily installation'
    );
  try {
    if (utcDay(raw.createdAtMs) !== expected.day) throw new Error('day');
  } catch {
    throw new DailyChallengeError(
      'integrity',
      'Stored race post has an inconsistent creation date'
    );
  }
  return {
    schemaVersion: 1,
    subredditId: expected.subredditId,
    day: expected.day,
    postId: raw.postId,
    createdAtMs: raw.createdAtMs,
    challengeId: raw.challengeId,
    challengeHash: raw.challengeHash,
  };
}

export function createTodayRacePostsService(
  deps: TodayRacePostsDependencies
): TodayRacePostsService {
  function now(): number {
    try {
      const value = deps.now();
      utcDay(value);
      return value;
    } catch {
      throw new DailyChallengeError(
        'unavailable',
        'The UTC clock is unavailable'
      );
    }
  }
  async function storage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DailyChallengeError) throw error;
      throw new DailyChallengeError(
        'unavailable',
        'Today race post storage is temporarily unavailable'
      );
    }
  }
  async function trustedPost(
    postId: string,
    expected: { subredditId: string; day: string; createdAtMs: number }
  ): Promise<TrustedRacePost | undefined> {
    let post: TrustedRacePost | undefined;
    try {
      post = await deps.getPost(postId);
    } catch {
      throw new DailyChallengeError(
        'unavailable',
        'The Reddit race post could not be checked'
      );
    }
    if (!post) return undefined;
    if (
      post.id !== postId ||
      post.subredditId !== expected.subredditId ||
      post.createdAtMs !== expected.createdAtMs ||
      typeof post.available !== 'boolean' ||
      utcDay(post.createdAtMs) !== expected.day
    )
      throw new DailyChallengeError(
        'integrity',
        'Trusted race post metadata disagrees with its permanent binding'
      );
    return post;
  }
  async function validateStored(pointer: DailyRacePostPointer): Promise<void> {
    const input = { subredditId: pointer.subredditId, postId: pointer.postId };
    const rawBinding = await storage(() =>
      deps.store.hGet(postBindingsKey(pointer.subredditId), pointer.postId)
    );
    if (rawBinding === undefined)
      throw new DailyChallengeError(
        'integrity',
        'The advertised race post has no permanent binding'
      );
    const binding = parsePostBinding(decoded(rawBinding), input);
    const challenge = await storage(() =>
      deps.daily.read({ subredditId: pointer.subredditId, day: pointer.day })
    );
    if (
      binding.day !== pointer.day ||
      binding.createdAtMs !== pointer.createdAtMs ||
      !challenge ||
      challenge.subredditId !== pointer.subredditId ||
      challenge.day !== pointer.day ||
      challenge.id !== pointer.challengeId ||
      challenge.challengeHash !== pointer.challengeHash
    )
      throw new DailyChallengeError(
        'integrity',
        'The advertised race post disagrees with its immutable daily challenge'
      );
  }
  async function registerCreatedPost(
    input: DailyPostInput
  ): Promise<DailyRacePostPointer | null> {
    validateSubredditId(input.subredditId);
    if (!isRacePostId(input.postId))
      throw new DailyChallengeError(
        'invalid',
        'A trusted race post is required'
      );
    const binding = await storage(() => deps.daily.bindPost(input));
    const key = dailyRacePostsKey(input.subredditId);
    const existing = await storage(() => deps.store.hGet(key, binding.day));
    if (existing !== undefined) {
      const winner = parseDailyRacePostPointer(existing, {
        subredditId: input.subredditId,
        day: binding.day,
      });
      await validateStored(winner);
      return winner;
    }
    const post = await trustedPost(input.postId, {
      subredditId: input.subredditId,
      day: binding.day,
      createdAtMs: binding.createdAtMs,
    });
    if (!post?.available) return null;
    const challenge = await storage(() =>
      deps.daily.read({ subredditId: input.subredditId, day: binding.day })
    );
    if (!challenge)
      throw new DailyChallengeError(
        'integrity',
        'A race post must use an already persisted daily challenge'
      );
    const pointer: DailyRacePostPointer = {
      schemaVersion: 1,
      subredditId: input.subredditId,
      day: binding.day,
      postId: input.postId,
      createdAtMs: binding.createdAtMs,
      challengeId: challenge.id,
      challengeHash: challenge.challengeHash,
    };
    // Validate a candidate before it can claim the stable daily navigation slot.
    await validateStored(pointer);
    await storage(() =>
      deps.store.hSetNX(key, pointer.day, JSON.stringify(pointer))
    );
    const winnerRaw = await storage(() => deps.store.hGet(key, pointer.day));
    if (winnerRaw === undefined)
      throw new DailyChallengeError(
        'unavailable',
        'Today race post storage did not confirm an accepted pointer'
      );
    const winner = parseDailyRacePostPointer(winnerRaw, pointer);
    await validateStored(winner);
    return winner;
  }
  async function readRegisteredPost(input: {
    subredditId: string;
    day: string;
  }): Promise<TrustedRacePost | undefined> {
    utcDayWindow(input.day);
    const key = dailyRacePostsKey(input.subredditId);
    const raw = await storage(() => deps.store.hGet(key, input.day));
    if (raw === undefined) return undefined;
    const pointer = parseDailyRacePostPointer(raw, input);
    await validateStored(pointer);
    const found = await trustedPost(pointer.postId, pointer);
    return (
      found ?? {
        id: pointer.postId,
        subredditId: pointer.subredditId,
        createdAtMs: pointer.createdAtMs,
        available: false,
      }
    );
  }
  async function getTodayPost(input: {
    subredditId: string;
  }): Promise<TodayRacePostView> {
    for (let attempt = 0; attempt < MAX_TODAY_POST_READ_ATTEMPTS; attempt++) {
      const day = utcDay(now());
      const post = await readRegisteredPost({
        subredditId: input.subredditId,
        day,
      });
      let link: TodayRacePostView['post'] = null;
      if (post?.available)
        link = {
          postId: post.id,
          url: canonicalRacePostUrl(post.id),
        };
      const serverNowMs = now();
      if (utcDay(serverNowMs) !== day) continue;
      return parseTodayRacePostView({
        schemaVersion: 1,
        currentDay: day,
        serverNowMs,
        nextResetAtMs: utcDayWindow(day).endsAtMs,
        status: link ? 'ready' : 'not-ready',
        post: link,
      });
    }
    throw new DailyChallengeError(
      'unavailable',
      'The UTC day changed while loading today’s race; refresh to try again'
    );
  }
  return { registerCreatedPost, getTodayPost, readRegisteredPost };
}
