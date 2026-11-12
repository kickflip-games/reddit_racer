import { expect, test, type Page, type Route } from '@playwright/test';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
  type DailyChallengeRecord,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import {
  parseRankedSubmission,
  type RankedSubmission,
  type StartRankedRaceResponse,
} from '../../src/shared/ranked-race.ts';
import { runReplay } from '../../src/shared/replay.ts';
import { SIMULATION_HZ } from '../../src/shared/simulation.ts';

const generated = generateValidatedCircuit('showcase-3');
const controlReplay = generated.quality.fastReplay;
if (!controlReplay)
  throw new Error('Expected a verified development control tape');
const replay = controlReplay;
let fixture: Promise<DailyChallengeRecord> | undefined;
function dailyRecord(): Promise<DailyChallengeRecord> {
  fixture ??= createDailyChallengeRecord({
    subredditId: 't5_rankedtest',
    day: '2026-11-12',
    createdAtMs: Date.parse('2026-11-12T12:00:00Z'),
    requestedSeed: 'showcase-3',
    generated,
  });
  return fixture;
}
function session(
  record: DailyChallengeRecord,
  index = 1,
  nearMidnight = false
): StartRankedRaceResponse {
  const serverNowMs = nearMidnight
    ? record.endsAtMs - 5000
    : record.startsAtMs + 18 * 3600_000;
  return {
    sessionId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    challengeId: record.id,
    challengeHash: record.challengeHash,
    trackHash: record.trackHash,
    simulationVersion: record.simulationVersion,
    handlingVersion: record.handlingVersion,
    serverNowMs,
    expiresAtMs: Math.min(serverNowMs + 300_000, record.endsAtMs + 180_000),
  };
}
async function reject(route: Route, code: string): Promise<void> {
  await route.fulfill({
    json: {
      error: {
        message: 'Test service rejection',
        code: -32603,
        data: { code, httpStatus: 400 },
      },
    },
  });
}
async function openDaily(
  page: Page,
  nearMidnight = false
): Promise<DailyChallengeRecord> {
  const record = await dailyRecord();
  await page.route('**/api/trpc/getLeaderboard*', async (route) => {
    await route.fulfill({
      json: {
        result: {
          data: {
            challengeId: record.id,
            challengeHash: record.challengeHash,
            day: record.day,
            simulationHz: 120,
            serverNowMs: record.startsAtMs + 18 * 3600_000,
            retainedUntilMs: record.endsAtMs + 90 * 86400_000,
            status: 'available',
            viewer: 'signed-in',
            top: [],
            me: null,
            nearby: [],
            outcome: null,
          },
        },
      },
    });
  });
  await page.route('**/api/trpc/dailyChallenge*', async (route) => {
    await route.fulfill({
      json: {
        result: {
          data: dailyChallengeView(
            record,
            nearMidnight
              ? record.endsAtMs - 65_000
              : record.startsAtMs + 18 * 3600_000
          ),
        },
      },
    });
  });
  await page.clock.install({ time: new Date('2031-01-01T00:00:00Z') });
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await page.clock.pauseAt(new Date('2031-01-01T00:01:00Z'));
  return record;
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
function verifiedResult(
  record: DailyChallengeRecord,
  submission: RankedSubmission,
  verifiedAtMs = session(record).serverNowMs + 60_000
) {
  const result = runReplay(record.track, submission.replay);
  return {
    sessionId: submission.sessionId,
    challengeId: record.id,
    challengeHash: record.challengeHash,
    finishTicks: result.finishTicks,
    simulationHz: 120,
    finishTimeMs: (result.finishTicks * 1000) / 120,
    verifiedAtMs,
  };
}

test('preparation deduplicates Start, preserves a held input and cancels safely on blur', async ({
  page,
}) => {
  const record = await openDaily(page);
  let calls = 0;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/trpc/startRankedRace*', async (route) => {
    const number = ++calls;
    if (number === 1) await gate;
    await route.fulfill({
      json: { result: { data: session(record, number) } },
    });
  });
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute('data-preparing', 'true');
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await page.evaluate(() => document.getElementById('start-button')?.click());
  expect(calls).toBe(1);
  release();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await page.clock.runFor(3100);
  expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Space');
  await expect(page.locator('#verification-status')).toHaveAttribute(
    'data-state',
    'abandoned'
  );
  expect(await page.locator('html').innerHTML()).not.toContain(
    session(record).sessionId
  );
});

test('late preparation cannot start a cancelled attempt or overwrite a retry', async ({
  page,
}) => {
  const record = await openDaily(page);
  let calls = 0;
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/trpc/startRankedRace*', async (route) => {
    const number = ++calls;
    if (number === 1) await gate;
    await route.fulfill({
      json: { result: { data: session(record, number) } },
    });
  });
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute('data-preparing', 'true');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#race')).toHaveAttribute(
    'data-preparing',
    'false'
  );
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  release();
  await page.clock.runFor(1100);
  await expect(page.locator('#race-countdown')).toHaveText('2');
  await expect(page.locator('#verification-status')).toHaveAttribute(
    'data-state',
    'ranked'
  );
  expect(calls).toBe(2);
});

