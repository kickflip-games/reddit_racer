import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

for (const [width, height] of [
  [390, 680],
  [320, 480],
  [640, 360],
  [960, 720],
]) {
  test(`on-course hint is brief and nonblocking at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.clock.install();
    await page.goto('/game.html?practice=1&seed=practice-1');
    await waitForSceneAssets(page);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const hint = page.locator('#driving-hint');
    await expect(hint).toBeHidden();
    await expect(
      page.getByRole('button', { name: 'Learn to drive' })
    ).toHaveCount(0);
    await page.locator('#start-button').click();
    await expect(hint).toContainText('Hold to accelerate · Lift to brake');
    await expect(hint).toBeInViewport();
    const bounds = (await hint.boundingBox())!;
    expect(bounds.height).toBeLessThan(60);
    expect(bounds.y).toBeGreaterThan(height! / 2);
    expect(
      await hint.evaluate((el) => getComputedStyle(el).pointerEvents)
    ).toBe('none');
    await page.screenshot({
      path: test.info().outputPath('on-course-hint.png'),
    });
    await page.clock.runFor(3200);
    await expect(hint).toBeVisible();
    await expect(page.locator('#circuit-minimap')).toBeVisible();
    const hintBounds = (await hint.boundingBox())!;
    const mapBounds = (await page.locator('#circuit-minimap').boundingBox())!;
    expect(hintBounds.y + hintBounds.height).toBeLessThanOrEqual(
      mapBounds.y - 8
    );
    await page.clock.runFor(1900);
    await expect(hint).toBeHidden();
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(hint).toBeHidden();
    await page.locator('#retry-button').click();
    await expect(hint).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(hint).toBeHidden();
  });
}

test('daily start shows same hint without changing challenge identity', async ({
  page,
}) => {
  const { createDailyChallengeRecord, dailyChallengeView } =
    await import('../../src/shared/daily-challenge.ts');
  const { generateElevatedCircuit } =
    await import('../../src/shared/elevated-generator.ts');
  const record = await createDailyChallengeRecord({
    subredditId: 't5_hint',
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
  await page.route('**/api/trpc/startRankedRace*', (route) =>
    route.fulfill({
      json: {
        error: {
          message: 'Sign in',
          code: -32603,
          data: { code: 'UNAUTHORIZED', httpStatus: 401 },
        },
      },
    })
  );
  await page.goto('/game.html?daily=1');
  await waitForSceneAssets(page);
  const hash = await page.locator('#race').getAttribute('data-challenge-hash');
  // A signed-out daily run uses the normal practice start path.
  await page.locator('#start-button').click();
  await expect(page.locator('#driving-hint')).toBeVisible();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-challenge-hash',
    hash!
  );
});

test('word course keeps selected course and respects reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/game.html?practice=1&word=river');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  const seed = await page.locator('#practice-seed').getAttribute('data-seed');
  await page.locator('#start-button').click();
  const hint = page.locator('#driving-hint');
  await expect(hint).toBeVisible();
  expect(await hint.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    'none'
  );
  await page.clock.runFor(5100);
  await expect(hint).toBeHidden();
  await expect(page.locator('#practice-seed')).toHaveAttribute(
    'data-seed',
    seed!
  );
});
