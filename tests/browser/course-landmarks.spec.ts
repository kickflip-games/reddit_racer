import { test, expect } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';
for (const seed of ['landmarks-0', 'landmarks-1', 'landmarks-2']) {
  test(`scenic course ${seed} loads with unchanged driving controls`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/game.html?practice=1&seed=${seed}`);
    await waitForSceneAssets(page);
    await expect(page.locator('#start-button')).toBeVisible();
    await page.screenshot({
      path: `test-results/variety-${seed}-${info.project.name}.png`,
    });
    await page.locator('#start-button').click();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      /countdown|racing/
    );
    expect(errors).toEqual([]);
  });
}
