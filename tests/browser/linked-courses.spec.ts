import { expect, test } from '@playwright/test';
import { generateBrakingCircuit } from '../../src/shared/braking-course-generator';
import {
  COUNTDOWN_TICKS,
  createRacingState,
  stepRace,
} from '../../src/shared/race-rules';
import { SIMULATION_HZ } from '../../src/shared/simulation';
import { readSceneGraphics, waitForSceneAssets } from './scene-ready';

for (const word of ['banana', 'tui', 'river']) {
  const course = generateBrakingCircuit(`word-v2:${word}`);
  const replay = course.quality.fastReplay;
  if (!course.quality.valid || !replay) throw new Error(`Unapproved ${word}`);
  // Find the hill view using the real fixed-step replay, then drive the browser
  // with the same input events. No scene/camera/car state is injected.
  let race = createRacingState(course.track),
    held = false,
    index = 0;
  let hillTick = 0,
    peakHeight = 0;
  while (race.phase === 'racing') {
    while (replay.transitions[index]?.tick === race.simulation.tick)
      held = replay.transitions[index++]!.held;
    race = stepRace(course.track, race, held);
    const height = race.simulation.vertical?.height ?? 0;
    if (height > peakHeight) {
      peakHeight = height;
      hillTick = race.simulation.tick;
    }
  }
  test(`@smoke linked ${word} course renders hills and completes the authoritative lap`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-11-16T00:00:00Z') });
    await page.goto(`/game.html?practice=1&word=${word}`);
    await waitForSceneAssets(page);
    await expect(page.locator('#race')).toHaveAttribute('data-word-code', word);
    await test.info().attach('graphics', {
      body: JSON.stringify(await readSceneGraphics(page)),
      contentType: 'application/json',
    });
    await page.clock.pauseAt(new Date('2026-11-16T00:01:00Z'));
    await page.screenshot({
      path: info.outputPath(`${word}-ready.png`),
    });
    await page.locator('#start-button').click();
    const epoch = (await page.evaluate(() => performance.now())) + 3000;
    await page.keyboard.down('Space');
    await page.clock.runFor((COUNTDOWN_TICKS * 1000) / SIMULATION_HZ + 20);
    const timeline = [
      ...new Set([
        ...replay.transitions.slice(1).map((t) => t.tick),
        hillTick,
        replay.endTick,
      ]),
    ].sort((a, b) => a - b);
    for (const tick of timeline) {
      const now = await page.evaluate(() => performance.now());
      await page.clock.runFor(
        Math.max(0, epoch + (tick * 1000) / SIMULATION_HZ - now)
      );
      const transition = replay.transitions.find((t) => t.tick === tick);
      if (transition?.held) await page.keyboard.down('Space');
      else if (transition) await page.keyboard.up('Space');
      if (tick === hillTick) {
        expect(
          Number(await page.locator('#race').getAttribute('data-road-height'))
        ).toBeGreaterThan(0.8);
        await page.screenshot({
          path: info.outputPath(`${word}-hill.png`),
        });
      }
    }
    await page.clock.runFor(32);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-practice-laps',
      '1'
    );
    await expect(page.locator('#practice-last-lap')).toHaveText(
      `Last ${(replay.endTick / SIMULATION_HZ).toFixed(3).padStart(6, '0')}`
    );
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
    expect(errors).toEqual([]);
    await page.keyboard.up('Space');
  });
}
