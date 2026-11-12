import { Hono } from 'hono';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, type RpcContext } from './trpc';

/** The same HTTP adapter is exercised by tests and mounted by Devvit. */
export function createApiApp(createContext: () => RpcContext): Hono {
  const app = new Hono();
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
