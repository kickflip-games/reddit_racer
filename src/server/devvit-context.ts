import { context } from '@devvit/web/server';
import { createDevvitDailyService } from './devvit-daily';
import { createDevvitCompetitionService } from './devvit-competition';
import { createDevvitRankedService } from './devvit-ranked';
import { createDevvitTodayRacePostsService } from './devvit-today-race-posts';
import type { RpcContext } from './trpc';

export function createDevvitRpcContext(): RpcContext {
  const { subredditId, postId } = context;
  const daily = createDevvitDailyService();
  const competition = createDevvitCompetitionService(daily);
  const ranked = createDevvitRankedService(daily, competition.commitVerified);
  const todayPosts = createDevvitTodayRacePostsService(daily);
  return {
    getDailyChallenge: async () => {
      if (!subredditId || !postId)
        throw new Error('This request needs an installed subreddit and post.');
      const input = { subredditId, postId };
      const view = await daily.getForPost(input);
      if (view.isCurrent) {
        try {
          // Narrow legacy backfill: this already bound current app post only.
          await todayPosts.registerCreatedPost(input);
        } catch {
          console.warn(
            'The daily course loaded, but its optional today post link could not be registered.'
          );
        }
      }
      return view;
    },
    startRankedRace: () => ranked.start(),
    submitRun: (input) => ranked.submit(input),
    getLeaderboard: (input) => competition.getLeaderboard(input),
    todayRacePost: () => {
      if (!subredditId || !postId)
        throw new Error('This request needs an installed subreddit and post.');
      return todayPosts.getTodayPost({ subredditId });
    },
  };
}
