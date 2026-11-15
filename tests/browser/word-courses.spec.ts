import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';
test('Other tracks accepts a word, preserves versioned identity and mobile settings usability', async ({
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
    'v1:banana'
  );
  const banana = await page.locator('#race').getAttribute('data-track-hash');
  await page.locator('#word-course-open').click();
  await expect(page.locator('#course-word')).toBeFocused();
  await expect(page.locator('#course-word')).toHaveValue('v1:banana');
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
    'not supported'
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
    'v2:apple'
  );
  expect(await page.locator('#race').getAttribute('data-track-hash')).not.toBe(
    banana
  );
  await expect(page.locator('#practice-best-lap')).toHaveText('Best —');
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
test('unsupported word link is explicit and can recover through the word form', async ({
  page,
}) => {
  await page.goto('/game.html?practice=1&word=banana&wordVersion=99');
  await expect(page.locator('#error')).toContainText('not supported');
  await page.locator('#word-course-open').click();
  await page.locator('#course-word').fill('banana');
  await page.locator('#word-course-submit').click();
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-word-code',
    'v2:banana'
  );
});

test('random Other tracks and New track expose reusable v2 codes', async ({
  page,
}) => {
  await page.goto('/game.html?practice=1');
  await waitForSceneAssets(page);
  const first = await page.locator('#race').getAttribute('data-word-code');
  expect(first).toMatch(/^v2:/);
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
