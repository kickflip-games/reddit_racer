import { expect, test, type Page, type Route } from '@playwright/test';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
  toPublicDailyChallenge,
  type DailyChallengeRecord,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import type { LeaderboardView } from '../../src/shared/leaderboard.ts';
import {
  parseRankedSubmission,
  type StartRankedRaceResponse,
  type VerifiedRunResponse,
} from '../../src/shared/ranked-race.ts';
import { runReplay } from '../../src/shared/replay.ts';
import { SIMULATION_HZ } from '../../src/shared/simulation.ts';

const generated = generateValidatedCircuit('showcase-3');
const controlReplay = generated.quality.fastReplay;
if (!controlReplay)
  throw new Error('Expected a checked development input tape');
const replay = controlReplay;
const sessionId = '00000000-0000-4000-8000-000000000001';
let fixture: Promise<DailyChallengeRecord> | undefined;
function dailyRecord(): Promise<DailyChallengeRecord> {
  fixture ??= createDailyChallengeRecord({
    subredditId: 't5_leaderboardtest',
    day: '2026-11-12',
    createdAtMs: Date.parse('2026-11-12T12:00:00Z'),
    requestedSeed: 'showcase-3',
    generated,
  });
  return fixture;
}

function board(record: DailyChallengeRecord): LeaderboardView {
  return {
    challengeId: record.id,
    challengeHash: record.challengeHash,
    day: record.day,
    simulationHz: 120,
    serverNowMs: record.startsAtMs + 18 * 3600_000 + 120_000,
    retainedUntilMs: record.endsAtMs + 90 * 86400_000,
    status: 'available',
    viewer: 'signed-in',
    top: [],
    me: null,
    nearby: [],
    outcome: null,
  };
}

function startResponse(
  record: DailyChallengeRecord,
  index = 1
): StartRankedRaceResponse {
  const serverNowMs = record.startsAtMs + 18 * 3600_000;
  return {
    sessionId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    challengeId: record.id,
    challengeHash: record.challengeHash,
    trackHash: record.trackHash,
    simulationVersion: record.simulationVersion,
    handlingVersion: record.handlingVersion,
    expiresAtMs: serverNowMs + 300_000,
    serverNowMs,
  };
}

async function serviceError(route: Route): Promise<void> {
  await route.fulfill({
    json: {
      error: {
        message: 'Mock leaderboard service unavailable',
        code: -32603,
        data: { code: 'SERVICE_UNAVAILABLE', httpStatus: 503 },
      },
    },
  });
}

async function driveFast(page: Page): Promise<void> {
  await page.keyboard.down('Space');
  await page.clock.runFor(3000);
  await page.keyboard.down('Space');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  const epoch = await page.evaluate(() => performance.now());
  for (const transition of replay.transitions.slice(1)) {
    const now = await page.evaluate(() => performance.now());
    await page.clock.runFor(
      Math.max(0, epoch + (transition.tick * 1000) / SIMULATION_HZ - now)
    );
    if (transition.held) await page.keyboard.down('Space');
    else await page.keyboard.up('Space');
  }
  const now = await page.evaluate(() => performance.now());
  await page.clock.runFor(
    Math.max(0, epoch + (replay.endTick * 1000) / SIMULATION_HZ - now)
  );
  await page.keyboard.up('Space');
  await page.clock.runFor(32);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'finished');
}

