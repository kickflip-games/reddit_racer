import { context, reddit } from '@devvit/web/server';
import { utcDay } from '../../shared/daily-challenge';
import { createDevvitDailyService } from '../devvit-daily';
import { createDevvitTodayRacePostsService } from '../devvit-today-race-posts';
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

export const createPost = async () => {
  const { subredditId } = context;
  if (!subredditId)
    throw new Error('A subreddit is required to create a race.');
  const daily = createDevvitDailyService();
  const prepared = await daily.getOrCreate({
    subredditId,
    day: utcDay(Date.now()),
  });
  const post = await reddit.submitCustomPost({
    title: 'Reddit Racer · Daily time attack',
    entry: 'default',
    postData: {
      challengeSchema: prepared.schemaVersion,
      challengeDay: prepared.day,
      challengeHash: prepared.challengeHash,
    },
  });
  const boundDaily = createDevvitDailyService(post);
  return completeCreatedRacePost(post, {
    subredditId,
    daily: boundDaily,
    todayPosts: createDevvitTodayRacePostsService(boundDaily, post),
    warn: (message) => console.warn(message),
  });
};
