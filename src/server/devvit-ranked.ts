import { context, redis } from '@devvit/web/server';
import { RankedRaceError } from '../shared/ranked-race';
import type { DailyChallengeService } from './core/daily-challenges';
import {
  createRankedRaceService,
  type RankedStore,
  type RankedRaceServiceDependencies,
} from './core/ranked-races';
import {
  consumeRaceBudget,
  type RaceBudgetStore,
} from './core/race-rate-limit';

const store: RankedStore & RaceBudgetStore = {
  get: (key) => redis.get(key),
  setNX: async (key, value, expiresAtMs) => {
    const result = await redis.set(key, value, {
      nx: true,
      expiration: new Date(expiresAtMs),
    });
    if (result === 'OK') return true;
    if (result === '') return false;
    throw new RankedRaceError(
      'unavailable',
      'The race write was not confirmed.'
    );
  },
  incrBy: (key, increment) => redis.incrBy(key, increment),
};

/** Identity comes exclusively from Devvit's request-local authenticated context. */
export function createDevvitRankedService(
  daily: DailyChallengeService,
  commitVerified: RankedRaceServiceDependencies['commitVerified']
) {
  const { userId, subredditId, postId } = context;
  return createRankedRaceService({
    context: {
      ...(userId ? { userId } : {}),
      subredditId: subredditId ?? '',
      postId: postId ?? '',
    },
    store,
    daily,
    now: Date.now,
    newSessionId: () => globalThis.crypto.randomUUID(),
    consumeStartBudget: async (trusted) => {
      if (!trusted.userId)
        throw new RankedRaceError('unauthenticated', 'Sign in to race ranked.');
      await consumeRaceBudget({
        store,
        nowMs: Date.now(),
        subredditId: trusted.subredditId,
        userId: trusted.userId,
        operation: 'start',
      });
    },
    consumeVerifyBudget: async (trusted) => {
      if (!trusted.userId)
        throw new RankedRaceError('unauthenticated', 'Sign in to race ranked.');
      await consumeRaceBudget({
        store,
        nowMs: Date.now(),
        subredditId: trusted.subredditId,
        userId: trusted.userId,
        operation: 'verify',
      });
    },
    commitVerified,
  });
}
