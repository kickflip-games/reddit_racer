import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';
test('Other tracks accepts a word, uses plain words and mobile settings usability', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const calls: string[] = [];
  await page.route('**/api/trpc/**', (route) => {
    calls.push(route.request().url());
    return route.fulfill({
      status: 500,
      json: { error: 'No ranked request expected' },
    });
  });
  await page.goto('/game.html?practice=1&word=banana&wordVersion=1');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-word-code',
    'banana'
  );
  const banana = await page.locator('#race').getAttribute('data-track-hash');
  await page.locator('#word-course-open').click();
  await expect(page.locator('#course-word')).toBeFocused();
  await expect(page.locator('#course-word')).toHaveValue('banana');
  await page.locator('#course-word').fill('v1:  ＢＡＮＡＮＡ  ');
  await page.locator('#word-course-submit').click();
  await waitForSceneAssets(page);
  await expect(page.locator('#settings-dialog')).not.toBeVisible();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    banana!
  );
  await page.locator('#word-course-open').click();
  await page.locator('#course-word').fill('v99:banana');
  await page.locator('#word-course-submit').click();
  await expect(page.locator('#word-course-message')).toContainText(
    'Use letters'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    banana!
  );
  await page.locator('#course-word').fill('apple');
  await page.screenshot({
    path: `/tmp/racer-word-input-${test.info().project.name}.png`,
  });
  await page.locator('#course-word').press('Enter');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-word-code',
    'apple'
  );
  expect(await page.locator('#race').getAttribute('data-track-hash')).not.toBe(
    banana
  );
  await expect(page.locator('#practice-best-lap')).toHaveText('Best —');
  // The home preview reads yesterday's retained standings; changing words must
  // still never start or submit a ranked attempt. One bounded archive read only.
  expect(calls).toHaveLength(1);
  expect(new URL(calls[0]!).pathname).toBe('/api/trpc/dailyStandings');
  expect(errors).toEqual([]);
});
test('invalid word link is explicit and can recover through the word form', async ({
  page,
}) => {
  await page.goto('/game.html?practice=1&word=v99:banana');
  await expect(page.locator('#error')).toContainText('Use letters');
  await page.locator('#word-course-open').click();
  await page.locator('#course-word').fill('banana');
  await page.locator('#word-course-submit').click();
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-word-code',
    'banana'
  );
});

test('random Other tracks and New track expose reusable plain words', async ({
  page,
}) => {
  await page.goto('/game.html?practice=1');
  await waitForSceneAssets(page);
  const first = await page.locator('#race').getAttribute('data-word-code');
  expect(first).toMatch(/^[a-z]+-[a-z]+-/);
  const hash = await page.locator('#race').getAttribute('data-track-hash');
  await page.locator('#word-course-open').click();
  await page.locator('#next-practice-button').click();
  await waitForSceneAssets(page);
  expect(await page.locator('#race').getAttribute('data-track-hash')).not.toBe(
    hash
  );
  await page.locator('#word-course-open').click();
  await page.locator('#course-word').fill(first!);
  await page.locator('#word-course-submit').click();
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute('data-track-hash', hash!);
});
