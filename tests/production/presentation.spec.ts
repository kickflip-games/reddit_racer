import { expect, test } from '@playwright/test';

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 412, height: 839 },
  { width: 1280, height: 800 },
  { width: 640, height: 360 },
]) {
  test(`built home keeps the car clear and one primary action at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    await page.clock.install();
    await page.route('**/api/trpc/**', (route) =>
      route.fulfill({ status: 503, json: { error: 'local presentation test' } })
    );
    await page.goto('/game.html?practice=1&word=banana');
    await expect(page.locator('#race')).toHaveAttribute(
      'data-car-load',
      'ready'
    );
    await expect(page.locator('#start-label')).toHaveText('Start practice');
    await expect(page.locator('#home-mode')).toHaveText('Practice');
    await expect(page.locator('.timing')).toBeHidden();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.clock.runFor(500);
    const card = page.locator('#card'),
      bounds = await card.boundingBox();
    if (!bounds) throw new Error('Missing visible home');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(14);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(height - 58);
    expect(
      await card.evaluate((el) => el.scrollHeight - el.clientHeight)
    ).toBeLessThanOrEqual(1);
    await expect(card).toHaveCSS('border-radius', '0px');
    await expect(card).toHaveCSS('box-shadow', 'none');
    await expect(page.locator('.start-wordmark')).toHaveCSS(
      'font-style',
      'normal'
    );
    const pose = await page
      .locator('#race')
      .evaluate((el) =>
        JSON.parse(el.getAttribute('data-preview-pose') ?? '{}')
      );
    expect(
      pose.screenX > bounds.x + bounds.width + 8 || pose.screenY < bounds.y - 8
    ).toBe(true);
    const secondary = page.locator('.home-secondary button:visible');
    for (let i = 0; i < (await secondary.count()); i++) {
      await expect(secondary.nth(i)).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)'
      );
      const box = await secondary.nth(i).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath('home-presentation.png') });
    await page.locator('#race-settings > summary').click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await page.clock.runFor(100);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-preview',
      'paused'
    );
    await page.locator('#settings-close').click();
    await expect(page.locator('#race-settings > summary')).toBeFocused();
  });
}
