import { test, expect } from '@playwright/test';
import { generateCurrentDailyCircuit } from '../../src/shared/braking-course-generator';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge';
import {
  createRacingState,
  stepRace,
  COUNTDOWN_TICKS,
} from '../../src/shared/race-rules';
import { waitForSceneAssets } from './scene-ready';
for (const day of ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']) {
  test(`candidate public ${day} loads and completes with the same ranked replay at 20 rendered fps on a phone viewport`, async ({
    page,
  }, info) => {
    test.setTimeout(360000);
    await page.setViewportSize({ width: 393, height: 568 });
    const seed = `daily:t5_kyc33w:${day}`,
      course = generateCurrentDailyCircuit(seed),
      replay = course.quality.fastReplay;
    if (!replay) throw new Error('Missing approval');
    const noon = Date.parse(`${day}T12:00:00Z`),
      record = await createDailyChallengeRecord({
        subredditId: 't5_kyc33w',
        day,
        createdAtMs: noon,
        requestedSeed: seed,
        generated: course,
      });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/trpc/dailyChallenge*', (route) =>
      route.fulfill({
        json: { result: { data: dailyChallengeView(record, noon) } },
      })
    );
    await page.route('**/api/trpc/startRankedRace*', (route) =>
      route.fulfill({
        json: {
          error: {
            message: 'Signed out in local candidate preview',
            code: -32001,
            data: { code: 'UNAUTHORIZED', httpStatus: 401 },
          },
        },
      })
    );
    await page.clock.install({ time: new Date(noon) });
    // Cloud software rasterisation is slow. Only the presentation cadence is
    // controlled; the real driver still executes every 1/120-second update.
    await page.addInitScript(() => {
      window.requestAnimationFrame = (callback) =>
        window.setTimeout(() => callback(performance.now()), 50);
      window.cancelAnimationFrame = (id) => window.clearTimeout(id);
    });
    await page.goto('/game.html?daily=1');
    // Cold GLTF/shader startup on shared software graphics can exceed the
    // default 5-second assertion window; no race clock has been advanced yet.
    await expect(page.locator('#race')).toHaveAttribute(
      'data-car-load',
      'ready',
      { timeout: 30_000 }
    );
    await waitForSceneAssets(page);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-track-hash',
      record.trackHash
    );
    await page.clock.pauseAt(new Date(noon + 60000));
    await page.screenshot({ path: info.outputPath(`${day}-ready.png`) });
    let race = createRacingState(course.track),
      held = false,
      ix = 0,
      viewTick = 0,
      maxView = 0;
    while (race.phase === 'racing') {
      while (replay.transitions[ix]?.tick === race.simulation.tick)
        held = replay.transitions[ix++]!.held;
      race = stepRace(course.track, race, held);
      const view = course.track.jumps?.length
        ? race.simulation.vertical?.airborne
          ? race.simulation.vertical.height
          : 0
        : (race.simulation.vertical?.height ?? 0);
      if (view > maxView) {
        maxView = view;
        viewTick = race.simulation.tick;
      }
    }
    await page.locator('#start-button').click();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'countdown'
    );
    const epoch =
      (await page.evaluate(() => performance.now())) +
      (COUNTDOWN_TICKS * 1000) / 120;
    await page.keyboard.down('Space');
    await page.clock.runFor(3020);
    for (const tick of [
      ...new Set([
        ...replay.transitions.slice(1).map((t) => t.tick),
        viewTick,
        replay.endTick,
      ]),
    ].sort((a, b) => a - b)) {
      const now = await page.evaluate(() => performance.now());
      await page.clock.runFor(Math.max(0, epoch + (tick * 1000) / 120 - now));
      const input = replay.transitions.find((t) => t.tick === tick);
      if (input?.held) await page.keyboard.down('Space');
      else if (input) await page.keyboard.up('Space');
      if (tick === viewTick) {
        if (course.track.jumps?.length)
          await expect(page.locator('#race')).toHaveAttribute(
            'data-airborne',
            'true'
          );
        await page.screenshot({ path: info.outputPath(`${day}-driving.png`) });
      }
    }
    // Flush two presentation frames after the last authoritative physics tick.
    await page.clock.runFor(100);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'finished'
    );
    await expect(page.locator('#card-title')).toHaveText(
      `${(replay.endTick / 120).toFixed(3).padStart(6, '0')} seconds`
    );
    expect(errors).toEqual([]);
    await page.keyboard.up('Space');
  });
}