test('a real verified lap displays server PB and tied ranks, survives a board failure, and clears stale results on retry', async ({
  page,
}) => {
  const record = await dailyRecord();
  const view = board(record);
  // The current PB can be faster than this run's immutable commit snapshot.
  const currentBestTicks = replay.endTick - 60;
  const self = {
    username: 'DailyDriver',
    finishTicks: currentBestTicks,
    rank: 3,
    isSelf: true,
  };
  view.top = [
    {
      username: 'Apex',
      finishTicks: currentBestTicks - 60,
      rank: 1,
      isSelf: false,
    },
    {
      username: 'Braker',
      finishTicks: currentBestTicks - 60,
      rank: 1,
      isSelf: false,
    },
    self,
  ];
  view.me = self;
  view.nearby = view.top;
  view.outcome = {
    sessionId,
    previousBestTicks: replay.endTick + 120,
    personalBestTicks: replay.endTick,
    isPersonalBest: true,
    improvementTicks: 120,
  };
  let starts = 0;
  let boardCalls = 0;
  let releaseVerification = (): void => {};
  const verificationGate = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  let releaseBoard = (): void => {};
  const boardGate = new Promise<void>((resolve) => {
    releaseBoard = resolve;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/trpc/dailyChallenge*', (route) =>
    route.fulfill({
      json: { result: { data: dailyChallengeView(record, view.serverNowMs) } },
    })
  );
  await page.route('**/api/trpc/startRankedRace*', (route) => {
    starts++;
    return route.fulfill({
      json: { result: { data: startResponse(record, starts) } },
    });
  });
  await page.route('**/api/trpc/submitRun*', async (route) => {
    const submission = parseRankedSubmission(route.request().postDataJSON());
    expect(submission.replay).toEqual(replay);
    const checked = runReplay(record.track, submission.replay);
    await verificationGate;
    await route.fulfill({
      json: {
        result: {
          data: {
            sessionId,
            challengeId: record.id,
            challengeHash: record.challengeHash,
            finishTicks: checked.finishTicks,
            simulationHz: 120,
            finishTimeMs: (checked.finishTicks * 1000) / 120,
            verifiedAtMs: startResponse(record).serverNowMs + 60_000,
          },
        },
      },
    });
  });
  await page.route('**/api/trpc/getLeaderboard*', async (route) => {
    boardCalls++;
    const input: unknown = JSON.parse(
      new URL(route.request().url()).searchParams.get('input') ?? 'null'
    );
    expect(input).toEqual({ sessionId });
    if (boardCalls === 2) {
      await serviceError(route);
      return;
    }
    if (boardCalls === 3) await boardGate;
    await route.fulfill({ json: { result: { data: view } } });
  });
  await page.clock.install({ time: new Date('2031-01-01T00:00:00Z') });
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await page.clock.pauseAt(new Date('2031-01-01T00:01:00Z'));
  expect(boardCalls).toBe(0);
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await driveFast(page);
  await expect(page.locator('#verification-status')).toHaveAttribute(
    'data-state',
    'pending'
  );
  await expect(page.locator('#leaderboard')).toBeHidden();
  expect(boardCalls).toBe(0);
  releaseVerification();
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'ready'
  );
  await expect(page.locator('#card-kicker')).toHaveText('VERIFIED TIME');
  await expect(page.locator('#leaderboard-outcome')).toContainText(
    'improved your daily best by 1.000s'
  );
  await expect(page.locator('#leaderboard-outcome')).toContainText(
    `${(replay.endTick / 120).toFixed(3)}s`
  );
  await expect(page.locator('#leaderboard-me')).toHaveText(
    `Your current best: ${(currentBestTicks / 120).toFixed(3)}s · #3`
  );
  await expect(
    page.locator('#leaderboard-top tbody tr td:first-child')
  ).toHaveText(['1', '1', '3']);
  await expect(
    page.locator('#leaderboard-nearby tr[data-self=true]')
  ).toHaveCount(1);
  await expect(page.locator('#retry-button')).toBeInViewport();
  expect(await page.locator('html').innerHTML()).not.toContain(sessionId);
  await page.screenshot({
    path: `test-results/leaderboard-mock-${test.info().project.name}.png`,
  });
  await page.locator('#leaderboard-refresh').click();
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'error'
  );
  await expect(page.locator('#verification-status')).toHaveAttribute(
    'data-state',
    'verified'
  );
  await expect(page.locator('#leaderboard-outcome')).toBeHidden();
  await page.locator('#leaderboard-refresh').click();
  await expect.poll(() => boardCalls).toBe(3);
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'loading'
  );
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  releaseBoard();
  await page.clock.runFor(32);
  await expect(page.locator('#leaderboard')).toBeHidden();
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'idle'
  );
  expect(starts).toBe(2);
  expect(boardCalls).toBe(3);
  expect(errors).toEqual([]);
});

