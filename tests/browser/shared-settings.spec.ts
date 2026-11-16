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
