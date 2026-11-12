import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post';
import { runPrivateRedisSmoke } from '../diagnostics/redis-smoke';

export const triggers = new Hono();

triggers.post('/on-app-upgrade', async (c) => {
  try {
    const input: unknown = await c.req.json();
    if (
      typeof input !== 'object' ||
      input === null ||
      !('type' in input) ||
      input.type !== 'AppUpgrade'
    )
      return c.json<TriggerResponse>(
        { status: 'error', message: 'An app upgrade event is required.' },
        400
      );
    const result = await runPrivateRedisSmoke();
    console.info('PRIVATE_REDIS_SMOKE', JSON.stringify(result));
    return c.json<TriggerResponse>({
      status: result.status === 'failed' ? 'error' : 'success',
      message: `Private storage diagnostic: ${result.status}.`,
    });
  } catch {
    console.error('Private storage diagnostic could not complete.');
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Private storage diagnostic could not complete.',
      },
      500
    );
  }
});

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = await c.req.json<OnAppInstallRequest>();

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Post created in subreddit ${context.subredditName} with id ${post.id} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>(
      {
        status: 'error',
        message: 'Failed to create post',
      },
      400
    );
  }
});
