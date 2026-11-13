import { test, expect } from '@playwright/test';
import { waitForSceneAssets, readSceneGraphics } from './scene-ready.ts';

test('native hold takes off, separates from the raised road and lands on desktop and mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 568 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') });
  await page.goto('/game.html?elevated=1&seed=flow-probe-21');
  const race = page.locator('#race');
  await expect(race).toHaveAttribute('data-phase', 'ready');
  await waitForSceneAssets(page);
  await expect(race).toHaveAttribute('data-track-schema', '2');
  await page.clock.pauseAt(new Date('2026-11-13T12:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  let flew = false,
    landed = false,
    largestGap = 0;
  for (let i = 0; i < 85; i++) {
    await page.clock.runFor(100);
    const state = await race.evaluate((e) => ({
      airborne: e.dataset.airborne === 'true',
      height: Number(e.dataset.carHeight),
      road: Number(e.dataset.roadHeight),
      landings: Number(e.dataset.landings),
    }));
    if (state.airborne) {
      flew = true;
      largestGap = Math.max(largestGap, state.height - state.road);
    }
    if (flew && largestGap > 0.5 && !state.airborne && state.landings > 0) {
      landed = true;
      expect(Math.abs(state.height - state.road)).toBeLessThan(0.08);
      break;
    }
    if (state.airborne && state.height - state.road > 0.8)
      await page.screenshot({
        path: `test-results/elevated-jump-${test.info().project.name}.png`,
      });
  }
  expect(flew).toBe(true);
  expect(landed).toBe(true);
  expect(largestGap).toBeGreaterThan(0.5);
  await expect(page.locator('#speed')).toBeHidden();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#lap-progress')).toBeHidden();
  await test.info().attach('actual-elevated-graphics', {
    body: JSON.stringify(await readSceneGraphics(page)),
    contentType: 'application/json',
  });
  await page.keyboard.up('Space');
  const before = Number(await page.locator('#speed').textContent());
  await page.clock.runFor(300);
  expect(Number(await page.locator('#speed').textContent())).toBeLessThan(
    before
  );
  expect(errors).toEqual([]);
});

test('the elevated workshop previews varied approved geometry and opens the matching course', async ({
  page,
}) => {
  await page.goto(
    '/track-gallery.html?elevated=1&prefix=elevated-regression&count=12&seed=flow-probe-21'
  );
  await expect(page.locator('#gallery-status')).toHaveAttribute(
    'data-state',
    'complete'
  );
  await expect(page.locator('#track-gallery button[data-seed]')).toHaveCount(
    12
  );
  const paths = await page
    .locator('#track-gallery svg')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('path')?.getAttribute('d'))
    );
  expect(new Set(paths).size).toBe(12);
  await page.locator('#check-quality').click();
  await expect(page.locator('#quality-verdict')).toHaveAttribute(
    'data-state',
    'passed'
  );
  await expect(page.locator('#drive-selected')).toHaveAttribute(
    'href',
    /elevated=1/
  );
  await page.screenshot({
    path: `test-results/elevated-workshop-${test.info().project.name}.png`,
    fullPage: true,
  });
});
