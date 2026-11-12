import { context, reddit } from '@devvit/web/server';
import { RankedRaceError } from '../shared/ranked-race';
import { createCompetitionService } from './core/competition';
import type { DailyChallengeService } from './core/daily-challenges';
import { createCompetitionStore } from './competition-store';

/** Competition writes are reachable only through verified server receipts. */
export function createDevvitCompetitionService(daily: DailyChallengeService) {
  const { userId, subredditId, postId } = context;
  return createCompetitionService({
    context: {
      ...(userId ? { userId } : {}),
      subredditId: subredditId ?? '',
      postId: postId ?? '',
    },
    daily,
    store: createCompetitionStore(),
    now: Date.now,
    getUsername: async (requestedUserId) => {
      if (!userId || requestedUserId !== userId)
        throw new RankedRaceError(
          'forbidden',
          'The racer account could not be confirmed.'
        );
      const username = await reddit.getCurrentUsername();
      if (!username)
        throw new RankedRaceError(
          'unavailable',
          'Your Reddit name could not be confirmed.'
        );
      return username;
    },
  });
}
