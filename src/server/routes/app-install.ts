import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';

export type AppInstallDependencies = {
  createPost: () => Promise<unknown>;
  reportError: () => void;
};

/** Mount under /internal/triggers; body metadata never supplies identity or scope. */
export function createAppInstallRouter(deps: AppInstallDependencies): Hono {
  const app = new Hono();
  app.post('/on-app-install', async (c) => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json<TriggerResponse>(
        { status: 'error', message: 'An app installation event is required.' },
        400
      );
    }
    if (
      typeof input !== 'object' ||
      input === null ||
      Array.isArray(input) ||
      !('type' in input) ||
      input.type !== 'AppInstall'
    )
      return c.json<TriggerResponse>(
        { status: 'error', message: 'An app installation event is required.' },
        400
      );
    try {
      // All SDK work is awaited before acknowledging a successful creation.
      await deps.createPost();
      return c.json<TriggerResponse>(
        { status: 'success', message: 'Race post created.' },
        200
      );
    } catch {
      // The reporter receives no request data or raw SDK error metadata.
      deps.reportError();
      return c.json<TriggerResponse>(
        { status: 'error', message: 'Race post creation is unavailable.' },
        500
      );
    }
  });
  return app;
}
