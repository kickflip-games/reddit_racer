import { expect, test } from '@playwright/test';
import {
  generateCurrentDailyCircuit,
  assessBrakingTrack,
} from '../../src/shared/braking-course-generator';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge';

const instruction = 'Hold to accelerate. Release to brake.';
const noon = Date.parse('2026-11-19T12:00:00Z');
const current = generateCurrentDailyCircuit('word-v2:banana');
const oldTrack = { ...current.track, generatorVersion: 'linked-circuits-v3' };
const retained = {
  ...current,
  track: oldTrack,
  quality: assessBrakingTrack(oldTrack),
  diagnostics: { ...current.diagnostics, version: oldTrack.generatorVersion },
};

test('built teaser has the exact short driving instruction', async ({
  page,
}) => {
  await page.route('**/api/trpc/**', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'standalone production test' },
    })
  );
  await page.goto('/splash.html');
  await expect(page.locator('.description')).toHaveText(instruction);
});

for (const [name, generated] of [
  ['current v9', current],
  ['retained v8', retained],
  ['legacy flat', generateValidatedCircuit('showcase-3')],
] as const) {
  test(`built ${name} race keeps only countdown numerals and GO, with no driving labels`, async ({
    page,
  }, info) => {
    const record = await createDailyChallengeRecord({
      subredditId: 't5_productiontest',
      day: '2026-11-19',
      createdAtMs: noon,
      requestedSeed: generated.track.seed,
      generated,
    });
    await page.clock.install({ time: new Date(noon) });
    // Local production-bundle fixture only. No hosted Reddit request or score is sent.
    await page.route('**/api/trpc/**', (route) =>
      route.fulfill({
        status: 503,
        json: { error: 'standalone production test' },
      })
    );
    await page.route('**/api/trpc/dailyChallenge*', (route) =>
      route.fulfill({
        json: { result: { data: dailyChallengeView(record, noon) } },
      })
    );
    await page.route('**/api/trpc/startRankedRace*', (route) =>
      route.fulfill({
        json: {
          error: {
            message: 'Standalone UI fixture',
            code: -32001,
            data: { code: 'UNAUTHORIZED', httpStatus: 401 },
          },
        },
      })
    );
    await page.goto('/game.html?daily=1');
    await expect(page.locator('#race')).toHaveAttribute(
      'data-car-load',
      'ready'
    );
    await expect(page.locator('#race')).toHaveAttribute(
      'data-challenge-hash',
      record.challengeHash
    );
    await expect(page.locator('#card-copy')).toHaveText(instruction);
    await expect(page.locator('#race-canvas')).toHaveAccessibleDescription(
      /Hold Space or touch the track to accelerate; release to brake/
    );
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page.screenshot({ path: info.outputPath('production-ready.png') });
    await page.locator('#start-button').click();
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'countdown'
    );
    const countdown = page.locator('#race-countdown');
    await expect(countdown).toHaveText('3');
    await expect(countdown).toHaveAccessibleName('3');
    expect(
      await countdown.evaluate((el) => getComputedStyle(el, '::after').content)
    ).toBe('none');
    await expect(
      page.locator('#driving-hint, #driving-cue, .drift-cue')
    ).toHaveCount(0);
    await page.clock.runFor(1100);
    await expect(countdown).toHaveText('2');
    await page.clock.runFor(1000);
    await expect(countdown).toHaveText('1');
    await page.screenshot({
      path: info.outputPath('production-countdown.png'),
    });
    await page.keyboard.down('Space');
    await page.clock.runFor(1050);
    await expect(countdown).toHaveText('GO!');
    await expect(countdown).toHaveAccessibleName('GO!');
    await page.clock.runFor(1000);
    await expect(countdown).toBeHidden();
    await expect(page.locator('#timer')).toBeVisible();
    await expect(page.locator('#circuit-minimap')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Restart race', exact: true })
    ).toBeVisible();
    await expect(
      page.getByText(
        /^(Sliding|Braking|Grass slows you|DRIFT|RELEASE|Perfect start!)$/
      )
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('production-quiet-race.png'),
    });
    await page.keyboard.up('Space');
  });
}
