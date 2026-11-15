import { expect, test } from '@playwright/test';
import { generateBrakingCircuit } from '../../src/shared/braking-course-generator';
import { COUNTDOWN_TICKS } from '../../src/shared/race-rules';
import { SIMULATION_HZ } from '../../src/shared/simulation';
import { waitForSceneAssets } from './scene-ready';
const course = generateBrakingCircuit('word-v2:banana');
const replay = course.quality.fastReplay;
if (!course.quality.valid || !replay)
  throw new Error('Banana must pass the real braking gate');
test('v2 braking inputs complete a continuous real lap without changing the legacy course', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 400, height: 400 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-11-15T00:00:00Z') });
  await page.goto('/game.html?practice=1&word=banana&wordVersion=2');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-word-code',
    'banana'
  );
  await page.clock.pauseAt(new Date('2026-11-15T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor((COUNTDOWN_TICKS * 1000) / SIMULATION_HZ);
  await page.keyboard.down('Space');
  const epoch = await page.evaluate(() => performance.now());
  let captured = false;
  for (const transition of replay.transitions.slice(1)) {
    const now = await page.evaluate(() => performance.now());
    await page.clock.runFor(
      Math.max(0, epoch + (transition.tick * 1000) / SIMULATION_HZ - now)
    );
    if (transition.held) await page.keyboard.down('Space');
    else await page.keyboard.up('Space');
    if (!captured && !transition.held) {
      await page.screenshot({
        path: `/tmp/racer-v2-braking-${info.project.name}.png`,
      });
      captured = true;
    }
  }
  const now = await page.evaluate(() => performance.now());
  await page.clock.runFor(
    Math.max(0, epoch + (replay.endTick * 1000) / SIMULATION_HZ - now) + 32
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-practice-laps',
    '1'
  );
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#practice-last-lap')).toHaveText(
    `Last ${(replay.endTick / SIMULATION_HZ).toFixed(3).padStart(6, '0')}`
  );
  await expect(page.locator('#race-countdown')).toBeHidden();
  expect(errors).toEqual([]);
});
