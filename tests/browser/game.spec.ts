import { test, expect } from '@playwright/test';

test('local racer renders, accelerates, brakes, completes and retries', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.clock.install();
  await page.goto('/game.html');
  await expect(page.locator('#mode-label')).toContainText('UNRANKED');
  await expect(page.locator('#race-canvas')).toBeVisible();
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(1000);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  const acceleratingSpeed = Number(await page.locator('#speed').textContent());
  expect(acceleratingSpeed).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await page.clock.runFor(500);
  expect(Number(await page.locator('#speed').textContent())).toBeLessThan(
    acceleratingSpeed
  );
  await page.keyboard.down('Space');
  await page.clock.runFor(20000);
  await expect(page.locator('#retry-button')).toBeVisible();
  await page.keyboard.up('Space');
  await page.screenshot({
    path: `test-results/foundation-${test.info().project.name}.png`,
  });
  await page.locator('#retry-button').click();
  await page.clock.runFor(32);
  expect(Number(await page.locator('#timer').textContent())).toBeLessThan(0.5);
  await expect(page.locator('#speed')).toHaveText('0');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  expect(errors).toEqual([]);
});
