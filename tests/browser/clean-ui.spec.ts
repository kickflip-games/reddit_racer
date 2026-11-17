import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

for (const [width, height] of [
  [320, 480],
  [640, 360],
  [960, 720],
]) {
  test(`compact menus stay clear of HUD and settings at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto('/game.html?practice=1&seed=practice-1');
    await waitForSceneAssets(page);
    const card = page.locator('#card');
    expect(
      await card.evaluate((e) => getComputedStyle(e).borderTopRightRadius)
    ).toBe('4px');
    expect(
      await card.evaluate((e) => e.scrollHeight - e.clientHeight)
    ).toBeLessThanOrEqual(1);
    const box = (await card.boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - width! / 2)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - height! / 2)).toBeLessThan(2);
    for (const id of [
      '#start-button',
      '#word-course-open',
      '#daily-history-open',
    ]) {
      await expect(page.locator(id)).toBeInViewport();
      expect(
        await page
          .locator(id)
          .evaluate((e) => getComputedStyle(e).backgroundColor)
      ).toBe('rgb(199, 68, 37)');
    }
    await expect(card.locator('svg')).toHaveCount(0);
    expect(await card.innerText()).not.toMatch(/[↗←→]/);
    for (const selector of ['.timing', '#race-settings > summary']) {
      const control = (await page.locator(selector).boundingBox())!;
      expect(
        box.x >= control.x + control.width ||
          box.x + box.width <= control.x ||
          box.y >= control.y + control.height ||
          box.y + box.height <= control.y
      ).toBeTruthy();
    }
    await page.locator('#race-settings > summary').click();
    const dialog = page.locator('#settings-dialog');
    expect(
      await dialog.evaluate((e) => e.scrollWidth - e.clientWidth)
    ).toBeLessThanOrEqual(1);
    await page.locator('#daily-mode-button').scrollIntoViewIfNeeded();
    await expect(page.locator('#daily-mode-button')).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(card).toBeVisible();
    await page.locator('#start-button').click();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('#card-title')).toHaveText('Race interrupted.');
    await expect(page.locator('#card-copy')).toBeEmpty();
    await expect(page.locator('#retry-button')).toBeInViewport();
    expect(
      await page
        .locator('#retry-button')
        .evaluate((e) => getComputedStyle(e).backgroundColor)
    ).toBe('rgb(199, 68, 37)');
    await page.screenshot({
      path: test.info().outputPath('minimal-interrupted.png'),
    });
  });
}
