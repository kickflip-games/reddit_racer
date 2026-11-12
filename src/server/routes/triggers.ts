import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { createPost } from '../core/post';
import { runPrivateRedisSmoke } from '../diagnostics/redis-smoke';
import { createAppInstallRouter } from './app-install';

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

triggers.route(
  '/',
  createAppInstallRouter({
    createPost,
    reportError: () =>
      console.error('Race post creation failed during app installation.'),
  })
);
