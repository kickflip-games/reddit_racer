import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

test('toon scenery remains readable on the real racing canvas', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
  await page.goto('/game.html?practice=1&seed=practice-1');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.clock.runFor(3600);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await page.screenshot({
    path: `test-results/toon-${process.env.TOON_CAPTURE ?? 'strong'}-${info.project.name}.png`,
  });
  expect(errors).toEqual([]);
});
