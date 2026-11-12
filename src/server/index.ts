import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { createApiApp } from './app';
import { createDevvitRpcContext } from './devvit-daily';

const app = createApiApp(createDevvitRpcContext);
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/triggers', triggers);

app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
