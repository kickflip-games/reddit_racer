import { context } from '@devvit/web/server';
import { createDevvitDailyService } from './devvit-daily';
import { createDevvitCompetitionService } from './devvit-competition';
import { createDevvitRankedService } from './devvit-ranked';
import type { RpcContext } from './trpc';

export function createDevvitRpcContext(): RpcContext {
  const { subredditId, postId } = context;
  const daily = createDevvitDailyService();
  const competition = createDevvitCompetitionService(daily);
  const ranked = createDevvitRankedService(daily, competition.commitVerified);
  return {
    getDailyChallenge: async () => {
      if (!subredditId || !postId)
        throw new Error('This request needs an installed subreddit and post.');
      return daily.getForPost({ subredditId, postId });
    },
    startRankedRace: () => ranked.start(),
    submitRun: (input) => ranked.submit(input),
    getLeaderboard: (input) => competition.getLeaderboard(input),
  };
}
