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
import { findTrackCrossings } from '../../src/shared/track-crossings';
import { waitForSceneAssets } from './scene-ready';
for (const day of ['2026-11-27', '2026-12-04']) {
  test(`@smoke localized overpass ${day} drives both decks on a phone with ranked timing`, async ({
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
    const crossing = findTrackCrossings(course.track)[0];
    if (!crossing) throw new Error('Missing crossing');
    const views: { tick: number; deck: string; y: number }[] = [];
    let race = createRacingState(course.track),
      held = false,
      ix = 0;
    const pending = [
      { s: crossing.lowerS, deck: 'lower', y: crossing.lowerY },
      { s: crossing.upperS, deck: 'upper', y: crossing.upperY },
    ].sort((a, b) => a.s - b.s);
    while (race.phase === 'racing') {
      while (replay.transitions[ix]?.tick === race.simulation.tick)
        held = replay.transitions[ix++]!.held;
      race = stepRace(course.track, race, held);
      if (pending[0] && race.simulation.distance >= pending[0].s) {
        const v = pending.shift()!;
        views.push({ tick: race.simulation.tick, deck: v.deck, y: v.y });
      }
    }
    expect(views.length).toBe(2);
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
        ...views.map((v) => v.tick),
        replay.endTick,
      ]),
    ].sort((a, b) => a - b)) {
      const now = await page.evaluate(() => performance.now());
      await page.clock.runFor(Math.max(0, epoch + (tick * 1000) / 120 - now));
      const input = replay.transitions.find((t) => t.tick === tick);
      if (input?.held) await page.keyboard.down('Space');
      else if (input) await page.keyboard.up('Space');
      const view = views.find((v) => v.tick === tick);
      if (view) {
        await expect(page.locator('#race')).toHaveAttribute(
          'data-crossing-deck',
          view.deck
        );
        await expect(page.locator('#race')).toHaveAttribute(
          'data-airborne',
          'false'
        );
        const heights = await page.locator('#race').evaluate((el) => ({
          car: Number(el.getAttribute('data-car-height')),
          road: Number(el.getAttribute('data-road-height')),
        }));
        expect(Math.abs(heights.car - view.y)).toBeLessThan(0.02);
        expect(Math.abs(heights.road - view.y)).toBeLessThan(0.02);
        await expect(page.locator('#minimap-player')).toHaveAttribute(
          'data-deck',
          view.deck === 'lower' ? 'underpass' : 'bridge'
        );
        expect(await page.locator('.minimap-bridge').count()).toBe(1);
        await page.screenshot({
          path: info.outputPath(`${day}-${view.deck}.png`),
        });
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
