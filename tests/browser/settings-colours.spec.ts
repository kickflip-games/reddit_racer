import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

function channels(colour: string): number[] {
  return (colour.match(/[\d.]+/g) ?? []).map(Number);
}

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
    const surface = await page.locator('#card').evaluate((card) => ({
      background: getComputedStyle(card).backgroundColor,
      text: getComputedStyle(card).color,
    }));
    const dialog = page.locator('#settings-dialog');
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.locator('#race-settings > summary').click();
      await expect(dialog).toBeVisible();
      const paper = channels(
        await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)
      );
      expect(paper.slice(0, 3)).toEqual(
        channels(surface.background).slice(0, 3)
      );
      expect(paper[3] ?? 1).toBeGreaterThanOrEqual(0.9);
      const load = dialog.locator('#word-course-submit');
      await expect(load).toHaveCSS('background-color', colours.background);
      await expect(load).toHaveCSS('color', colours.text);
      const quiet = dialog.locator(
        '#settings-close:visible, #sound-toggle:visible, #ghost-toggle:visible, .track-secondary button:visible'
      );
      for (const button of await quiet.all()) {
        await expect(button).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        await expect(button).toHaveCSS('color', surface.text);
        const bounds = await button.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      await page.locator('#ghost-toggle').click();
      await expect(page.locator('#ghost-toggle')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)'
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
