import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { canonicalRacePostUrl } from '../../shared/today-race-post';
import { createPost } from '../core/post';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();

    return c.json<UiResponse>(
      {
        navigateTo: canonicalRacePostUrl(post.id),
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: 'Failed to create post',
      },
      400
    );
  }
});
