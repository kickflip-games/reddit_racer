import { test, expect } from '@playwright/test';

test('local gallery can generate and inspect two hundred bounded courses', async ({
  page,
}) => {
  await page.goto(
    '/track-gallery.html?prefix=regression&count=200&seed=regression-0'
  );
  await expect(page.locator('#gallery-status')).toHaveAttribute(
    'data-state',
    'complete',
    { timeout: 110_000 }
  );
  await expect(page.locator('#track-gallery button[data-seed]')).toHaveCount(
    200
  );
  await page
    .locator('#track-gallery button[data-seed="regression-199"]')
    .click();
  await expect(page.locator('#selected-seed')).toHaveText('regression-199');
  await expect(page.locator('#selected-hash')).toHaveText(/^[a-f0-9]{64}$/);
});
