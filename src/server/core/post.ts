import { context, reddit } from '@devvit/web/server';
import { utcDay } from '../../shared/daily-challenge';
import { createDevvitDailyService } from '../devvit-daily';

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
  // Reddit's creation time wins even if midnight passed while creating the post.
  const bound = await createDevvitDailyService(post).getForPost({
    subredditId,
    postId: post.id,
  });
  await post.setPostData({
    challengeSchema: bound.challenge.schemaVersion,
    challengeDay: bound.challenge.day,
    challengeHash: bound.challenge.challengeHash,
  });
  return post;
};
