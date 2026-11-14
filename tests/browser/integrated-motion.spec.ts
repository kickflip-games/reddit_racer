import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

test('OS reduced motion suppresses integrated speed feedback without hiding the car', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/game.html?practice=1&seed=practice-1');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-reduced-motion',
    'true'
  );
  await expect(page.locator('#start-button')).toBeEnabled();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(8000);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  expect(
    await page
      .locator('#race')
      .evaluate((e) => e.style.getPropertyValue('--speed-cue'))
  ).toBe('0');
  expect(
    await page
      .locator('#race')
      .evaluate((e) => getComputedStyle(e, '::after').display)
  ).toBe('none');
  await page.keyboard.up('Space');
});
