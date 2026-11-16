import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';

test.beforeEach(async ({ page }) => {
  await page.clock.install();
  await page.goto('/game.html?practice=1&seed=practice-1');
  await waitForSceneAssets(page);
});

test('first-time lesson waits for hold and release; replay and completion persist', async ({
  page,
}) => {
  await expect(page.locator('#tutorial-open')).toHaveText('New? Learn to play');
  const phase = await page.locator('#race').getAttribute('data-phase');
  await page.locator('#tutorial-open').click();
  const dialog = page.locator('#tutorial-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#tutorial-pad')).toBeFocused();
  await page.clock.runFor(1000);
  await expect(dialog).toHaveAttribute('data-step', 'hold');
  await page.keyboard.down('Space');
  await page.clock.runFor(700);
  await expect(dialog).toHaveAttribute('data-step', 'release');
  await page.clock.runFor(1000);
  await expect(dialog).toHaveAttribute('data-step', 'release');
  await page.keyboard.up('Space');
  await expect(dialog).toHaveAttribute('data-step', 'done');
  await page.locator('#tutorial-replay').click();
  await expect(dialog).toHaveAttribute('data-step', 'hold');
  await page.keyboard.down('Space');
  await page.clock.runFor(700);
  await page.keyboard.up('Space');
  await page.locator('#tutorial-close').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#tutorial-open')).toBeFocused();
  await expect(page.locator('#race')).toHaveAttribute('data-phase', phase!);
  await page.reload();
  await expect(page.locator('#tutorial-open')).toHaveText('How to play');
  await expect(dialog).toBeHidden();
});

test('skip, Escape, early release and interrupted input leave race untouched', async ({
  page,
}) => {
  await page.locator('#tutorial-open').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(100);
  await page.keyboard.up('Space');
  await expect(page.locator('#tutorial-dialog')).toHaveAttribute(
    'data-step',
    'hold'
  );
  await page.keyboard.down('Space');
  await page.clock.runFor(700);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Space');
  await expect(page.locator('#tutorial-dialog')).toHaveAttribute(
    'data-step',
    'hold'
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('#tutorial-dialog')).toBeHidden();
  await page.locator('#tutorial-open').click();
  await page.locator('#tutorial-close').click();
  await expect(page.locator('#tutorial-open')).toHaveText('New? Learn to play');
  await page.locator('#start-button').click();
  await page.clock.runFor(3200);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
});

test('mouse or touch holds finish without scoring; compact dialog stays inside viewport', async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.locator('#tutorial-open').click();
  const dialog = page.locator('#tutorial-dialog');
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(480);
  const pad = page.locator('#tutorial-pad');
  if (isMobile) {
    // Chromium's actual touch events, not synthetic pointer handlers.
    const session = await page.context().newCDPSession(page);
    const bounds = await pad.boundingBox();
    const touchPoints = [
      { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 },
    ];
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints,
    });
    await page.clock.runFor(700);
    await expect(dialog).toHaveAttribute('data-step', 'release');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } else {
    await pad.hover();
    await page.mouse.down();
    await page.clock.runFor(700);
    await expect(dialog).toHaveAttribute('data-step', 'release');
    await page.mouse.up();
  }
  await expect(dialog).toHaveAttribute('data-step', 'done');
  await page.screenshot({
    path: test.info().outputPath('tutorial-complete.png'),
  });
  await page.locator('#tutorial-close').click();
  await expect(page.locator('#card')).toBeVisible();
  await expect(page.locator('#timer')).toHaveText('00.000');
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
    if (/startRankedRace|submitRankedRace/.test(request.url())) attempts++;
  });
  await page.goto('/game.html?daily=1');
  await waitForSceneAssets(page);
  const identity = await page
    .locator('#race')
    .getAttribute('data-challenge-hash');
  await page.locator('#tutorial-open').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(700);
  await page.keyboard.up('Space');
  await page.locator('#tutorial-close').click();
  expect(attempts).toBe(0);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-challenge-hash',
    identity!
  );
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
});
