import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/game.html?practice=1&seed=practice-1');
  await waitForSceneAssets(page);
  // Keep wall-clock rendering from racing manual frame advances between inputs.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
});

test('lesson uses the real course and responds to actual driving, then returns safely', async ({
  page,
}) => {
  await page.locator('#tutorial-open').click();
  await waitForSceneAssets(page);
  await page.locator('#race-canvas').focus();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-play-mode',
    'tutorial'
  );
  await page.keyboard.down('Space');
  await page.clock.runFor(5000);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#card')).toBeHidden();
  await expect(page.locator('#tutorial-overlay')).toHaveAttribute(
    'data-step',
    '1'
  );
  await page.keyboard.down('Space');
  await page.clock.runFor(5000);

  await expect(page.locator('#tutorial-overlay')).toHaveAttribute(
    'data-step',
    '1'
  );
  await page.keyboard.up('Space');
  await page.clock.runFor(2200);
  await expect(page.locator('#tutorial-overlay')).toHaveAttribute(
    'data-step',
    '2'
  );
  await page.keyboard.down('Space');
  await page.clock.runFor(5000);
  await page.keyboard.up('Space');
  await expect(page.locator('#tutorial-overlay')).toHaveAttribute(
    'data-step',
    '3'
  );
  await page.screenshot({
    path: test.info().outputPath('course-tutorial.png'),
  });
  await page.locator('#tutorial-finish').click();
  await waitForSceneAssets(page);
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-play-mode',
    'practice'
  );
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await page.locator('#tutorial-open').click();
  await waitForSceneAssets(page);
  await page.keyboard.down('Space');
  await page.clock.runFor(3500);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Space');
  await expect(page.locator('#tutorial-resume')).toBeVisible();
  await page.locator('#tutorial-resume').click();
  await page.clock.runFor(3500);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

test('touch the course to learn, compact overlay leaves the road usable', async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: 390, height: 680 });
  await page.locator('#tutorial-open').click();
  await waitForSceneAssets(page);
  await page.clock.runFor(3500);
  const overlay = await page.locator('#tutorial-overlay').boundingBox();
  expect(overlay!.height).toBeLessThan(180);
  const point = { x: 200, y: 400 };
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point],
    });
    await page.clock.runFor(5000);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.clock.runFor(5000);
    await page.mouse.up();
  }
  await expect(page.locator('#tutorial-overlay')).toHaveAttribute(
    'data-step',
    '1'
  );
  await page.clock.runFor(2200);
  await expect(page.locator('#tutorial-overlay')).toHaveAttribute(
    'data-step',
    '2'
  );
  await page.locator('#tutorial-close').click();
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

test('tutorial preserves daily identity and never starts or submits a ranked attempt', async ({
  page,
}) => {
  const { createDailyChallengeRecord, dailyChallengeView } =
    await import('../../src/shared/daily-challenge.ts');
  const { generateElevatedCircuit } =
    await import('../../src/shared/elevated-generator.ts');
  const record = await createDailyChallengeRecord({
    subredditId: 't5_tutorial',
    day: '2026-11-16',
    createdAtMs: Date.parse('2026-11-16T12:00:00Z'),
    requestedSeed: 'showcase-3',
    generated: generateElevatedCircuit('showcase-3'),
  });
  await page.route('**/api/trpc/dailyChallenge*', (route) =>
    route.fulfill({
      json: {
        result: {
          data: dailyChallengeView(record, Date.parse('2026-11-16T13:00:00Z')),
        },
      },
    })
  );
  let attempts = 0;
  page.on('request', (request) => {
    if (/startRankedRace|submitRun/.test(request.url())) attempts++;
  });
  await page.goto('/game.html?daily=1');
  await waitForSceneAssets(page);
  const identity = await page
    .locator('#race')
    .getAttribute('data-challenge-hash');
  await page.locator('#tutorial-open').click();
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-play-mode',
    'tutorial'
  );
  await page.locator('#tutorial-close').click();
  await waitForSceneAssets(page);
  expect(attempts).toBe(0);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-challenge-hash',
    identity!
  );
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
});
