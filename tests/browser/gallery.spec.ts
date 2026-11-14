import { test, expect } from '@playwright/test';
import { generateCircuit } from '../../src/shared/circuit-generator.ts';
import { hashTrack } from '../../src/shared/track.ts';

test('local gallery reproduces seeds and shows ten circuit/curvature previews', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(
    '/track-gallery.html?prefix=showcase&count=10&seed=showcase-0'
  );
  await expect(page.locator('#gallery-status')).toHaveAttribute(
    'data-state',
    'complete'
  );
  await expect(page.locator('#track-gallery button[data-seed]')).toHaveCount(
    10
  );
  await expect(page.locator('#selected-hash')).toHaveText(
    await hashTrack(generateCircuit('showcase-0').track)
  );
  await expect(page.locator('#selected-track')).toBeVisible();
  await expect(page.locator('#curvature-profile')).toBeVisible();
  await page.screenshot({
    path: `test-results/generator-gallery-${test.info().project.name}.png`,
    fullPage: true,
  });

  const seed = '<b>reproducible</b>';
  await page.locator('#gallery-seed').fill(seed);
  await page.locator('#inspect-seed').click();
  const expectedHash = await hashTrack(generateCircuit(seed).track);
  await expect(page.locator('#selected-hash')).toHaveText(expectedHash);
  await expect(page.locator('#selected-seed')).toHaveText(seed);
  await expect(page.locator('#selected-seed b')).toHaveCount(0);
  const first = await page.locator('#selected-track').innerHTML();
  await page.locator('#inspect-seed').click();
  await expect(page.locator('#selected-hash')).toHaveText(expectedHash);
  expect(await page.locator('#selected-track').innerHTML()).toBe(first);
  expect(errors).toEqual([]);
});

test('selected seed quality updates the accepted diagram and enables local driving', async ({
  page,
}) => {
  const seed = 'showcase-3';
  await page.goto(`/track-gallery.html?prefix=showcase&count=10&seed=${seed}`);
  await expect(page.locator('#gallery-status')).toHaveAttribute(
    'data-state',
    'complete'
  );
  await page.locator('#check-quality').click();
  await expect(page.locator('#quality-verdict')).toHaveAttribute(
    'data-state',
    'passed'
  );
  const { generateElevatedCircuit } =
    await import('../../src/shared/elevated-generator.ts');
  const approved = generateElevatedCircuit(seed);
  await expect(page.locator('#selected-hash')).toHaveText(
    await hashTrack(approved.track)
  );
  await expect(page.locator('#quality-metrics tr')).toHaveCount(3);
  await expect(page.locator('#drive-selected')).toHaveAttribute(
    'href',
    new RegExp(`game.html\\?seed=${seed}`)
  );
  await page.screenshot({
    path: `test-results/approved-gallery-${test.info().project.name}.png`,
    fullPage: true,
  });
});
