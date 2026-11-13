import { test, expect } from '@playwright/test';
import { openPracticeModes } from './scene-ready.ts';

test('stunt circuit renders and a held launch flies across the gap', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/game.html?stunt=1');
  await expect(page.locator('#card-title')).toHaveText('');
  await expect(page.locator('#start-button')).toBeEnabled();
  await page.screenshot({
    path: `test-results/stunt-circuit-${testInfo.project.name}.png`,
  });
  await page.locator('#start-button').click();
  await page.locator('#race-canvas').focus();
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveAttribute(
    'data-condition',
    'airborne',
    { timeout: 20000 }
  );
  await page.screenshot({
    path: `test-results/stunt-jump-${testInfo.project.name}.png`,
  });
  await expect(page.locator('#status')).not.toHaveAttribute(
    'data-condition',
    'airborne',
    { timeout: 10000 }
  );
  await page.keyboard.up('Space');
  expect(errors).toEqual([]);
});

test('stunt circuit is selectable from the normal game', async ({ page }) => {
  await page.goto('/game.html');
  await expect(page.locator('#start-button')).toBeEnabled();
  await openPracticeModes(page);
  await page.locator('#stunt-button').click();
  await expect(page.locator('#card-title')).toHaveText('');
  await expect(page.locator('#race')).toHaveAttribute(
    'data-play-mode',
    'stunt'
  );
});
