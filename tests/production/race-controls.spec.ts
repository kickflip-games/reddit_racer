import { expect, test } from '@playwright/test';

for (const layout of [
  { width: 320, height: 568, host: 320 },
  { width: 360, height: 720, host: 360 },
  { width: 390, height: 844, host: 390 },
  { width: 960, height: 720, host: 960 },
  { width: 640, height: 360, host: 640 },
  { width: 320, height: 568, host: 960 },
]) {
  test(`built icon controls and top-right minimap stay clear at ${layout.width}x${layout.height} in ${layout.host}px host`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: layout.host, height: layout.height });
    await page.clock.install();
    await page.route('**/api/trpc/**', (route) =>
      route.fulfill({
        status: 503,
        json: { error: 'local production layout test' },
      })
    );
    await page.goto('/game.html?practice=1&word=banana');
    await expect(page.locator('#race')).toHaveAttribute(
      'data-car-load',
      'ready'
    );
    if (layout.width !== layout.host) {
      await page.addStyleTag({
        content: `#race { width: ${layout.width}px; }`,
      });
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    }
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator('#start-button').click();
    await page.clock.runFor(3300);
    const restart = page.getByRole('button', {
      name: 'Restart race',
      exact: true,
    });
    const settings = page.locator('#race-settings > summary');
    await expect(settings).toHaveAccessibleName('Settings');
    for (const control of [restart, settings]) {
      await expect(control).toHaveText('');
      await expect(control.locator('svg')).toHaveCount(1);
      await expect(control.locator('svg')).toHaveAttribute(
        'aria-hidden',
        'true'
      );
      await expect(control.locator('svg')).toHaveAttribute(
        'focusable',
        'false'
      );
      const style = await control.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        color: getComputedStyle(el).color,
        stroke: getComputedStyle(el.querySelector('svg')!).stroke,
      }));
      expect(style.width).toBeGreaterThanOrEqual(44);
      expect(style.height).toBeGreaterThanOrEqual(44);
      expect(style.stroke).toBe(style.color);
    }
    const map = page.locator('#circuit-minimap');
    await expect(map).toBeVisible();
    const bounds = await map.boundingBox(),
      r = await restart.boundingBox(),
      s = await settings.boundingBox(),
      timer = await page.locator('.timing').boundingBox();
    if (!bounds || !r || !s || !timer)
      throw new Error('Missing game control bounds');
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(layout.width - 13);
    expect(bounds.y).toBeGreaterThanOrEqual(r.y + r.height + 8);
    expect(bounds.y).toBeLessThan(layout.height / 2);
    expect(bounds.x).toBeGreaterThan(timer.x + timer.width + 8);
    expect(bounds.y + bounds.height).toBeLessThan(s.y);
    for (const point of [
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      { x: layout.width * 0.85, y: layout.height * 0.85 },
    ])
      expect(
        await page.evaluate(
          (p) => document.elementFromPoint(p.x, p.y)?.id,
          point
        )
      ).toBe('race-canvas');
    await page.screenshot({
      path: info.outputPath('updated-race-controls.png'),
    });
    await settings.click();
    await expect(
      page.getByRole('dialog', { name: 'Settings', exact: true })
    ).toBeVisible();
    await expect(map).toBeHidden();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(settings).toBeFocused();
    await restart.click();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'countdown'
    );
  });
}
