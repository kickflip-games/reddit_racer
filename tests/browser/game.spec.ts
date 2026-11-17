import { test, expect } from '@playwright/test';

// These visual/physics tests use Vite without the Reddit archive backend.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/trpc/dailyStandings*', (route) =>
    route.fulfill({ status: 200, json: { result: { data: null } } })
  );
});
import { waitForSceneAssets, advanceRaceClockUntil } from './scene-ready.ts';

test(
  'local racer renders, accelerates, brakes, completes and retries',
  { tag: '@smoke' },
  async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
    await page.goto('/game.html');
    await waitForSceneAssets(page);
    await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
    await expect(page.locator('#mode-label')).toContainText('Unranked');
    await expect(page.locator('#race-canvas')).toBeVisible();
    await expect(page.locator('#circuit-minimap')).toBeHidden();
    await page.locator('#start-button').click();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'countdown'
    );
    await page.keyboard.down('Space');
    await page.clock.runFor(1000);
    await expect(page.locator('#timer')).toHaveText('00.000');
    await expect(page.locator('#speed')).toHaveText('0');
    await expect(page.locator('#race-countdown')).toBeVisible();
    await page.screenshot({
      path: `test-results/lap-countdown-${test.info().project.name}.png`,
    });
    await page.clock.runFor(3100);
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
    await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
    await expect(page.locator('#circuit-minimap')).toBeVisible();
    const acceleratingSpeed = Number(
      await page.locator('#speed').textContent()
    );
    expect(acceleratingSpeed).toBeGreaterThan(0);
    await page.keyboard.up('Space');
    await page.clock.runFor(500);
    expect(Number(await page.locator('#speed').textContent())).toBeLessThan(
      acceleratingSpeed
    );
    await page.keyboard.down('Space');
    await page.clock.runFor(9000);
    await page.screenshot({
      path: `test-results/fixed-step-${test.info().project.name}.png`,
    });
    await advanceRaceClockUntil(
      page,
      async () =>
        (await page.locator('#race').getAttribute('data-phase')) === 'finished',
      45000
    );
    await expect(page.locator('#retry-button')).toBeVisible();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'finished'
    );
    await expect(page.locator('#lap-progress-label')).toContainText('100%');
    await expect(page.locator('#circuit-minimap')).toBeHidden();
    await expect(page.locator('#minimap-progress')).toHaveAttribute(
      'aria-valuenow',
      '0'
    );
    expect(
      await page
        .locator('#lap-progress')
        .evaluate((node) =>
          node instanceof HTMLProgressElement ? node.value / node.max : 0
        )
    ).toBe(1);
    await page.keyboard.up('Space');
    await page.screenshot({
      path: `test-results/foundation-${test.info().project.name}.png`,
    });
    await page.locator('#retry-button').click();
    await page.clock.runFor(32);
    expect(Number(await page.locator('#timer').textContent())).toBeLessThan(
      0.5
    );
    await expect(page.locator('#speed')).toHaveText('0');
    await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  }
);

test(
  'focus loss and long frame gaps visibly interrupt and allow a fresh retry',
  { tag: '@smoke' },
  async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
    await page.goto('/game.html');
    await waitForSceneAssets(page);
    await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
    await page.locator('#start-button').click();
    await page.clock.runFor(3100);
    await page.keyboard.down('Space');
    await page.clock.runFor(200);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('#card-title')).toHaveText('Race interrupted.');
    await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
    await page.keyboard.up('Space');
    await page.locator('#retry-button').click();
    await page.clock.fastForward(1000);
    await expect(page.locator('#card-title')).toHaveText('Race interrupted.');
    await expect(page.locator('#retry-button')).toBeVisible();
  }
);

test('interrupted cards stay readable and clear of settings in compact viewports', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.clock.fastForward(1000);
  await expect(page.locator('#card-copy')).toHaveText('');
  // Include the archived-post notice shown in the reported Android screenshot.
  await page.locator('#today-race').evaluate((node) => {
    node.removeAttribute('hidden');
  });
  await page.locator('#today-race-status').evaluate((node) => {
    node.textContent =
      'Today’s race is ready. This post keeps its original course.';
  });
  await page.locator('#today-race-button').evaluate((node) => {
    node.removeAttribute('hidden');
  });
  for (const viewport of [
    { width: 393, height: 690 },
    { width: 320, height: 480 },
    { width: 740, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await page.clock.runFor(32);
    await page.locator('#practice-button').scrollIntoViewIfNeeded();
    const card = await page.locator('#card').boundingBox();
    const settings = await page
      .locator('#race-settings > summary')
      .boundingBox();
    expect(card).not.toBeNull();
    expect(settings).not.toBeNull();
    if (!card || !settings) throw new Error('Missing card or settings');
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.y + card.height).toBeLessThanOrEqual(settings.y - 8);
    await expect(page.locator('#card')).toHaveCSS(
      'background-color',
      'rgb(255, 247, 232)'
    );
    await page.locator('#race-settings > summary').click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await page.locator('#settings-close').click();
    await expect(page.locator('#settings-dialog')).toBeHidden();
    await expect(page.locator('#card-title')).toHaveText('Race interrupted.');
  }
  await page.setViewportSize({ width: 393, height: 690 });
  await page.locator('#retry-button').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/interrupted-mobile-layout.png' });
  await page.locator('#retry-button').click();
  await page.clock.runFor(32);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
});
