import { expect, test, type Page } from '@playwright/test';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
  toPublicDailyChallenge,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';

const generated = generateValidatedCircuit('showcase-3');
let fixture: ReturnType<typeof createDailyChallengeRecord> | undefined;
function recordFixture() {
  fixture ??= createDailyChallengeRecord({
    subredditId: 't5_uitest',
    day: '2026-11-12',
    createdAtMs: Date.parse('2026-11-12T12:00:00Z'),
    requestedSeed: 'showcase-3',
    generated,
  });
  return fixture;
}
async function pauseClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2031-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2031-01-01T00:00:01Z'));
}

test('a daily request deadline gives explicit reference practice and ignores a late daily response', async ({
  page,
}) => {
  const record = await recordFixture();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/trpc/dailyChallenge*', async (route) => {
    await gate;
    await route.fulfill({
      json: {
        result: {
          data: dailyChallengeView(record, record.startsAtMs + 3600_000),
        },
      },
    });
  });
  await pauseClock(page);
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#start-button')).toBeDisabled();
  await page.clock.runFor(10_010);
  await expect(page.locator('#mode-label')).toHaveText('REFERENCE · UNRANKED');
  await expect(page.locator('#start-label')).toHaveText('Start practice');
  await expect(page.locator('#start-button')).toBeEnabled();
  release();
  await page.clock.runFor(32);
  await expect(page.locator('#mode-label')).toHaveText('REFERENCE · UNRANKED');
  await expect(page.locator('#race')).not.toHaveAttribute('data-challenge-id');
});

test('a preparation deadline starts labelled practice on the saved track and a fresh retry can verify', async ({
  page,
}) => {
  const record = await recordFixture();
  let starts = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/trpc/dailyChallenge*', (route) =>
    route.fulfill({
      json: {
        result: {
          data: dailyChallengeView(record, record.startsAtMs + 3600_000),
        },
      },
    })
  );
  await page.route('**/api/trpc/startRankedRace*', async (route) => {
    const index = ++starts;
    if (index === 1) await gate;
    await route.fulfill({
      json: {
        result: {
          data: {
            sessionId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
            challengeId: record.id,
            challengeHash: record.challengeHash,
            trackHash: record.trackHash,
            simulationVersion: record.simulationVersion,
            handlingVersion: record.handlingVersion,
            serverNowMs: record.startsAtMs + 3600_000,
            expiresAtMs: record.startsAtMs + 3900_000,
          },
        },
      },
    });
  });
  await pauseClock(page);
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#start-label')).toHaveText('Race today');
  await expect(page.locator('#track-note')).not.toContainText('Sign in');
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(10_010);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await expect(page.locator('#verification-status')).toContainText(
    'unranked practice'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    record.trackHash
  );
  await page.keyboard.up('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  release();
  await page.clock.runFor(32);
  await page.locator('#retry-button').click();
  await expect(page.locator('#verification-status')).toHaveAttribute(
    'data-state',
    'ranked'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  expect(starts).toBe(2);
});

test('submission and standings deadlines settle independently without claiming a rejected run', async ({
  page,
}) => {
  const record = await recordFixture();
  const replay = generated.quality.fastReplay;
  if (!replay) throw new Error('Missing development fixture tape');
  let releases: Array<() => void> = [];
  for (const path of ['submitRun', 'getLeaderboard']) {
    await page.route(`**/api/trpc/${path}*`, async (route) => {
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      await route.fulfill({ json: { result: { data: null } } });
    });
  }
  await page.route('**/api/trpc/startRankedRace*', (route) =>
    route.fulfill({
      json: {
        result: {
          data: {
            sessionId: '00000000-0000-4000-8000-000000000001',
            challengeId: record.id,
            challengeHash: record.challengeHash,
            trackHash: record.trackHash,
            simulationVersion: record.simulationVersion,
            handlingVersion: record.handlingVersion,
            serverNowMs: record.startsAtMs + 3600_000,
            expiresAtMs: record.startsAtMs + 3900_000,
          },
        },
      },
    })
  );
  await pauseClock(page);
  await page.goto('/game.html');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  // Transport controller coverage avoids running another identical simulation lap.
  const submission = page.evaluate(
    async ({ challenge, replay }) => {
      const moduleUrl = '/ranked-client.ts';
      const { createRankedRaceHooks } = await import(moduleUrl);
      const hooks = createRankedRaceHooks(challenge, () => {});
      await hooks.beforeStart({
        attemptId: 1,
        signal: new AbortController().signal,
      });
      return hooks.onFinish({
        attemptId: 1,
        replay,
        finishTicks: replay.endTick,
      });
    },
    { challenge: toPublicDailyChallenge(record), replay }
  );
  await expect.poll(() => releases.length).toBe(1);
  await page.clock.runFor(10_010);
  expect((await submission).status).toBe('unavailable');
  await page.evaluate(async (challenge) => {
    const moduleUrl = '/leaderboard-client.ts';
    const { createLeaderboardController } = await import(moduleUrl);
    const board = createLeaderboardController(challenge);
    board.onAttemptStart({ attemptId: 1 });
    board.onResults({ attemptId: 1, mode: 'practice' });
  }, toPublicDailyChallenge(record));
  await expect.poll(() => releases.length).toBe(2);
  await page.clock.runFor(10_010);
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'error'
  );
  await page.locator('#leaderboard-title').click();
  await expect(page.locator('#leaderboard-refresh')).toBeEnabled();
  for (const release of releases) release();
  releases = [];
});

