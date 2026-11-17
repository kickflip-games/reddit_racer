import { expect, test } from '@playwright/test';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { setRaceSettingsOpen, waitForSceneAssets } from './scene-ready.ts';

for (const archived of [false, true]) {
  test(`@smoke shared settings persist across ${archived ? 'archived' : 'current'} daily and word tracks`, async ({
    page,
  }) => {
    const record = await createDailyChallengeRecord({
      subredditId: 't5_settings',
      day: '2026-11-12',
      createdAtMs: Date.parse('2026-11-12T12:00:00Z'),
      requestedSeed: 'practice-1',
      generated: generateElevatedCircuit('practice-1'),
    });
    const now = Date.parse(
      archived ? '2026-11-13T12:00:00Z' : '2026-11-12T12:00:00Z'
    );
    await page.route('**/api/trpc/dailyChallenge*', (route) =>
      route.fulfill({
        json: { result: { data: dailyChallengeView(record, now) } },
      })
    );
    await page.route('**/api/trpc/todayRacePost*', (route) =>
      route.fulfill({
        json: {
          result: {
            data: {
              schemaVersion: 1,
              currentDay: '2026-11-13',
              serverNowMs: now,
              nextResetAtMs: Date.parse('2026-11-14T00:00:00Z'),
              status: 'not-ready',
              post: null,
            },
          },
        },
      })
    );
    const rankingCalls: string[] = [];
    await page.route('**/api/trpc/startRankedRace*', (route) => {
      rankingCalls.push(route.request().url());
      return route.abort();
    });
    await page.goto('/game.html?daily=1');
    await waitForSceneAssets(page);
    await setRaceSettingsOpen(page, true);
    await expect(page.locator('#ghost-toggle')).toBeVisible();
    await expect(page.locator('#course-word')).toBeVisible();
    await expect(page.locator('#daily-mode-button')).toBeHidden();
    await expect(page.locator('#daily-reset')).toContainText(
      archived ? 'Archived course' : 'UTC reset'
    );
    await page.locator('#sound-toggle').click();
    await page.locator('#ghost-toggle').click();
    await page.locator('#course-word').fill('banana');
    await page.locator('#word-course-submit').click();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-play-mode',
      'practice'
    );
    await waitForSceneAssets(page);
    await expect(page.locator('#settings-dialog')).not.toBeVisible();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-ghost-best-ticks',
      ''
    );
    await setRaceSettingsOpen(page, true);
    await expect(page.locator('#sound-toggle')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(page.locator('#ghost-toggle')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await page.locator('#daily-mode-button').click();
    await waitForSceneAssets(page);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-track-hash',
      record.trackHash
    );
    await page.reload();
    await waitForSceneAssets(page);
    await setRaceSettingsOpen(page, true);
    await expect(page.locator('#sound-toggle')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await expect(page.locator('#ghost-toggle')).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    await page.screenshot({
      path: `test-results/shared-settings-${archived}-${test.info().project.name}.png`,
    });
    await setRaceSettingsOpen(page, false);
    await setRaceSettingsOpen(page, true);
    await setRaceSettingsOpen(page, false);
    expect(rankingCalls).toEqual([]);
  });
}

test('practice settings keep only essential copy and preserve seed errors', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/game.html?practice=1&word=banana');
  await waitForSceneAssets(page);
  await setRaceSettingsOpen(page, true);
  const dialog = page.locator('#settings-dialog');
  await expect(page.locator('#course-word')).toHaveValue('banana');
  await expect(dialog).not.toContainText('Current seed:');
  await expect(dialog).not.toContainText('Seeds recreate');
  await expect(dialog).not.toContainText('depends on your device');
  await expect(page.locator('#word-course-message')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Share track', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Copy seed', exact: true })
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/concise-settings-${test.info().project.name}.png`,
  });
  await page.locator('#course-word').fill('!!!');
  await page.locator('#word-course-submit').click();
  await expect(page.locator('#word-course-message')).toBeVisible();
  await expect(page.locator('#word-course-message')).not.toHaveText('');
  await expect(page.locator('#course-word')).toBeFocused();
  await page.locator('#course-word').fill('apple');
  await page.locator('#word-course-submit').click();
  await waitForSceneAssets(page);
  await expect(dialog).toBeHidden();
  await setRaceSettingsOpen(page, true);
  await expect(page.locator('#course-word')).toHaveValue('apple');
  await expect(page.locator('#word-course-message')).toBeHidden();
  await page.locator('#settings-close').click();
  await expect(dialog).toBeHidden();
});
