import { Hono } from 'hono';
import { createPost } from '../core/post';
import { createAppInstallRouter } from './app-install';
import { createAppUpgradeRouter } from './app-upgrade';
import { createDevvitDailyPublicationService } from '../devvit-daily-publication';

export const triggers = new Hono();

triggers.route(
  '/',
  createAppUpgradeRouter({
    ensure: () => createDevvitDailyPublicationService().ensureToday(),
    reportPublication: (result) =>
      console.info('DAILY_RACE_BOOTSTRAP', JSON.stringify(result)),
    reportError: () =>
      console.error('Private app upgrade initialization could not complete.'),
  })
);

triggers.route(
  '/',
  createAppInstallRouter({
    createPost,
    reportError: () =>
      console.error('Race post creation failed during app installation.'),
  })
);
