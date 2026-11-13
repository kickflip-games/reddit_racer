import { test, expect } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';
for (const [name, width, height] of [
  ['portrait', 412, 839],
  ['small', 320, 568],
  ['desktop', 1280, 800],
  ['landscape', 640, 360],
] satisfies [string, number, number][]) {
  test(`visual refresh: ${name} entry, options, result and persistent practice best`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
    await page.goto('/game.html');
    await waitForSceneAssets(page);
    await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
    await expect(page.locator('#start-label')).toHaveText('Start');
    await expect(page.locator('#practice-button')).toBeHidden();
    await page.screenshot({
      path: `docs/screenshots/visual-refresh/${name}-ready-${info.project.name}.png`,
    });
    await page.locator('#race-settings > summary').click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(page.locator('#card')).toBeHidden();
    await expect(page.locator('#settings-close')).toBeFocused();
    await page.screenshot({
      path: `docs/screenshots/visual-refresh/${name}-settings-${info.project.name}.png`,
    });
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-dialog')).toBeHidden();
    await expect(page.locator('#race-settings > summary')).toBeFocused();
    await page.locator('#start-button').click();
    await page.keyboard.down('Space');
    await page.clock.runFor(25000);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'finished'
    );
    await expect(page.locator('#finish-time')).toBeVisible();
    await expect(page.locator('#practice-result')).toContainText('Best');
    const value = await page.locator('#finish-value').textContent();
    expect(Number(value)).toBeGreaterThan(0);
    const button = await page.locator('#retry-button').boundingBox();
    expect(button).toBeTruthy();
    expect(button!.y + button!.height).toBeLessThanOrEqual(height);
    await page.screenshot({
      path: `docs/screenshots/visual-refresh/${name}-results-${info.project.name}.png`,
    });
    await page.keyboard.up('Space');
    await page.reload();
    await waitForSceneAssets(page);
    await expect(page.locator('#practice-result')).toContainText(
      `Best ${value}`
    );
    expect(errors).toEqual([]);
  });
}
test('continuous practice displays last and best laps while driving and retains them per course', async ({
  page,
}, info) => {
  await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
  await page.goto('/game.html?practice=1&seed=practice-1');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(85000);
  expect(
    Number(await page.locator('#race').getAttribute('data-practice-laps'))
  ).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#practice-best-lap')).toBeVisible();
  await expect(page.locator('#practice-last-lap')).toBeVisible();
  const best = await page.locator('#practice-best-lap').textContent();
  expect(best).toContain('Best');
  await page.screenshot({
    path: `docs/screenshots/visual-refresh/practice-best-${info.project.name}.png`,
  });
  await page.keyboard.up('Space');
  await page.reload();
  await waitForSceneAssets(page);
  await expect(page.locator('#practice-result')).toContainText('Best');
});
