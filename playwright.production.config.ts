import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/production',
  timeout: 60000,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5210', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node scripts/serve-built.mjs',
    url: 'http://127.0.0.1:5210/game.html',
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
