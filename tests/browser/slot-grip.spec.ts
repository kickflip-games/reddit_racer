import { test, expect } from '@playwright/test';
import {
  waitForSceneAssets,
  openPracticeModes,
  advanceRaceClockUntil,
} from './scene-ready.ts';

test('slot-car practice warns before runoff and lifting restores grip, then continues laps', async ({
  page,
}, testInfo) => {
  // Up to 85 simulated seconds, rendering every frame, needs a separate CI
  // software-GPU budget. Keep the two-lap/input assertions intact.
  test.setTimeout(process.env.CI ? 300_000 : 180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
  await page.goto('/game.html?grip=1&seed=regression-0');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-grip-model',
    'dynamic'
  );
  await expect(page.locator('#card-title')).toHaveText('');
  await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(3100);
  for (
    let i = 0;
    i < 150 && (await page.locator('#grip-warning').isHidden());
    i++
  )
    await page.clock.runFor(100);
  await expect(page.locator('#grip-warning')).toBeVisible();
  await expect(page.locator('#status')).toHaveAttribute(
    'data-condition',
    'sliding'
  );
  const before = Number(
    await page.locator('#race').getAttribute('data-grip-usage')
  );
  await page.screenshot({
    path: `test-results/slot-grip-limit-${testInfo.project.name}.png`,
  });
  const speedBeforeLift = Number(await page.locator('#speed').textContent());
  await page.keyboard.up('Space');
  const after = Number(
    await page.locator('#race').getAttribute('data-grip-usage')
  );
  // Compare grip at the same position: the next half-second enters a tighter radius.
  expect(after).toBeLessThan(before);
  await page.clock.runFor(500);
  expect(Number(await page.locator('#speed').textContent())).toBeLessThan(
    speedBeforeLift
  );
  await page.screenshot({
    path: `test-results/slot-grip-lift-${testInfo.project.name}.png`,
  });
  await page.keyboard.down('Space');
  // Full-size visual states are covered above; bound two-lap software rendering.
  await page.setViewportSize({ width: 320, height: 320 });
  await advanceRaceClockUntil(
    page,
    async () =>
      Number(await page.locator('#race').getAttribute('data-practice-laps')) >=
      2,
    85000
  );
  expect(
    Number(await page.locator('#race').getAttribute('data-practice-laps'))
  ).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#leaderboard')).toBeHidden();
  expect(errors).toEqual([]);
});

test('new slot handling is selectable while the reference mode retains classic handling', async ({
  page,
}) => {
  await page.goto('/game.html');
  await expect(page.locator('#start-button')).toBeEnabled();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-grip-model',
    'classic'
  );
  await openPracticeModes(page);
  await page.locator('#slot-button').click();
  await expect(page.locator('#card-title')).toHaveText('');
  await expect(page.locator('#race')).toHaveAttribute(
    'data-grip-model',
    'dynamic'
  );
});
