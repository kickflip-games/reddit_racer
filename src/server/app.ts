import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, type RpcContext } from './trpc';

export const MAX_RPC_BODY_BYTES = 128 * 1024;

/** The same HTTP adapter is exercised by tests and mounted by Devvit. */
export function createApiApp(createContext: () => RpcContext): Hono {
  const app = new Hono();
  app.use(
    '/api/trpc/*',
    bodyLimit({
      maxSize: MAX_RPC_BODY_BYTES,
      onError: (c) => c.json({ error: 'The race request is too large.' }, 413),
    })
  );
  app.all('/api/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext,
      allowBatching: false,
      maxBatchSize: 1,
      responseMeta: () => ({ headers: { 'Cache-Control': 'no-store' } }),
    })
  );
  return app;
}
