import { test, expect } from '@playwright/test';
test('built Other tracks needs no late generator fetch and bad words remain recoverable', async ({
  page,
}) => {
  let lateRequests = 0;
  await page.route('**/other-tracks-generator.js', (route) => {
    lateRequests++;
    return route.abort('failed');
  });
  // Standalone built smoke deliberately has no Reddit backend. The default
  // local fallback can load, then Other tracks exercises the real click path.
  await page.route('**/api/trpc/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'standalone smoke' } })
  );
  await page.goto('/game.html');
  await expect(page.locator('#race')).toHaveAttribute('data-car-load', 'ready');
  await expect(page.locator('#start-button')).toBeEnabled();
  await page.locator('#practice-button').click();
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#start-button')).toBeEnabled();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-word-code',
    /^[a-z]+-[a-z]+-/
  );
  await page.locator('#word-course-open').click();
  await page.locator('#course-word').fill('v99:banana');
  await page.locator('#word-course-submit').click();
  await expect(page.locator('#word-course-message')).toContainText(
    'Use letters'
  );
  await page.locator('#course-word').fill('banana');
  await page.locator('#word-course-submit').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-word-code',
    'banana'
  );
  await expect(page.locator('#race')).toHaveAttribute('data-car-load', 'ready');
  const hash = await page.locator('#race').getAttribute('data-track-hash');
  await page.locator('#word-course-open').click();
  await page.locator('#course-word').fill('  BANANA  ');
  await page.locator('#word-course-submit').click();
  await expect(page.locator('#race')).toHaveAttribute('data-track-hash', hash!);
  expect(lateRequests).toBe(0);
  await page.screenshot({
    path: test.info().outputPath('word-course-ready.png'),
  });
});
