import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 120_000,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:5173', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run dev:local -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173/game.html',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: '**/touch.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 960, height: 720 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'webkit-replay',
      testMatch: '**/replay.spec.ts',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chromium',
      testIgnore: '**/gallery-batch.spec.ts',
      use: { ...devices['Pixel 7'], deviceScaleFactor: 1 },
    },
  ],
});