test('an archived course offers explicit current-post navigation and expires its ready link at UTC reset', async ({
  page,
}) => {
  const record = await recordFixture();
  let calls = 0;
  let rankedStarts = 0;
  await page.route('**/api/trpc/startRankedRace*', async (route) => {
    rankedStarts++;
    await route.abort();
  });
  let releaseLate = () => {};
  const lateGate = new Promise<void>((resolve) => {
    releaseLate = resolve;
  });
  await page.route('**/api/trpc/dailyChallenge*', (route) =>
    route.fulfill({
      json: {
        result: {
          data: dailyChallengeView(record, record.endsAtMs + 3600_000),
        },
      },
    })
  );
  await page.route('**/api/trpc/todayRacePost*', async (route) => {
    calls++;
    expect(new URL(route.request().url()).searchParams.has('input')).toBe(
      false
    );
    const serverNowMs =
      calls === 1
        ? record.endsAtMs + 3600_000
        : calls === 2
          ? record.endsAtMs + 86400_000 - 2000
          : calls === 4
            ? record.endsAtMs + 2 * 86400_000 - 1000
            : record.endsAtMs + 86400_000 + 3600_000;
    if (calls === 4) await lateGate;
    return route.fulfill({
      json: {
        result: {
          data: {
            schemaVersion: 1,
            currentDay: calls < 3 ? '2026-11-13' : '2026-11-14',
            serverNowMs,
            nextResetAtMs: record.endsAtMs + (calls < 3 ? 1 : 2) * 86400_000,
            status: calls === 1 ? 'not-ready' : 'ready',
            post:
              calls === 1
                ? null
                : {
                    postId: calls === 2 ? 't3_day13' : 't3_day14',
                    url: `https://www.reddit.com/comments/${calls === 2 ? 'day13' : 'day14'}/`,
                  },
          },
        },
      },
    });
  });
  await pauseClock(page);
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#today-race')).toHaveAttribute(
    'data-state',
    'not-ready'
  );
  await expect(page.locator('#start-label')).toHaveText('Start practice');
  await expect(page.locator('#today-race-status')).toContainText(
    'not ready yet'
  );
  await page.locator('#today-race-refresh').click();
  await expect(page.locator('#today-race-button')).toBeVisible();
  expect(calls).toBe(2);
  await page.clock.runFor(2100);
  await expect(page.locator('#today-race-button')).toBeHidden();
  await expect(page.locator('#today-race-status')).toContainText('new UTC day');
  expect(calls).toBe(2);
  await page.locator('#today-race-refresh').click();
  await expect(page.locator('#today-race-button')).toBeVisible();
  const navigation = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        addEventListener('message', (event) => {
          if (
            event.data?.type === 'devvit-internal' &&
            event.data?.navigateToUrl?.url
          )
            resolve(event.data.navigateToUrl.url);
        });
      })
  );
  await page.locator('#today-race-button').click();
  expect(await navigation).toBe('https://www.reddit.com/comments/day14/');
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    record.trackHash
  );
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await page.reload();
  await expect(page.locator('#today-race')).toHaveAttribute(
    'data-state',
    'loading'
  );
  await page.clock.runFor(1100);
  releaseLate();
  await expect(page.locator('#today-race')).toHaveAttribute(
    'data-state',
    'not-ready'
  );
  await expect(page.locator('#today-race-button')).toBeHidden();
  await expect(page.locator('#today-race-status')).toContainText(
    'UTC day changed while checking'
  );
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await expect(page.locator('#verification-status')).toContainText(
    'unranked practice'
  );
  expect(rankedStarts).toBe(0);
});
