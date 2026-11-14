import { expect, test, type Page } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
  type DailyChallengeRecord,
} from '../../src/shared/daily-challenge.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';

let storedFixture: Promise<DailyChallengeRecord> | undefined;
function recordFixture(): Promise<DailyChallengeRecord> {
  storedFixture ??= createDailyChallengeRecord({
    subredditId: 't5_dailytest',
    day: '2026-11-12',
    createdAtMs: Date.parse('2026-11-12T12:00:00Z'),
    requestedSeed: 'showcase-3',
    generated: generateElevatedCircuit('showcase-3'),
  });
  return storedFixture;
}

async function interceptDaily(
  page: Page,
  data: unknown
): Promise<() => number> {
  let calls = 0;
  await page.context().route('**/api/trpc/todayRacePost*', (route) =>
    route.fulfill({
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
    })
  );
  await page.context().route('**/api/trpc/dailyChallenge*', async (route) => {
    calls++;
    await route.fulfill({ json: { result: { data } } });
  });
  await page.context().route('**/api/trpc/startRankedRace*', async (route) => {
    await route.fulfill({
      json: {
        error: {
          message: 'Signed out in daily transport fixture',
          code: -32001,
          data: { code: 'UNAUTHORIZED', httpStatus: 401 },
        },
      },
    });
  });
  return () => calls;
}

test('daily loading disables Start until the saved canonical course is ready', async ({
  page,
}) => {
  const record = await recordFixture();
  const view = dailyChallengeView(record, Date.parse('2026-11-12T18:00:00Z'));
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/trpc/dailyChallenge*', async (route) => {
    await gate;
    await route.fulfill({ json: { result: { data: view } } });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'loading');
  await expect(page.locator('#start-button')).toBeDisabled();
  release();
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#start-button')).toBeEnabled();
  await expect(page.locator('#mode-label')).toHaveText('Daily');
  await expect(page.locator('#daily-date')).toHaveText('2026-11-12 · UTC');
  await expect(page.locator('#daily-reset')).toContainText('UTC reset in');
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    record.trackHash
  );
  await page.screenshot({
    path: `test-results/daily-current-${test.info().project.name}.png`,
  });
  expect(errors).toEqual([]);
});

test('two views receive identical stored geometry while local query selectors cannot replace it', async ({
  page,
}) => {
  const record = await recordFixture();
  const view = dailyChallengeView(record, Date.parse('2026-11-12T18:00:00Z'));
  const calls = await interceptDaily(page, view);
  const other = await page.context().newPage();
  await Promise.all([
    page.goto(
      '/game.html?daily=1&seed=ignored-local-seed&day=2031-01-01&postId=t3_fake'
    ),
    other.goto('/game.html?daily=1'),
  ]);
  for (const tab of [page, other]) {
    await expect(tab.locator('#race')).toHaveAttribute('data-phase', 'ready');
    await expect(tab.locator('#race')).toHaveAttribute(
      'data-challenge-id',
      record.id
    );
    await expect(tab.locator('#race')).toHaveAttribute(
      'data-challenge-hash',
      record.challengeHash
    );
    await expect(tab.locator('#race')).toHaveAttribute(
      'data-track-hash',
      record.trackHash
    );
    expect(await tab.locator('#lap-progress').getAttribute('max')).toBe(
      String(record.track.totalLength)
    );
  }
  expect(calls()).toBe(2);
  await other.close();
});

test('old posts retain their original day and course as unranked practice', async ({
  page,
}) => {
  const record = await recordFixture();
  await interceptDaily(
    page,
    dailyChallengeView(record, Date.parse('2026-11-13T12:00:00Z'))
  );
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#mode-label')).toHaveText('Archive');
  await expect(page.locator('#daily-date')).toHaveText('2026-11-12 · UTC');
  await expect(page.locator('#daily-reset')).toHaveText(
    'Archived course · practice'
  );
  await expect(page.locator('#start-button')).toBeEnabled();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-challenge-hash',
    record.challengeHash
  );
  await page.screenshot({
    path: `test-results/daily-archive-${test.info().project.name}.png`,
  });
});

