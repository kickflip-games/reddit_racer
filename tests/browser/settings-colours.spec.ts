import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

for (const [width, height] of [
  [360, 640],
  [960, 720],
]) {
  test(`settings share the menu palette at ${width}x${height} @smoke`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto('/game.html?practice=1&seed=practice-1');
    await waitForSceneAssets(page);
    const colours = await page.locator('#start-button').evaluate((button) => ({
      background: getComputedStyle(button).backgroundColor,
      text: getComputedStyle(button).color,
    }));
    const surface = await page
      .locator('#card')
      .evaluate((card) => getComputedStyle(card).backgroundColor);
    const dialog = page.locator('#settings-dialog');
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.locator('#race-settings > summary').click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveCSS('background-color', surface);
      for (const button of await dialog.locator('button:visible').all()) {
        await expect(button).toHaveCSS('background-color', colours.background);
        await expect(button).toHaveCSS('color', colours.text);
      }
      await page.locator('#ghost-toggle').click();
      await expect(page.locator('#ghost-toggle')).toHaveCSS(
        'background-color',
        colours.background
      );
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth - element.clientWidth
        )
      ).toBeLessThanOrEqual(1);
      if (repeat === 0) {
        await page.screenshot({
          path: test.info().outputPath('settings-colours.png'),
        });
        await page.keyboard.press('Escape');
      } else {
        await page.locator('#settings-close').click();
      }
      await expect(dialog).toBeHidden();
      await expect(page.locator('#card')).toBeVisible();
    }
  });
}
