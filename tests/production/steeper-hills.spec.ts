import { expect, test } from '@playwright/test';
import { generateBrakingCircuit } from '../../src/shared/braking-course-generator';
import { createRacingState, stepRace } from '../../src/shared/race-rules';
import { hashTrack } from '../../src/shared/track';

for (const word of ['banana', 'tui']) {
  const course = generateBrakingCircuit(`word-v2:${word}`);
  const replay = course.quality.fastReplay;
  if (!course.quality.valid || !replay) throw new Error(`Unapproved ${word}`);
  let predicted = createRacingState(course.track),
    held = false,
    index = 0,
    hillTick = 0,
    peakHeight = 0;
  while (predicted.phase === 'racing') {
    while (replay.transitions[index]?.tick === predicted.simulation.tick)
      held = replay.transitions[index++]!.held;
    predicted = stepRace(course.track, predicted, held);
    const height = predicted.simulation.vertical?.height ?? 0;
    if (height > peakHeight) {
      peakHeight = height;
      hillTick = predicted.simulation.tick;
    }
  }
  test(`built steeper ${word} hill stays playable and completes the native-input lap`, async ({
    page,
  }, info) => {
    test.setTimeout(180000);
    await page.setViewportSize(
      info.project.name === 'mobile-chromium'
        ? { width: 320, height: 568 }
        : { width: 1280, height: 800 }
    );
    await page.clock.install();
    await page.route('**/api/trpc/**', (route) =>
      route.fulfill({
        status: 503,
        json: { error: 'local production hill fixture' },
      })
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/game.html?practice=1&word=${word}`);
    const race = page.locator('#race');
    await expect(race).toHaveAttribute('data-car-load', 'ready');
    await expect(race).toHaveAttribute(
      'data-track-hash',
      await hashTrack(course.track)
    );
    await expect(page.locator('#card-copy')).toHaveText(
      'Hold to accelerate. Release to brake.'
    );
    await expect(page.locator('#card-copy')).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.locator('#start-button').click();
    const epoch = (await page.evaluate(() => performance.now())) + 3000;
    await page.keyboard.down('Space');
    await page.clock.runFor(3020);
    await expect(race).toHaveAttribute('data-phase', 'racing');
    const timeline = [
      ...new Set([
        ...replay.transitions.slice(1).map((t) => t.tick),
        hillTick,
        replay.endTick,
      ]),
    ].sort((a, b) => a - b);
    for (const tick of timeline) {
      const now = await page.evaluate(() => performance.now());
      await page.clock.runFor(Math.max(0, epoch + (tick * 1000) / 120 - now));
      const transition = replay.transitions.find((t) => t.tick === tick);
      if (transition?.held) await page.keyboard.down('Space');
      else if (transition) await page.keyboard.up('Space');
      if (tick === hillTick) {
        expect(
          Number(await race.getAttribute('data-road-height'))
        ).toBeGreaterThan(peakHeight * 0.8);
        await expect(page.locator('#circuit-minimap')).toBeVisible();
        await expect(page.locator('#timer')).toBeVisible();
        await expect(page.locator('#card')).toBeHidden();
        await expect(
          page.locator('#driving-hint, #driving-cue, .drift-cue')
        ).toHaveCount(0);
        await page.screenshot({
          path: info.outputPath(`${word}-steeper-crest.png`),
        });
      }
    }
    await page.clock.runFor(40);
    await expect(race).toHaveAttribute('data-practice-laps', '1');
    await expect(page.locator('#practice-last-lap')).toHaveText(
      `Last ${(replay.endTick / 120).toFixed(3).padStart(6, '0')}`
    );
    expect(errors).toEqual([]);
    await page.keyboard.up('Space');
  });
}
