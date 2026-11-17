import { expect, test, type Page } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';
import {
  archiveDayBounds,
  type DailyStandingsView,
} from '../../src/shared/daily-standings';

const now = Date.parse('2026-11-15T00:01:00Z');
function view(day = '2026-11-15', offset = 0): DailyStandingsView {
  const count = offset === 0 ? 20 : 5;
  return {
    day,
    offset,
    ...archiveDayBounds(now),
    serverNowMs: now,
    retainedUntilMs: Date.parse(`${day}T00:00:00Z`) + 91 * 86_400_000,
    status: 'available',
    provisional: day >= '2026-11-14',
    rows: Array.from({ length: count }, (_, index) => ({
      username: `racer_${offset + index}`,
      finishTicks: 3600,
      rank: 1,
      isSelf: false,
    })),
    nextOffset: offset === 0 ? 20 : null,
    hasMore: offset === 0,
    postUrl: 'https://www.reddit.com/comments/abc123/',
  };
}
async function boot(
  page: Page,
  response?: (day: string, offset: number) => DailyStandingsView
) {
  const queries: { day?: string; offset?: number }[] = [];
  await page.route('**/api/trpc/dailyStandings*', async (route) => {
    const input = JSON.parse(
      new URL(route.request().url()).searchParams.get('input') ?? '{}'
    );
    queries.push(input);
    await route.fulfill({
      json: {
        result: {
          data: (response ?? view)(
            input.day ?? '2026-11-15',
            input.offset ?? 0
          ),
        },
      },
    });
  });
  await page.goto('/game.html?practice=1&seed=showcase-3');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  return queries;
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 960, height: 720 },
]) {
  test(`historical podium and continued ties fit ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const queries = await boot(page);
    expect(queries).toHaveLength(0);
    await expect(page.locator('#daily-history-preview-status')).toHaveCount(0);
    await expect(page.locator('#card')).not.toContainText('2026-11-15 UTC');
    await page.screenshot({
      path: `test-results/daily-history-home-${viewport.width}.png`,
    });
    await page.locator('#daily-history-open').click();
    const dialog = page.getByRole('dialog', {
      name: 'Leaderboard',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(page.locator('#daily-history-status')).toContainText(
      '2026-11-15 UTC'
    );
    await expect(page.locator('#daily-history-provisional')).toBeVisible();
    await expect(page.locator('#daily-history-rows tr')).toHaveCount(20);
    await expect(page.locator('#daily-history-ties')).toContainText(
      'more tied podium racers'
    );
    await expect(page.locator('#daily-history-date')).toHaveAttribute(
      'max',
      '2026-11-15'
    );
    await expect(page.locator('#daily-history-date')).toHaveAttribute(
      'min',
      '2026-08-17'
    );
    await page.locator('#daily-history-more').click();
    await expect(page.locator('#daily-history-rows tr')).toHaveCount(5);
    await expect(page.locator('#daily-history-rows tr').first()).toContainText(
      '#1racer_20'
    );
    await expect(page.locator('#daily-history-more')).toBeHidden();
    await page.locator('#daily-history-back').click();
    await expect(page.locator('#daily-history-rows tr')).toHaveCount(20);
    await page.locator('#daily-history-previous').click();
    await expect(page.locator('#daily-history-status')).toContainText(
      '2026-11-14 UTC'
    );
    await expect(page.locator('#daily-history-provisional')).toBeVisible();
    await page.locator('#daily-history-next').click();
    await expect(page.locator('#daily-history-next')).toBeDisabled();
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error('Dialog missing');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    for (const id of [
      'daily-history-close',
      'daily-history-previous',
      'daily-history-next',
      'daily-history-go',
    ]) {
      const box = await page.locator('#' + id).boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({
      path: `test-results/daily-history-${viewport.width}.png`,
    });
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
    await page.locator('#daily-history-close').click();
    await expect(page.locator('#daily-history-open')).toBeFocused();
    await expect(dialog).toBeHidden();
    expect(queries.length).toBeLessThanOrEqual(7);
    await page.locator('#start-button').click();
    await expect(page.locator('#daily-history-open')).toBeHidden();
  });
}

test('archive distinguishes missing and empty and recovers from unavailable', async ({
  page,
}) => {
  await boot(page, (day, offset) => {
    const result = view(day, offset);
    if (day === '2026-11-15')
      return {
        ...result,
        status: 'unavailable',
        rows: [],
        nextOffset: null,
        hasMore: false,
        postUrl: null,
      };
    return {
      ...result,
      status: day === '2026-11-14' ? 'empty' : 'missing',
      rows: [],
      nextOffset: null,
      hasMore: false,
      postUrl: null,
    };
  });
  await page.locator('#daily-history-open').click();
  await expect(page.locator('#daily-history-status')).toContainText(
    'temporarily unavailable'
  );
  await expect(page.locator('#daily-history-retry')).toBeVisible();
  await page.locator('#daily-history-previous').click();
  await expect(page.locator('#daily-history-status')).toContainText(
    'no verified finishes'
  );
  await page.locator('#daily-history-previous').click();
  await expect(page.locator('#daily-history-status')).toContainText(
    'no saved daily race'
  );
  await expect(page.locator('#daily-history-table')).toBeHidden();
});

test('archive handles request errors and retention rollover honestly', async ({
  page,
}) => {
  await boot(page);
  await page.locator('#daily-history-open').click();
  await expect(page.locator('#daily-history-status')).toContainText(
    '2026-11-15 UTC'
  );
  await page.unroute('**/api/trpc/dailyStandings*');
  await page.route('**/api/trpc/dailyStandings*', (route) => route.abort());
  await page.locator('#daily-history-previous').click();
  await expect(page.locator('#daily-history-status')).toContainText(
    'temporarily unavailable'
  );
  await expect(page.locator('#daily-history-retry')).toBeEnabled();
  await expect(page.locator('#daily-history-close')).toBeEnabled();
  await page.unroute('**/api/trpc/dailyStandings*');
  const later = Date.parse('2026-11-16T00:01:00Z');
  await page.route('**/api/trpc/dailyStandings*', async (route) => {
    const input = JSON.parse(
      new URL(route.request().url()).searchParams.get('input') ?? '{}'
    );
    const day = input.day ?? '2026-11-15';
    const expired = day === '2026-08-17';
    const data: DailyStandingsView = {
      ...view(day, input.offset ?? 0),
      ...archiveDayBounds(later),
      serverNowMs: later,
      provisional: day === '2026-11-15',
      ...(expired
        ? {
            status: 'expired',
            rows: [],
            hasMore: false,
            nextOffset: null,
            postUrl: null,
          }
        : {}),
    };
    await route.fulfill({ json: { result: { data } } });
  });
  await page.locator('#daily-history-date').fill('2026-08-17');
  await page.locator('#daily-history-go').click();
  await expect(page.locator('#daily-history-status')).toContainText(
    'no longer retained'
  );
  await expect(page.locator('#daily-history-previous')).toBeDisabled();
  await expect(page.locator('#daily-history-date')).toHaveAttribute(
    'min',
    '2026-08-18'
  );
  await page.locator('#daily-history-next').click();
  await expect(page.locator('#daily-history-status')).toContainText(
    '2026-08-18 UTC'
  );
});

test('leaderboard opens today and swipes or keys through previous UTC days', async ({
  page,
  isMobile,
}) => {
  await boot(page);
  await page.locator('#daily-history-open').click();
  const status = page.locator('#daily-history-status');
  await expect(status).toContainText('Today · 2026-11-15 UTC');
  const box = (await page.locator('#daily-history-title').boundingBox())!;
  const start = { x: box.x + box.width - 10, y: box.y + box.height / 2 };
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [start],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x - 80, y: start.y }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 80, start.y, { steps: 8 });
    await page.mouse.up();
  }
  await expect(status).toContainText('2026-11-14 UTC');
  await page.locator('#daily-history-close').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(status).toContainText('2026-11-13 UTC');
  await page.keyboard.press('ArrowRight');
  await expect(status).toContainText('2026-11-14 UTC');
});
