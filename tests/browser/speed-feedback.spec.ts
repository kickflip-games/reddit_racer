import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

test('speed feedback stays readable through acceleration, lift, live reduced motion and restart', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-16T12:00:00Z') });
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  const race = page.locator('#race');
  await expect(race).toHaveAttribute('data-phase', 'ready');
  await page.clock.pauseAt(new Date('2026-11-16T12:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(5300);
  await expect(race).toHaveAttribute('data-phase', 'racing');
  const fast = Number(await page.locator('#speed').textContent());
  expect(fast).toBeGreaterThan(18);
  await page.screenshot({
    path: `test-results/speed-feedback-fast-${test.info().project.name}.png`,
  });
  await page.keyboard.up('Space');
  await page.clock.runFor(100);
  await page.screenshot({
    path: `test-results/speed-feedback-lift-${test.info().project.name}.png`,
  });
  await page.clock.runFor(500);
  expect(Number(await page.locator('#speed').textContent())).toBeLessThan(fast);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(100);
  await expect(race).toHaveAttribute('data-reduced-motion', 'true');
  expect(
    await race.evaluate((e) => e.style.getPropertyValue('--speed-cue'))
  ).toBe('0');
  await page.locator('#restart-button').click();
  await page.clock.runFor(100);
  await expect(race).not.toHaveAttribute('data-phase', 'interrupted');
  expect(errors).toEqual([]);
});
