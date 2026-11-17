import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

for (const [width, height] of [
  [390, 680],
  [320, 480],
  [640, 360],
]) {
  test(`rejected-result layout keeps actions aligned at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto('/game.html?practice=1&seed=practice-1');
    await waitForSceneAssets(page);
    // Presentation fixture only: not a simulated race or claim of server acceptance.
    await page.evaluate(() => {
      const el = (id: string) => document.getElementById(id)!;
      el('race').dataset.phase = 'finished';
      el('card').dataset.result = 'true';
      el('card-kicker').textContent = 'Unverified';
      el('card-copy').textContent =
        'This run could not be accepted. Try a new attempt.';
      el('start-button').hidden = true;
      el('retry-button').hidden = false;
      el('finish-time').hidden = false;
      el('finish-value').textContent = '28.283';
      el('result-summary').hidden = false;
      el('leaderboard-me').textContent = 'You have no verified daily time yet.';
    });
    const retry = (await page.locator('#retry-button').boundingBox())!;
    const learn = (await page.locator('#tutorial-open').boundingBox())!;
    expect(Math.abs(retry.y - learn.y)).toBeLessThan(2);
    expect(retry.width).toBeGreaterThan(learn.width);
    await expect(page.locator('#retry-button')).toBeInViewport();
    await expect(page.locator('#tutorial-open')).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath('rejected-result-layout-fixture.png'),
    });
  });
}
