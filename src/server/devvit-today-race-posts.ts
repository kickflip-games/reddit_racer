import { reddit, redis, type Post } from '@devvit/web/server';
import { DailyChallengeError } from '../shared/daily-challenge';
import { isRacePostId } from '../shared/today-race-post';
import type { DailyChallengeService } from './core/daily-challenges';
import {
  createTodayRacePostsService,
  type TrustedRacePost,
} from './core/today-race-posts';

type PostMetadata = Pick<
  Post,
  'id' | 'subredditId' | 'createdAt' | 'removed' | 'spam' | 'removedByCategory'
>;

/** Only explicit SDK absence is a missing post; an outage is not readiness. */
function missingPost(error: unknown, postId: string): boolean {
  if (error instanceof Error && error.message === `no post ${postId}`)
    return true;
  if (typeof error !== 'object' || error === null) return false;
  return (
    ('status' in error && error.status === 404) ||
    ('statusCode' in error && error.statusCode === 404) ||
    ('code' in error && error.code === 5)
  );
}

export async function readTrustedRacePost(
  postId: string,
  lookup: (postId: `t3_${string}`) => Promise<PostMetadata>
): Promise<TrustedRacePost | undefined> {
  if (!isRacePostId(postId))
    throw new DailyChallengeError(
      'integrity',
      'Stored Reddit post ID is invalid'
    );
  let post: PostMetadata;
  try {
    post = await lookup(postId);
  } catch (error) {
    if (missingPost(error, postId)) return undefined;
    throw error;
  }
  return {
    id: post.id,
    subredditId: post.subredditId,
    createdAtMs: post.createdAt.getTime(),
    available:
      !post.removed && !post.spam && post.removedByCategory !== 'deleted',
  };
}

/** Stored post IDs, rather than browser selectors, select this trusted lookup. */
export function createDevvitTodayRacePostsService(
  daily: Pick<DailyChallengeService, 'bindPost' | 'read'>,
  createdPost?: Post,
  lookup: (postId: `t3_${string}`) => Promise<Post> = (postId) =>
    reddit.getPostById(postId)
) {
  return createTodayRacePostsService({
    store: redis,
    daily,
    now: Date.now,
    getPost: (postId) =>
      readTrustedRacePost(postId, (trustedId) =>
        createdPost?.id === trustedId
          ? Promise.resolve(createdPost)
          : lookup(trustedId)
      ),
  });
}
