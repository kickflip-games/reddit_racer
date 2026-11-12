import { test, expect } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { COUNTDOWN_TICKS } from '../../src/shared/race-rules.ts';
import { SIMULATION_HZ } from '../../src/shared/simulation.ts';

const seed = 'showcase-3';
const accepted = generateValidatedCircuit(seed);
const replay = accepted.quality.fastReplay;
if (!replay) throw new Error('Expected an approved generated input tape');

test('approved generated hairpin can be driven, finished and retried with the same course', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto(`/game.html?seed=${seed}`);
  await expect(page.locator('#track-source')).toHaveAttribute(
    'data-state',
    'ready'
  );
  await expect(page.locator('#track-source')).toHaveAttribute(
    'data-seed',
    seed
  );
  await expect(page.locator('#start-button')).toBeEnabled();
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
  await page.screenshot({
    path: `test-results/generated-ready-${test.info().project.name}.png`,
  });
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor((COUNTDOWN_TICKS * 1000) / SIMULATION_HZ);
  // A repeated held event synchronizes the final countdown fraction before scored tick zero.
  await page.keyboard.down('Space');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  const epoch = await page.evaluate(() => performance.now());
  let captured = false;
  for (const transition of replay.transitions.slice(1)) {
    const now = await page.evaluate(() => performance.now());
    await page.clock.runFor(
      Math.max(0, epoch + (transition.tick * 1000) / SIMULATION_HZ - now)
    );
    if (transition.held) await page.keyboard.down('Space');
    else await page.keyboard.up('Space');
    if (!captured && transition.tick > replay.endTick / 2) {
      await page.screenshot({
        path: `test-results/generated-driving-${test.info().project.name}.png`,
      });
      captured = true;
    }
  }
  const now = await page.evaluate(() => performance.now());
  await page.clock.runFor(
    Math.max(0, epoch + (replay.endTick * 1000) / SIMULATION_HZ - now)
  );
  await page.keyboard.up('Space');
  await page.clock.runFor(32);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'finished');
  await expect(page.locator('#card-title')).toHaveText(
    `${(replay.endTick / SIMULATION_HZ).toFixed(3).padStart(6, '0')} seconds`
  );
  await expect(page.locator('#lap-progress-label')).toContainText('100%');
  const trackLabel = await page.locator('#track-source').textContent();
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  expect(await page.locator('#track-source').textContent()).toBe(trackLabel);
  expect(
    await page
      .locator('#lap-progress')
      .evaluate((node) =>
        node instanceof HTMLProgressElement ? node.value : -1
      )
  ).toBe(0);
  expect(errors).toEqual([]);
});

test('invalid local seed fails before controls are enabled', async ({
  page,
}) => {
  await page.goto('/game.html?seed=');
  await expect(page.locator('#track-source')).toHaveAttribute(
    'data-state',
    'rejected'
  );
  await expect(page.locator('#start-button')).toBeDisabled();
  await expect(page.locator('#error')).toContainText('1–96');
});
