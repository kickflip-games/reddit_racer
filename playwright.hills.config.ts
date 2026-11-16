import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  testMatch:
    /(?:hills-feedback|word-courses|feedback-vfx|feedback-audio|replay)\.spec\.ts/,
  timeout: 120000,
  retries: 0,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5189' },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --config vite.local.config.ts --host 127.0.0.1 --port 5189',
    url: 'http://127.0.0.1:5189/game.html',
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 960, height: 720 },
      },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], deviceScaleFactor: 1 },
    },
  ],
});
