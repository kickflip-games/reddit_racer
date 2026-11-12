import { createTRPCClient, httpLink } from '@trpc/client';
import type { AppRouter } from '../server/trpc';

export const api = createTRPCClient<AppRouter>({
  links: [httpLink({ url: '/api/trpc' })],
});
