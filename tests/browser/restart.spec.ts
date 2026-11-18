import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';

test('compact restart resets a moving practice lap without changing course @smoke', async ({
  page,
}, info) => {
  await page.clock.install();
  await page.setViewportSize(
    info.project.name === 'mobile-chromium'
      ? { width: 390, height: 600 }
      : { width: 960, height: 720 }
  );
  await page.goto('/game.html?practice=1&seed=practice-1');
  await expect(page.locator('#start-button')).toBeEnabled();
  await waitForSceneAssets(page);
  const race = page.locator('#race');
  const hash = await race.getAttribute('data-track-hash');
  const restart = page.getByRole('button', {
    name: 'Restart race',
    exact: true,
  });
  await expect(page.locator('#mode-label')).toBeHidden();
  await expect(restart).toBeHidden();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#start-button').click();
  await page.clock.runFor(20);
  await expect(restart).toBeVisible();
  const box = await restart.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await page.clock.runFor(3200);
  await expect(race).toHaveAttribute('data-phase', 'racing');
  await page.keyboard.down('Space');
  await page.clock.runFor(1200);
  await page.keyboard.up('Space');
  await expect(page.locator('#timer')).not.toHaveText('00.000');
  for (let i = 0; i < 2; i++) {
    if (info.project.name === 'mobile-chromium') await restart.tap();
    else {
      await restart.focus();
      await page.keyboard.press('Enter');
    }
    await page.clock.runFor(3100);
    await expect(race).toHaveAttribute('data-phase', 'racing');
    await expect(race).toHaveAttribute('data-track-hash', hash!);
    await expect(page.locator('#card')).toBeHidden();
    await expect(page.locator('#timer')).toHaveText(/^00\./);
  }
  await page.screenshot({
    path: test.info().outputPath('compact-restart.png'),
  });
});
