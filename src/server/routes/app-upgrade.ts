import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';

export type AppUpgradePublication = { status: string; postId: string | null };
export type AppUpgradeDependencies = {
  ensure: () => Promise<AppUpgradePublication>;
  reportPublication: (result: AppUpgradePublication) => void;
  reportError: () => void;
};

/** The publication adapter validates live private SDK scope before any write. */
export function createAppUpgradeRouter(deps: AppUpgradeDependencies): Hono {
  const app = new Hono();
  app.post('/on-app-upgrade', async (c) => {
    c.header('Cache-Control', 'no-store');
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json<TriggerResponse>(
        { status: 'error', message: 'An app upgrade event is required.' },
        400
      );
    }
    if (
      typeof input !== 'object' ||
      input === null ||
      Array.isArray(input) ||
      !('type' in input) ||
      input.type !== 'AppUpgrade'
    )
      return c.json<TriggerResponse>(
        { status: 'error', message: 'An app upgrade event is required.' },
        400
      );
    try {
      const publication = await deps.ensure();
      try {
        deps.reportPublication(publication);
      } catch {
        // Publication has already settled; a logger cannot reverse the side effect.
      }
      return c.json<TriggerResponse>(
        {
          status: 'success',
          message: `Daily race publication: ${publication.status}.`,
        },
        200
      );
    } catch {
      try {
        deps.reportError();
      } catch {
        // Preserve the fixed safe response even when diagnostics are unavailable.
      }
      return c.json<TriggerResponse>(
        { status: 'error', message: 'App upgrade could not complete.' },
        500
      );
    }
  });
  return app;
}
