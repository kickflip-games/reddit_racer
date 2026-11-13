import { context, reddit, redis, type Post } from '@devvit/web/server';
import {
  generateElevatedCircuit,
  ELEVATED_RESERVE_SEED,
} from '../shared/elevated-generator';
import { createDailyChallengeService } from './core/daily-challenges';

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
    generate: (seed) => generateElevatedCircuit(seed),
    reserve: () =>
      generateElevatedCircuit(ELEVATED_RESERVE_SEED, { maxAttempts: 1 }),
  });
}
