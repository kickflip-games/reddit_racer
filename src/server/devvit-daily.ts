import { context, reddit, redis, type Post } from '@devvit/web/server';
import { FALLBACK_CIRCUIT_SEED } from '../shared/circuit-generator';
import { generateValidatedCircuit } from '../shared/circuit-quality';
import { createDailyChallengeService } from './core/daily-challenges';
import type { RpcContext } from './trpc';
import { createDevvitRankedService } from './devvit-ranked';

/** Capture trusted request context; never accept a post ID or date from the browser. */
export function createDevvitDailyService(createdPost?: Post) {
  const trustedPostId = createdPost?.id ?? context.postId;
  return createDailyChallengeService({
    store: redis,
    now: Date.now,
    getPost: async (postId) => {
      if (!trustedPostId || postId !== trustedPostId)
        throw new Error('A trusted originating Reddit post is required.');
      const post = createdPost ?? (await reddit.getPostById(trustedPostId));
      return {
        id: post.id,
        subredditId: post.subredditId,
        createdAtMs: post.createdAt.getTime(),
      };
    },
    generate: (seed) => generateValidatedCircuit(seed),
    reserve: () =>
      generateValidatedCircuit(FALLBACK_CIRCUIT_SEED, {
        generator: { maxAttempts: 1 },
        maxQualityAttempts: 1,
      }),
  });
}

export function createDevvitRpcContext(): RpcContext {
  const { subredditId, postId } = context;
  const daily = createDevvitDailyService();
  const ranked = createDevvitRankedService(daily);
  return {
    getDailyChallenge: async () => {
      if (!subredditId || !postId)
        throw new Error('This request needs an installed subreddit and post.');
      return daily.getForPost({ subredditId, postId });
    },
    startRankedRace: () => ranked.start(),
    submitRun: (input) => ranked.submit(input),
  };
}
