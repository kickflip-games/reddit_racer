import { test, expect } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';

test('local racer renders, accelerates, brakes, completes and retries', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
  await expect(page.locator('#mode-label')).toContainText('Practice');
  await expect(page.locator('#race-canvas')).toBeVisible();
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await page.keyboard.down('Space');
  await page.clock.runFor(1000);
  await expect(page.locator('#timer')).toHaveText('00.000');
  await expect(page.locator('#speed')).toHaveText('0');
  await expect(page.locator('#race-countdown')).toBeVisible();
  await page.screenshot({
    path: `test-results/lap-countdown-${test.info().project.name}.png`,
  });
  await page.clock.runFor(3100);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  const acceleratingSpeed = Number(await page.locator('#speed').textContent());
  expect(acceleratingSpeed).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await page.clock.runFor(500);
  expect(Number(await page.locator('#speed').textContent())).toBeLessThan(
    acceleratingSpeed
  );
  await page.keyboard.down('Space');
  await page.clock.runFor(9000);
  await page.screenshot({
    path: `test-results/fixed-step-${test.info().project.name}.png`,
  });
  await page.clock.runFor(11000);
  await expect(page.locator('#retry-button')).toBeVisible();
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'finished');
  await expect(page.locator('#lap-progress-label')).toContainText('100%');
  expect(
    await page
      .locator('#lap-progress')
      .evaluate((node) =>
        node instanceof HTMLProgressElement ? node.value / node.max : 0
      )
  ).toBe(1);
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

test('focus loss and long frame gaps visibly interrupt and allow a fresh retry', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.clock.runFor(3100);
  await page.keyboard.down('Space');
  await page.clock.runFor(200);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#card-title')).toHaveText('Race interrupted.');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await page.keyboard.up('Space');
  await page.locator('#retry-button').click();
  await page.clock.fastForward(1000);
  await expect(page.locator('#card-title')).toHaveText('Race interrupted.');
  await expect(page.locator('#retry-button')).toBeVisible();
});