test('server UTC expiry changes messaging without replacing an in-flight circuit or retry', async ({
  page,
}) => {
  const record = await recordFixture();
  const calls = await interceptDaily(
    page,
    dailyChallengeView(record, record.endsAtMs - 65_000)
  );
  // Deliberately unrelated browser date: the server response determines the daily window.
  await page.clock.install({ time: new Date('2031-01-01T00:00:00Z') });
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2031-01-01T00:01:00Z'));
  await expect(page.locator('#mode-label')).toHaveText('Daily');
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await page.keyboard.down('Space');
  await page.clock.runFor(7000);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#mode-label')).toHaveText('Archive');
  await expect(page.locator('#daily-date')).toHaveText('2026-11-12 · UTC');
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    record.trackHash
  );
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Space');
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-challenge-hash',
    record.challengeHash
  );
  await page.clock.runFor(32);
  await expect(page.locator('#timer')).toHaveText('00.000');
  expect(calls()).toBe(1);
});

test('daily service failure offers explicitly labelled unranked reference practice', async ({
  page,
}) => {
  await page.route('**/api/trpc/dailyChallenge*', async (route) => {
    await route.fulfill({
      json: {
        error: {
          message: 'Temporarily unavailable',
          code: -32603,
          data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
        },
      },
    });
  });
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#mode-label')).toHaveText('Practice');
  await expect(page.locator('#track-source')).toHaveAttribute(
    'data-mode',
    'reference-fallback'
  );
  await expect(page.locator('#card-copy')).toHaveText('Practice is available.');
  await expect(page.locator('#daily-details')).toBeHidden();
  await expect(page.locator('#start-button')).toBeEnabled();
  expect(
    await page.locator('#race').getAttribute('data-challenge-id')
  ).toBeNull();
});

test('unsupported or corrupt successful responses keep Start disabled without substituting geometry', async ({
  page,
}) => {
  const record = await recordFixture();
  const view = dailyChallengeView(record, Date.parse('2026-11-12T18:00:00Z'));
  await interceptDaily(page, {
    ...view,
    challenge: {
      ...view.challenge,
      simulationVersion: 'unsupported-future-version',
    },
  });
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#track-source')).toHaveAttribute(
    'data-state',
    'rejected'
  );
  await expect(page.locator('#start-button')).toBeDisabled();
  await expect(page.locator('#error')).toContainText('could not be verified');
  expect(
    await page.locator('#race').getAttribute('data-challenge-id')
  ).toBeNull();
});

test('stored-record precondition failures never become substitute daily geometry', async ({
  page,
}) => {
  await page.route('**/api/trpc/dailyChallenge*', async (route) => {
    await route.fulfill({
      json: {
        error: {
          message: 'Stored rules are unsupported',
          code: -32012,
          data: { code: 'PRECONDITION_FAILED', httpStatus: 412 },
        },
      },
    });
  });
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#track-source')).toHaveAttribute(
    'data-state',
    'rejected'
  );
  await expect(page.locator('#start-button')).toBeDisabled();
  await expect(page.locator('#error')).toContainText('could not be verified');
});

test('splash reads only small server-created date metadata and stays lightweight', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.addInitScript(() => {
    Object.assign(globalThis, {
      devvit: {
        context: {
          postData: {
            challengeSchema: 1,
            challengeDay: '2026-11-12',
            challengeHash: 'public-summary',
          },
        },
      },
    });
  });
  await page.goto('/splash.html');
  await expect(page.locator('#splash-date')).toHaveText(
    '2026-11-12 · UTC CIRCUIT'
  );
  await expect(page.locator('#start-button')).toBeEnabled();
  expect(
    requests.some((url) =>
      /dailyChallenge|game-scene|three|circuit-quality/.test(url)
    )
  ).toBe(false);
});
