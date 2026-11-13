import { context, reddit } from '@devvit/web/server';
import { utcDay } from '../../shared/daily-challenge';
import { isRacePostId } from '../../shared/today-race-post';
import { createDevvitDailyPublicationService } from '../devvit-daily-publication';
import { readTrustedRacePost } from '../devvit-today-race-posts';
import type { DailyPublicationResult } from './daily-publication';
import type { DailyChallengeService } from './daily-challenges';
import type { TodayRacePostsService } from './today-race-posts';

type CreatedRacePost = {
  id: string;
  setPostData: (data: {
    challengeSchema: number;
    challengeDay: string;
    challengeHash: string;
  }) => Promise<void>;
};

/** Once Reddit created a post, optional metadata failure must not invite duplicates. */
export async function completeCreatedRacePost<T extends CreatedRacePost>(
  post: T,
  deps: {
    subredditId: string;
    daily: Pick<DailyChallengeService, 'getForPost'>;
    todayPosts: Pick<TodayRacePostsService, 'registerCreatedPost'>;
    warn: (message: string) => void;
  }
): Promise<T> {
  try {
    // Reddit's creation time wins even if midnight passed during submission.
    const input = { subredditId: deps.subredditId, postId: post.id };
    const bound = await deps.daily.getForPost(input);
    await post.setPostData({
      challengeSchema: bound.challenge.schemaVersion,
      challengeDay: bound.challenge.day,
      challengeHash: bound.challenge.challengeHash,
    });
    await deps.todayPosts.registerCreatedPost(input);
  } catch {
    deps.warn(
      'Race post was created, but its daily metadata or today link could not be completed. Opening the created post can retry registration.'
    );
  }
  return post;
}

/** Only an actually available current post can retain the pending-metadata fallback. */
export async function resolveCreatedRacePost(
  result: DailyPublicationResult,
  deps: {
    subredditId: string;
    now: () => number;
    lookup: Parameters<typeof readTrustedRacePost>[1];
  }
): Promise<{ id: string }> {
  const unavailable = () => new Error('The daily race post is not ready yet.');
  if (!isRacePostId(result.postId)) throw unavailable();
  if (result.status !== 'ready') {
    try {
      if (utcDay(deps.now()) !== result.day) throw unavailable();
      const post = await readTrustedRacePost(result.postId, deps.lookup);
      if (
        !post?.available ||
        post.id !== result.postId ||
        post.subredditId !== deps.subredditId ||
        utcDay(post.createdAtMs) !== result.day ||
        utcDay(deps.now()) !== result.day
      )
        throw unavailable();
    } catch {
      // A removed/missing post or failed lookup must not become navigation or
      // expose SDK error details. This helper never submits a replacement.
      throw unavailable();
    }
  }
  return { id: result.postId };
}

export const createPost = async () => {
  const { subredditId } = context;
  const result = await createDevvitDailyPublicationService().ensureToday();
  const post = await resolveCreatedRacePost(result, {
    subredditId,
    now: Date.now,
    lookup: (postId) => reddit.getPostById(postId),
  });
  if (result.status !== 'ready')
    console.warn(
      'A race post is already known, but completion or availability is unconfirmed. Returning its existing link without submitting another post.'
    );
  return post;
};
