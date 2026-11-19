import { expect, test } from '@playwright/test';
import { generateCurrentDailyCircuit } from '../../src/shared/braking-course-generator';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge';
import { sampleTrack } from '../../src/shared/track';

const noon = Date.parse('2026-11-19T12:00:00Z');
for (const [name, generated] of [
  ['current daily', generateCurrentDailyCircuit('word-v2:banana')],
  ['legacy daily', generateValidatedCircuit('showcase-3')],
] as const) {
  test(`built ${name} preview laps the loaded circuit silently and leaves a fresh real countdown`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      info.project.name === 'mobile-chromium'
        ? { width: 320, height: 568 }
        : { width: 1280, height: 800 }
    );
    const record = await createDailyChallengeRecord({
      subredditId: 't5_previewfixture',
      day: '2026-11-19',
      createdAtMs: noon,
      requestedSeed: generated.track.seed,
      generated,
    });
    let starts = 0;
    await page.clock.install({ time: new Date(noon) });
    await page.route('**/api/trpc/**', (route) =>
      route.fulfill({ status: 503, json: { error: 'local preview test' } })
    );
    await page.route('**/api/trpc/dailyChallenge*', (route) =>
      route.fulfill({
        json: { result: { data: dailyChallengeView(record, noon) } },
      })
    );
    await page.route('**/api/trpc/startRankedRace*', (route) => {
      starts++;
      return route.fulfill({
        json: {
          error: {
            message: 'Local practice fixture',
            code: -32001,
            data: { code: 'UNAUTHORIZED', httpStatus: 401 },
          },
        },
      });
    });
    await page.goto('/game.html?daily=1');
    const race = page.locator('#race');
    await expect(race).toHaveAttribute('data-car-load', 'ready');
    await expect(race).toHaveAttribute('data-preview', 'playing');
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    const read = () =>
      race.evaluate((el) =>
        JSON.parse(el.getAttribute('data-preview-pose') ?? '{}')
      );
    const initial = await read();
    const audio = await race.getAttribute('data-audio-state');
    await page.clock.runFor(1600);
    const moved = await read();
    expect(moved.distance).toBeGreaterThan(initial.distance + 15);
    const actual = sampleTrack(
      record.track,
      record.track.startS + moved.distance
    );
    expect(moved.x).toBeCloseTo(actual.x, 5);
    expect(moved.z).toBeCloseTo(actual.z, 5);
    await expect(page.locator('#timer')).toHaveText('00.000');
    await expect(race).toHaveAttribute('data-phase', 'ready');
    await expect(race).toHaveAttribute('data-audio-state', audio!);
    await expect(page.locator('canvas')).toHaveCount(1);
    expect(starts).toBe(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(race).toHaveAttribute('data-preview', 'static');
    await page.clock.runFor(500);
    const still = await read();
    await page.clock.runFor(1000);
    expect(await read()).toEqual(still);
    expect(still.distance).toBe(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.clock.runFor(200);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(200);
    const hidden = await read();
    await page.clock.runFor(1000);
    expect((await read()).distance).toBe(hidden.distance);
    await expect(race).toHaveAttribute('data-preview', 'paused');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(200);
    await page.locator('#start-button').click();
    await expect(race).toHaveAttribute('data-phase', 'countdown');
    await expect(race).toHaveAttribute('data-preview', 'off');
    await expect(page.locator('#race-countdown')).toHaveText('3');
    await expect(page.locator('#timer')).toHaveText('00.000');
    expect(starts).toBe(1);
    await page.keyboard.down('Space');
    await page.clock.runFor(3100);
    await expect(race).toHaveAttribute('data-phase', 'racing');
    expect(Number(await page.locator('#timer').textContent())).toBeLessThan(
      0.15
    );
  });
}
