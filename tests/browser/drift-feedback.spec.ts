import { test, expect } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';
test('real drift shows cool sparks then a release cue and clears immediately', async ({
  page,
}, info) => {
  await page.clock.install();
  await page.goto('/game.html?practice=1&seed=showcase-3');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(4200);
  await page.keyboard.down('Shift');
  await page.clock.runFor(300);
  await expect(page.locator('.drift-cue')).toHaveText('DRIFT');
  await expect(page.locator('.drift-cue')).toBeVisible();
  await page.screenshot({ path: info.outputPath('drift-cool.png') });
  await page.clock.runFor(450);
  await expect(page.locator('.drift-cue')).toHaveText('RELEASE');
  await page.screenshot({ path: info.outputPath('drift-release.png') });
  await page.keyboard.up('Shift');
  await page.clock.runFor(50);
  await expect(page.locator('.drift-cue')).toBeHidden();
  await page.keyboard.up('Space');
});