test('session hash mismatch blocks countdown instead of silently verifying another course', async ({
  page,
}) => {
  const record = await openDaily(page);
  await page.route('**/api/trpc/startRankedRace*', async (route) => {
    await route.fulfill({
      json: {
        result: { data: { ...session(record), challengeHash: 'a'.repeat(64) } },
      },
    });
  });
  await page.locator('#start-button').click();
  await expect(page.locator('#verification-status')).toHaveAttribute(
    'data-state',
    'blocked'
  );
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#card-copy')).toContainText('does not match');
  await expect(page.locator('#retry-button')).toBeEnabled();
});

test('real renderer inputs submit only the replay and session, verify once, and preserve a midnight session', async ({
  page,
}) => {
  const record = await openDaily(page, true);
  let starts = 0;
  const submissions: RankedSubmission[] = [];
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/trpc/startRankedRace*', async (route) => {
    starts++;
    if (starts > 1) {
      await reject(route, 'PRECONDITION_FAILED');
      return;
    }
    await route.fulfill({
      json: { result: { data: session(record, 1, true) } },
    });
  });
  await page.route('**/api/trpc/submitRun*', async (route) => {
    const raw: unknown = route.request().postDataJSON();
    if (typeof raw !== 'object' || raw === null)
      throw new Error('Submission is not an object');
    expect(Object.keys(raw).sort()).toEqual(['replay', 'sessionId']);
    const submission = parseRankedSubmission(raw);
    submissions.push(submission);
    await gate;
    await route.fulfill({
      json: {
        result: {
          data: verifiedResult(record, submission, record.endsAtMs + 30_000),
        },
      },
    });
  });
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
  await expect(page.locator('#mode-label')).toHaveText('RANKED · DAILY');
  await expect(page.locator('#daily-reset')).toContainText(
    'Current race keeps'
  );
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0]?.replay).toEqual(replay);
  expect(await page.locator('html').innerHTML()).not.toContain(
    session(record).sessionId
  );
  release();
  await expect(page.locator('#verification-status')).toHaveAttribute(
    'data-state',
    'verified'
  );
  await expect(page.locator('#card-title')).toHaveText(
    `${(replay.endTick / 120).toFixed(3)} seconds`
  );
  await page.screenshot({
    path: `test-results/ranked-verified-mock-${test.info().project.name}.png`,
  });
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await expect(page.locator('#verification-status')).toHaveAttribute(
    'data-state',
    'practice'
  );
  await expect(page.locator('#mode-label')).toHaveText('ARCHIVE · UNRANKED');
  expect(starts).toBe(2);
  expect(submissions.length).toBe(1);
});

test('an older pending receipt cannot replace a newer authenticated retry', async ({
  page,
}) => {
  const record = await openDaily(page);
  let starts = 0;
  let release = (): void => {};
  let delivered = (): void => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const responseDelivered = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  await page.route('**/api/trpc/startRankedRace*', async (route) => {
    await route.fulfill({
      json: { result: { data: session(record, ++starts) } },
    });
  });
  await page.route('**/api/trpc/submitRun*', async (route) => {
    const submission = parseRankedSubmission(route.request().postDataJSON());
    await gate;
    await route.fulfill({
      json: { result: { data: verifiedResult(record, submission) } },
    });
    delivered();
  });
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
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  release();
  await responseDelivered;
  await page.clock.runFor(32);
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

test('signed-out practice can finish without submitting a score', async ({
  page,
}) => {
  await openDaily(page);
  let submits = 0;
  await page.route('**/api/trpc/startRankedRace*', (route) =>
    reject(route, 'UNAUTHORIZED')
  );
  await page.route('**/api/trpc/submitRun*', async (route) => {
    submits++;
    await reject(route, 'UNAUTHORIZED');
  });
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await expect(page.locator('#verification-status')).toContainText(
    'unranked practice'
  );
  await driveFast(page);
  await expect(page.locator('#card-kicker')).toHaveText(
    'LAP COMPLETE · UNRANKED'
  );
  expect(submits).toBe(0);
});

for (const failure of [
  'expired-receipt',
  'SERVICE_UNAVAILABLE',
  'TOO_MANY_REQUESTS',
]) {
  test(`finished run remains unverified for ${failure}`, async ({ page }) => {
    const record = await openDaily(page);
    const activeSession = session(record);
    await page.route('**/api/trpc/startRankedRace*', async (route) => {
      await route.fulfill({ json: { result: { data: activeSession } } });
    });
    await page.route('**/api/trpc/submitRun*', async (route) => {
      if (failure !== 'expired-receipt') {
        await reject(route, failure);
        return;
      }
      const submission = parseRankedSubmission(route.request().postDataJSON());
      await route.fulfill({
        json: {
          result: {
            data: verifiedResult(record, submission, activeSession.expiresAtMs),
          },
        },
      });
    });
    await page.locator('#start-button').click();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'countdown'
    );
    await driveFast(page);
    await expect(page.locator('#verification-status')).toHaveAttribute(
      'data-state',
      failure === 'expired-receipt' ? 'rejected' : 'unavailable'
    );
    await expect(page.locator('#card-kicker')).toHaveText(
      'LAP COMPLETE · UNVERIFIED'
    );
    await expect(page.locator('#retry-button')).toBeEnabled();
  });
}
