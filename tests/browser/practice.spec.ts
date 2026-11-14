import { expect, test, type Page } from '@playwright/test';
import { createPracticeDriver } from '../../src/client/practice-driver.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
  toPublicDailyChallenge,
  type DailyChallengeRecord,
} from '../../src/shared/daily-challenge.ts';
import type { LeaderboardView } from '../../src/shared/leaderboard.ts';
import { hashTrack } from '../../src/shared/track.ts';
import {
  setRaceSettingsOpen,
  waitForSceneAssets,
  openPracticeModes,
} from './scene-ready.ts';

const seed = 'practice-1';
const generated = generateElevatedCircuit(seed);
const tickMs = 1000 / 120;
const control = createPracticeDriver(generated.track);
control.start(0);
control.setInput(true, 0);
const boundaries: { time: number; lapTicks: number }[] = [];
for (let tick = 1; tick <= 14_400 && boundaries.length < 2; tick++) {
  control.advance(tick * tickMs);
  if (control.completedLaps > boundaries.length) {
    if (control.lastLapTicks === null) throw new Error('Missing control lap');
    boundaries.push({ time: tick * tickMs, lapTicks: control.lastLapTicks });
  }
}
const first = boundaries[0];
const second = boundaries[1];
if (!first || !second)
  throw new Error('Practice control did not finish two laps');
let stored: Promise<DailyChallengeRecord> | undefined;
function dailyRecord(): Promise<DailyChallengeRecord> {
  stored ??= createDailyChallengeRecord({
    subredditId: 't5_practicebrowser',
    day: '2026-11-12',
    createdAtMs: Date.parse('2026-11-12T12:00:00Z'),
    requestedSeed: seed,
    generated,
  });
  return stored;
}
function errorsOn(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}
async function ready(page: Page): Promise<void> {
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#start-button')).toBeEnabled();
  await waitForSceneAssets(page);
}
async function elapsed(page: Page, epoch: number, milliseconds: number) {
  const now = await page.evaluate(() => performance.now());
  await page.clock.runFor(Math.max(0, epoch + milliseconds - now));
}

