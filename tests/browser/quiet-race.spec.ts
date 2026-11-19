import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

for (const [width, height] of [
  [390, 680],
  [320, 480],
  [640, 360],
  [960, 720],
]) {
  test(`straight headings and quiet racing retain accessible controls at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.clock.install();
    await page.goto('/game.html?practice=1&word=river');
    await waitForSceneAssets(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const heading = page.locator('.start-wordmark');
    expect(await heading.evaluate((el) => getComputedStyle(el).fontStyle)).toBe(
      'normal'
    );
    expect(
      await heading.evaluate((el) => getComputedStyle(el).fontFamily)
    ).toContain('system-ui');
    await expect(heading).toBeInViewport();
    await page.screenshot({
      path: info.outputPath('ready-straight-heading.png'),
    });
    const canvas = page.locator('#race-canvas');
    await expect(canvas).toHaveAccessibleName(
      /Hold Space or touch.*release to brake/
    );
    await expect(canvas).toHaveAccessibleDescription(
      /Automatic steering.*Hold Shift or use two fingers to drift/
    );
    await page.locator('#start-button').click();
    const countdown = page.locator('#race-countdown');
    await expect(countdown).toHaveText('3');
    await expect(countdown).toHaveAccessibleName('3');
    expect(
      await countdown.evaluate((el) => getComputedStyle(el, '::after').content)
    ).toBe('none');
    await page.clock.runFor(1100);
    await expect(countdown).toHaveText('2');
    await page.clock.runFor(1000);
    await expect(countdown).toHaveText('1');
    await page.screenshot({
      path: info.outputPath('countdown-without-helper.png'),
    });
    await page.keyboard.down('Space');
    await page.clock.runFor(1000);
    await expect(countdown).toHaveText('GO!');
    await page.clock.runFor(1000);
    await expect(countdown).toBeHidden();
    await expect(page.locator('#timer')).toBeVisible();
    await expect(page.locator('#circuit-minimap')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Restart race', exact: true })
    ).toBeVisible();
    await expect(
      page.locator('#driving-hint, #driving-cue, .drift-cue')
    ).toHaveCount(0);
    await page.keyboard.up('Space');
    await page.clock.runFor(100);
    await expect(
      page.getByText(
        /^(Sliding|Braking|Grass slows you|DRIFT|RELEASE|Perfect start!)$/
      )
    ).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('quiet-active-race.png') });
  });
}
