import { expect, test } from '@playwright/test';

test('Daily Lap splash has consistent branding and a plain CTA @smoke', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/splash.html');
  await expect(page).toHaveTitle('The Daily Lap');
  await expect(page.locator('h1')).toHaveText('The DailyLap.');
  await expect(page.locator('#start-button')).toHaveText('Let’s race');
  await expect(
    page.locator('#start-button span, #start-button svg')
  ).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('Reddit Racer');
  expect(await page.locator('body').innerText()).not.toContain('↗');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: test.info().outputPath('daily-lap-splash.png'),
  });
});
