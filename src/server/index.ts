import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';
import { createApiApp } from './app';
import { createDevvitRpcContext } from './devvit-context';
import { createDailySchedulerRouter } from './routes/daily-scheduler';
import { createDevvitDailyPublicationService } from './devvit-daily-publication';

const app = createApiApp(createDevvitRpcContext);
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/triggers', triggers);
internal.route(
  '/scheduler',
  createDailySchedulerRouter({
    ensure: () => createDevvitDailyPublicationService().ensureToday(),
    reportResult: (result) =>
      console.info('DAILY_RACE_SCHEDULED', JSON.stringify(result)),
    reportError: () =>
      console.error('The scheduled daily race check could not complete.'),
  })
);

app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