test('the standalone results controller honestly renders empty, signed-out, expired and mismatched-course responses', async ({
  page,
}) => {
  const record = await dailyRecord();
  let calls = 0;
  await page.route('**/api/trpc/getLeaderboard*', async (route) => {
    calls++;
    const input: unknown = JSON.parse(
      new URL(route.request().url()).searchParams.get('input') ?? 'null'
    );
    expect(input).toEqual({});
    const value = board(record);
    value.viewer = 'signed-out';
    if (calls === 2) value.viewer = 'signed-in';
    if (calls === 3) {
      value.status = 'expired';
      value.serverNowMs = value.retainedUntilMs;
    }
    if (calls === 4) value.challengeHash = 'a'.repeat(64);
    await route.fulfill({ json: { result: { data: value } } });
  });
  await page.goto('/game.html');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  // Exercise a public UI controller in isolation; no race state or score bypass is exposed.
  await page.evaluate(async (challenge) => {
    const moduleUrl = '/leaderboard-client.ts';
    const { createLeaderboardController } = await import(moduleUrl);
    const controller = createLeaderboardController(challenge);
    controller.onAttemptStart({ attemptId: 1 });
    controller.onResults({ attemptId: 1, mode: 'practice' });
  }, toPublicDailyChallenge(record));
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'empty'
  );
  await expect(page.locator('#leaderboard-status')).toContainText(
    'No verified times yet'
  );
  await expect(page.locator('#leaderboard-me')).toContainText('Sign in');
  await expect(page.locator('#leaderboard-outcome')).toBeHidden();
  await page.waitForTimeout(1100);
  expect(calls).toBe(1);
  await page.locator('#leaderboard-refresh').click();
  await expect(page.locator('#leaderboard-me')).toHaveText(
    'You have no verified daily time yet.'
  );
  await page.locator('#leaderboard-refresh').click();
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'expired'
  );
  await expect(page.locator('#leaderboard-status')).toContainText(
    'no longer retained'
  );
  await page.locator('#leaderboard-refresh').click();
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'error'
  );
  await expect(page.locator('#leaderboard-top')).toBeHidden();
  await expect(page.locator('#leaderboard-me')).toHaveText('');
});

test('a stored slower-run outcome never claims a new best from a newer current PB', async ({
  page,
}) => {
  const record = await dailyRecord();
  const value = board(record);
  const personalBestTicks = replay.endTick - 120;
  value.me = {
    username: 'DailyDriver',
    finishTicks: personalBestTicks - 60,
    rank: 1,
    isSelf: true,
  };
  value.top = [value.me];
  value.nearby = [value.me];
  value.outcome = {
    sessionId,
    previousBestTicks: personalBestTicks,
    personalBestTicks,
    isPersonalBest: false,
    improvementTicks: 0,
  };
  const receipt: VerifiedRunResponse = {
    sessionId,
    challengeId: record.id,
    challengeHash: record.challengeHash,
    finishTicks: replay.endTick,
    simulationHz: 120,
    finishTimeMs: (replay.endTick * 1000) / 120,
    verifiedAtMs: value.serverNowMs,
  };
  await page.route('**/api/trpc/getLeaderboard*', (route) =>
    route.fulfill({ json: { result: { data: value } } })
  );
  await page.goto('/game.html');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await page.evaluate(
    async ({ challenge, receipt }) => {
      const moduleUrl = '/leaderboard-client.ts';
      const { createLeaderboardController } = await import(moduleUrl);
      const controller = createLeaderboardController(challenge);
      controller.onAttemptStart({ attemptId: 1 });
      controller.recordVerified(1, receipt);
      controller.onResults({ attemptId: 1, mode: 'ranked' });
    },
    { challenge: toPublicDailyChallenge(record), receipt }
  );
  await expect(page.locator('#leaderboard')).toHaveAttribute(
    'data-state',
    'ready'
  );
  await expect(page.locator('#leaderboard-outcome')).toHaveText(
    `This run kept your daily best at ${(personalBestTicks / 120).toFixed(3)}s.`
  );
  await expect(page.locator('#leaderboard-outcome')).not.toContainText(
    'improved'
  );
  await expect(page.locator('#leaderboard-me')).toHaveText(
    `Your current best: ${((personalBestTicks - 60) / 120).toFixed(3)}s · #1`
  );
});
