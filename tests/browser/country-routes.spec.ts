import { test, expect } from '@playwright/test';
import { waitForSceneAssets, advanceRaceClockUntil } from './scene-ready';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator';
import { segmentsIntersect } from '../../src/shared/circuit-validation';

test(
  'ordinary practice includes a real gap with one-button control and a fixed route',
  { tag: '@smoke' },
  async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
    await page.goto('/game.html?practice=1&seed=country-1');
    await waitForSceneAssets(page);
    await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
    await expect(
      page.locator('#stunt-button, #slot-button, #grip-warning')
    ).toHaveCount(0);
    await page.locator('#start-button').click();
    await page.keyboard.down('Space');
    await advanceRaceClockUntil(
      page,
      async () =>
        (await page.locator('#race').getAttribute('data-airborne')) === 'true',
      10000
    );
    await expect(page.locator('#race')).toHaveAttribute(
      'data-grip-model',
      'centreline'
    );
    await expect(page.locator('#race')).toHaveAttribute(
      'data-lateral-offset',
      '0'
    );
    await expect(page.locator('#race')).toHaveAttribute('data-surface', 'dry');
    await expect(page.locator('#circuit-minimap')).toBeVisible();
    await page.screenshot({
      path: `test-results/country-gap-${test.info().project.name}.png`,
    });
    await advanceRaceClockUntil(
      page,
      async () =>
        Number(await page.locator('#race').getAttribute('data-landings')) >= 1,
      6000
    );
    await expect(page.locator('#race')).toHaveAttribute(
      'data-lateral-offset',
      '0'
    );
    await page.keyboard.up('Space');
    expect(errors).toEqual([]);
  }
);

test(
  'ordinary generated roads cross at separate heights while the car follows both levels',
  { tag: '@smoke' },
  async ({ page }) => {
    const track = generateElevatedCircuit('country-0').track;
    const crossing: number[] = [];
    for (let i = 0; i < track.samples.length - 1 && !crossing.length; i++)
      for (let j = i + 30; j < track.samples.length - 1; j++) {
        const a = track.samples[i],
          b = track.samples[i + 1],
          c = track.samples[j],
          d = track.samples[j + 1];
        if (
          a &&
          b &&
          c &&
          d &&
          track.totalLength - (c.s - a.s) > 30 &&
          segmentsIntersect(a, b, c, d)
        ) {
          crossing.push(a.s, c.s);
          break;
        }
      }
    expect(crossing).toHaveLength(2);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
    await page.goto('/game.html?practice=1&seed=country-0');
    await waitForSceneAssets(page);
    await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
    await page.locator('#start-button').click();
    await page.keyboard.down('Space');
    for (const [index, s] of crossing.entries()) {
      const progress = () =>
        page
          .locator('#lap-progress')
          .evaluate((p) => (p instanceof HTMLProgressElement ? p.value : 0));
      await advanceRaceClockUntil(
        page,
        async () => (await progress()) >= s,
        45000
      );
      await expect(page.locator('#race')).toHaveAttribute(
        'data-lateral-offset',
        '0'
      );
      await expect(page.locator('#race')).toHaveAttribute(
        'data-airborne',
        'false'
      );
      const height = Number(
        await page.locator('#race').getAttribute('data-car-height')
      );
      expect(
        Math.abs(
          height -
            Number(await page.locator('#race').getAttribute('data-road-height'))
        )
      ).toBeLessThan(0.02);
      if (index === 0) expect(height).toBeLessThan(0.1);
      else expect(height).toBeGreaterThan(5.5);
      await page.screenshot({
        path: `test-results/country-crossing-${index}-${test.info().project.name}.png`,
      });
    }
    await page.keyboard.up('Space');
    expect(errors).toEqual([]);
  }
);
