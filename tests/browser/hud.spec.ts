import { expect, test, type Page } from '@playwright/test';
import {
  createDailyChallengeRecord,
  dailyChallengeView,
} from '../../src/shared/daily-challenge.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { waitForSceneAssets } from './scene-ready.ts';

async function layout(page: Page) {
  return page.evaluate(() => {
    const race = document.getElementById('race');
    const hud = document.getElementById('race-hud');
    const canvas = document.getElementById('race-canvas');
    const card = document.getElementById('card');
    if (!race || !hud || !canvas || !card)
      throw new Error('Missing live scene layout');
    const hudBounds = hud.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    return {
      hudHeight: hudBounds.height,
      hudBottom: hudBounds.bottom,
      cameraTopInset: Number.parseFloat(
        race.style.getPropertyValue('--hud-bottom')
      ),
      expectedTopInset: Math.max(12, hudBounds.bottom - canvasBounds.top + 8),
      cardTop: cardBounds.top,
      cardHeight: cardBounds.height,
      cardMaxHeight: getComputedStyle(card).maxHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      phase: race.dataset.phase,
      time: document.getElementById('timer')?.textContent,
      resizeEvents: document.documentElement.dataset.fixtureResizeEvents,
    };
  });
}

async function expectFreshInsets(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const current = await layout(page);
      const error = Math.abs(current.cameraTopInset - current.expectedTopInset);
      return Number.isFinite(error) ? error : Infinity;
    })
    .toBeLessThan(0.5);
}

test('PRESENTATION FIXTURE preserves the verification live region in finished and short layouts', async ({
  page,
}) => {
  // Only the real document and stylesheet load. No driver, authentication or lap exists.
  await page.route('**/game.ts*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: '' })
  );
  await page.goto('/game.html');
  const message =
    'Presentation fixture: verification status remains available.';
  await page.evaluate((message) => {
    const race = document.getElementById('race');
    const status = document.getElementById('verification-status');
    const kicker = document.getElementById('card-kicker');
    const title = document.getElementById('card-title');
    const copy = document.getElementById('card-copy');
    const mode = document.getElementById('mode-label');
    if (!race || !status || !kicker || !title || !copy || !mode)
      throw new Error('Missing status presentation');
    race.dataset.phase = 'finished';
    status.hidden = false;
    status.dataset.state = 'verified';
    status.textContent = message;
    kicker.textContent = 'PRESENTATION FIXTURE';
    title.textContent = 'Status layout check';
    copy.textContent = 'No race was driven and no result was submitted.';
    mode.textContent = 'UI FIXTURE · UNRANKED';
  }, message);
  for (const viewport of [
    { width: 960, height: 720 },
    { width: 640, height: 360 },
    { width: 320, height: 400 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole('status').filter({ hasText: message })
    ).toBeVisible();
    await expect(page.locator('#verification-status')).not.toHaveAttribute(
      'hidden'
    );
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'finished'
    );
  }
  await page.screenshot({
    path: `test-results/hud-status-presentation-${test.info().project.name}.png`,
  });
});

test('mocked daily details and later wrapping refit HUD, card and camera inset without resize or driving', async ({
  page,
}) => {
  const record = await createDailyChallengeRecord({
    subredditId: 't5_hudtest',
    day: '2026-11-12',
    createdAtMs: Date.parse('2026-11-12T12:00:00Z'),
    requestedSeed: 'showcase-3',
    generated: generateValidatedCircuit('showcase-3'),
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/trpc/dailyChallenge*', async (route) => {
    await gate;
    await route.fulfill({
      json: {
        result: {
          data: dailyChallengeView(record, record.startsAtMs + 12 * 3600_000),
        },
      },
    });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date('2031-01-01T00:00:00Z') });
  await page.goto('/game.html?daily=1');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'loading');
  await expect(page.locator('#daily-details')).toBeHidden();
  await page.evaluate(() => {
    document.documentElement.dataset.fixtureResizeEvents = '0';
    window.addEventListener('resize', () => {
      const root = document.documentElement;
      root.dataset.fixtureResizeEvents = String(
        Number(root.dataset.fixtureResizeEvents ?? '0') + 1
      );
    });
  });
  release();
  await expect(page.locator('#daily-details')).toBeVisible();
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2031-01-01T00:01:00Z'));
  await expectFreshInsets(page);
  await page.evaluate(() => {
    const kicker = document.getElementById('card-kicker');
    const copy = document.getElementById('card-copy');
    if (!kicker || !copy) throw new Error('Missing layout presentation');
    kicker.textContent = 'LAYOUT FIXTURE · MOCKED DAILY';
    copy.textContent =
      'This presentation checks the space reserved for daily details, readable results and the camera. '.repeat(
        30
      );
  });
  const before = await layout(page);
  expect(before.cardMaxHeight).not.toBe('none');
  expect(before.cardHeight).toBeGreaterThan(400);
  await page.locator('#daily-reset').evaluate((node) => {
    node.textContent =
      'This immutable circuit remains available for practice. A new shared race opens at the next UTC reset; check the current post before starting another ranked attempt.';
  });
  await expect
    .poll(async () => (await layout(page)).hudHeight)
    .toBeGreaterThan(before.hudHeight + 20);
  await expectFreshInsets(page);
  const after = await layout(page);
  expect(after.cameraTopInset).toBeGreaterThan(before.cameraTopInset + 20);
  expect(after.cardMaxHeight).not.toBe(before.cardMaxHeight);
  expect(after.cardHeight).toBeLessThan(before.cardHeight - 20);
  expect(after.cardTop).toBeGreaterThanOrEqual(after.hudBottom + 8);
  expect(after.viewportWidth).toBe(before.viewportWidth);
  expect(after.viewportHeight).toBe(before.viewportHeight);
  expect(after.resizeEvents).toBe('0');
  expect(after.phase).toBe('ready');
  expect(after.time).toBe('00.000');
  expect(errors).toEqual([]);
  await page.screenshot({
    path: `test-results/hud-daily-layout-mock-${test.info().project.name}.png`,
  });
});
