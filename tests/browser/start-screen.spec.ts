import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';

for (const [width, height] of [
  [960, 720],
  [390, 600],
  [320, 480],
  [640, 360],
]) {
  test(`start placard fits ${width}x${height} and starts the real race`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.clock.install();
    await page.goto('/game.html?practice=1&seed=practice-1');
    await waitForSceneAssets(page);
    const card = page.locator('#card');
    await expect(page.locator('#start-button')).toBeEnabled();
    await expect(page.locator('.start-identity')).toBeVisible();
    await expect(page.locator('.start-controls')).toContainText('Release');
    const bounds = await card.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(60);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height!);
    expect(
      await card.evaluate((e) => e.scrollHeight - e.clientHeight)
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('start-screen.png') });
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator('#start-button').click();
    await page.clock.runFor(3200);
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
    await expect(card).toBeHidden();
  });
}