test('one hold drives two procedural practice laps without a stop, countdown or ranked request', async ({
  page,
}) => {
  // Two actual rendered laps use a compact supported viewport to bound software rendering.
  await page.setViewportSize({ width: 320, height: 320 });
  const errors = errorsOn(page);
  const apiCalls: string[] = [];
  await page.route('**/api/trpc/**', async (route) => {
    apiCalls.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 500,
      json: { error: 'Unexpected practice API' },
    });
  });
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto(`/game.html?practice=1&seed=${seed}`);
  await ready(page);
  const hash = await hashTrack(generated.track);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-play-mode',
    'practice'
  );
  await expect(page.locator('#race')).toHaveAttribute('data-track-hash', hash);
  await expect(page.locator('#practice-seed')).toHaveAttribute(
    'data-seed',
    seed
  );
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  const epoch = await page.evaluate(() => performance.now());
  await elapsed(page, epoch, first.time - 64);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-practice-laps',
    '0'
  );
  expect(
    Number(
      await page.locator('#minimap-progress').getAttribute('aria-valuenow')
    )
  ).toBeGreaterThanOrEqual(99);
  expect(
    Number(
      await page.locator('#minimap-completed').getAttribute('stroke-dashoffset')
    )
  ).toBeLessThan(0.01);
  const approachingSpeed = Number(await page.locator('#speed').textContent());
  await elapsed(page, epoch, first.time + 32);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-practice-laps',
    '1'
  );
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await expect(page.locator('#card')).toBeHidden();
  await expect(page.locator('#race-countdown')).toBeHidden();
  await expect(page.locator('#practice-last-lap')).toHaveText(
    `Last ${(first.lapTicks / 120).toFixed(3).padStart(6, '0')}`
  );
  expect(Number(await page.locator('#timer').textContent())).toBeLessThan(0.06);
  await expect(page.locator('#circuit-minimap')).toBeVisible();
  await expect(page.locator('#minimap-progress')).toHaveAttribute(
    'aria-valuenow',
    '0'
  );
  await expect(page.locator('#minimap-progress')).toHaveAttribute(
    'aria-valuetext',
    'Lap 2, 0% complete'
  );
  expect(
    Number(
      await page.locator('#minimap-completed').getAttribute('stroke-dashoffset')
    )
  ).toBeGreaterThan(0.99);
  expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(
    approachingSpeed * 0.8
  );
  await elapsed(page, epoch, second.time + 32);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-practice-laps',
    '2'
  );
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await expect(page.locator('#practice-last-lap')).toHaveText(
    `Last ${(second.lapTicks / 120).toFixed(3).padStart(6, '0')}`
  );
  await expect(page.locator('#race')).toHaveAttribute('data-track-hash', hash);
  await expect(page.locator('#leaderboard')).toBeHidden();
  await expect(page.locator('#result-summary')).toBeHidden();
  await page.screenshot({
    path: `test-results/practice-two-laps-${test.info().project.name}.png`,
  });
  await page.keyboard.up('Space');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('New track changes unranked geometry and returning Daily restores the immutable course with one live input handler', async ({
  page,
}) => {
  const errors = errorsOn(page);
  const record = await dailyRecord();
  let dailyCalls = 0;
  let starts = 0;
  const otherCalls: string[] = [];
  await page.route('**/api/trpc/**', async (route) => {
    const method = new URL(route.request().url()).pathname.split('/').at(-1);
    if (method === 'dailyChallenge') {
      dailyCalls++;
      await route.fulfill({
        json: {
          result: {
            data: dailyChallengeView(record, record.startsAtMs + 60_000),
          },
        },
      });
    } else if (method === 'startRankedRace') {
      starts++;
      await route.fulfill({
        json: {
          error: {
            message: 'API FIXTURE: signed out',
            code: -32001,
            data: { code: 'UNAUTHORIZED', httpStatus: 401 },
          },
        },
      });
    } else {
      otherCalls.push(method ?? 'unknown');
      await route.fulfill({
        status: 500,
        json: { error: 'Unexpected practice API' },
      });
    }
  });
  await page.goto('/game.html?daily=1');
  await ready(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    record.trackHash
  );
  await openPracticeModes(page);
  await page.locator('#practice-button').click();
  await ready(page);
  const practiceHash = await page
    .locator('#race')
    .getAttribute('data-track-hash');
  const practiceSeed = await page
    .locator('#practice-seed')
    .getAttribute('data-seed');
  expect(practiceHash).toBeTruthy();
  await setRaceSettingsOpen(page, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-toggle')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.locator('#next-practice-button').click();
  await ready(page);
  expect(await page.locator('#race').getAttribute('data-track-hash')).not.toBe(
    practiceHash
  );
  expect(
    await page.locator('#practice-seed').getAttribute('data-seed')
  ).not.toBe(practiceSeed);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-practice-laps',
    '0'
  );
  await expect(page.locator('#timer')).toHaveText('00.000');
  await setRaceSettingsOpen(page, true);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-reduced-motion',
    'true'
  );
  await expect(page.locator('#sound-toggle')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.locator('#daily-mode-button').click();
  await ready(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-play-mode',
    'daily'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    record.trackHash
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-challenge-hash',
    record.challengeHash
  );
  await openPracticeModes(page);
  await page.locator('#practice-button').click();
  await ready(page);
  await setRaceSettingsOpen(page, true);
  await page.locator('#daily-mode-button').click();
  await ready(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    record.trackHash
  );
  await expect(page.locator('#practice-settings')).toBeHidden();
  await expect(page.locator('#practice-last-lap')).toBeHidden();
  expect(dailyCalls).toBe(3);
  expect(starts).toBe(0);
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  expect(starts).toBe(1);
  expect(otherCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('practice interruption releases the hold and requires an explicit resume while settings survive track changes', async ({
  page,
}) => {
  const errors = errorsOn(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto(`/game.html?practice=1&seed=${seed}`);
  await ready(page);
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
  await setRaceSettingsOpen(page, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#sound-toggle').click();
  await setRaceSettingsOpen(page, false);
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(3300);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await page.setViewportSize({ width: 319, height: 320 });
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'abandoned'
  );
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  const stopped = await page.locator('#timer').textContent();
  await page.clock.runFor(100);
  await expect(page.locator('#timer')).toHaveText(stopped ?? '');
  await page.keyboard.up('Space');
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator('#card-title')).toBeFocused();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'abandoned'
  );
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await expect(page.locator('#timer')).toHaveText('00.000');
  await expect(page.locator('#race')).toHaveAttribute(
    'data-practice-laps',
    '0'
  );
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await setRaceSettingsOpen(page, true);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-reduced-motion',
    'true'
  );
  await expect(page.locator('#sound-toggle')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  expect(errors).toEqual([]);
});

test('API FIXTURE disposed daily controllers remove native actions and cannot clear their replacements', async ({
  page,
}) => {
  const record = await dailyRecord();
  const challenge = toPublicDailyChallenge(record);
  const errors = errorsOn(page);
  let boardCalls = 0;
  let todayCalls = 0;
  const board: LeaderboardView = {
    challengeId: record.id,
    challengeHash: record.challengeHash,
    day: record.day,
    simulationHz: 120,
    serverNowMs: record.startsAtMs + 60_000,
    retainedUntilMs: record.endsAtMs + 90 * 86400_000,
    status: 'available',
    viewer: 'signed-out',
    top: [],
    me: null,
    nearby: [],
    outcome: null,
  };
  await page.route('**/api/trpc/getLeaderboard*', (route) => {
    boardCalls++;
    return route.fulfill({ json: { result: { data: board } } });
  });
  await page.route('**/api/trpc/todayRacePost*', (route) => {
    todayCalls++;
    return route.fulfill({
      json: {
        result: {
          data: {
            schemaVersion: 1,
            currentDay: '2026-11-13',
            serverNowMs: Date.parse('2026-11-13T12:00:00Z'),
            nextResetAtMs: Date.parse('2026-11-14T00:00:00Z'),
            status: 'not-ready',
            post: null,
          },
        },
      },
    });
  });
  await page.route('**/practice-controller-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>API FIXTURE</title><h1>API FIXTURE · controller lifetime, no race or score</h1><div id="card"><div id="result-summary" hidden><p id="leaderboard-me"></p><p id="leaderboard-outcome"></p><p id="result-target"></p></div><section id="leaderboard" hidden><p id="leaderboard-day"></p><p id="leaderboard-status"></p><details id="leaderboard-details"><summary>Standings</summary><button id="leaderboard-refresh">Refresh standings</button><div id="leaderboard-top"><table><tbody></tbody></table></div><div id="leaderboard-nearby"><table><tbody></tbody></table></div></details></section><section id="today-race" hidden><p id="today-race-status"></p><button id="today-race-button" hidden>Today</button><button id="today-race-refresh" hidden>Check today</button></section></div>',
    })
  );
  await page.goto('/practice-controller-fixture.html');
  await page.evaluate(async (daily) => {
    const boardUrl = '/leaderboard-client.ts';
    const todayUrl = '/today-race-client.ts';
    const {
      createLeaderboardController,
    }: typeof import('../../src/client/leaderboard-client.ts') = await import(
      boardUrl
    );
    const {
      createTodayRaceController,
    }: typeof import('../../src/client/today-race-client.ts') = await import(
      todayUrl
    );
    for (let cycle = 0; cycle < 20; cycle++) {
      const previousBoard = createLeaderboardController(daily);
      const previousToday = createTodayRaceController(daily.day);
      previousBoard.dispose();
      previousBoard.dispose();
      previousToday.dispose();
      previousToday.dispose();
      previousBoard.onResults({ attemptId: 0, mode: 'practice' });
      previousToday.updateArchived(true);
    }
    const previousBoard = createLeaderboardController(daily);
    const previousToday = createTodayRaceController(daily.day);
    const nextBoard = createLeaderboardController(daily);
    const nextToday = createTodayRaceController(daily.day);
    nextBoard.onAttemptStart({ attemptId: 1 });
    nextBoard.onResults({ attemptId: 1, mode: 'practice' });
    nextToday.updateArchived(true);
    previousBoard.dispose();
    previousToday.dispose();
  }, challenge);
  await expect(page.locator('#leaderboard')).toBeVisible();
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'empty'
  );
  await expect(page.locator('#today-race')).toBeVisible();
  await expect(page.locator('#today-race')).toHaveAttribute(
    'data-state',
    'not-ready'
  );
  expect(boardCalls).toBe(1);
  expect(todayCalls).toBe(1);
  await page.locator('#leaderboard-details').evaluate((node) => {
    if (!(node instanceof HTMLDetailsElement))
      throw new Error('Missing fixture disclosure');
    node.open = true;
  });
  await page.locator('#leaderboard-refresh').click();
  await expect.poll(() => boardCalls).toBe(2);
  await page.locator('#today-race-refresh').click();
  await expect.poll(() => todayCalls).toBe(2);
  expect(errors).toEqual([]);
});
