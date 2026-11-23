import { expect, test } from '@playwright/test';
import { createPracticeDriver } from '../../src/client/practice-driver';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator';
import { waitForSceneAssets } from './scene-ready';

test('live tenths reset at a rolling lap while last and best retain milliseconds', async ({
  page,
}) => {
  const control = createPracticeDriver(
    generateElevatedCircuit('practice-1').track
  );
  control.start(0);
  control.setInput(true, 0);
  let finishMs = 0;
  for (let tick = 1; tick <= 14_400; tick++) {
    finishMs = (tick * 1000) / 120;
    control.advance(finishMs);
    if (control.completedLaps) break;
  }
  if (control.lastLapTicks === null)
    throw new Error('Reference did not finish');
  const lapTime = (control.lastLapTicks / 120).toFixed(3).padStart(6, '0');
  await page.setViewportSize({ width: 390, height: 600 });
  await page.clock.install({ time: new Date('2026-11-23T12:00:00Z') });
  await page.goto('/game.html?practice=1&seed=practice-1');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-23T12:01:00Z'));
  await expect(page.locator('#timer')).toHaveText('00.0');
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(1000);
  await expect(page.locator('#timer')).toHaveText('00.0');
  await page.clock.runFor(3100);
  await expect(page.locator('#timer')).toHaveText(/^\d+\.\d$/);
  await page.clock.runFor(finishMs + 32 - 4100);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-practice-laps',
    '1'
  );
  await expect(page.locator('#timer')).toHaveText('00.0');
  await expect(page.locator('#practice-last-lap')).toHaveText(
    `Last ${lapTime}`
  );
  await expect(page.locator('#practice-best-lap')).toHaveText(
    `Best ${lapTime} s`
  );
  await page.keyboard.up('Space');
});
