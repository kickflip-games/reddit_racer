import { expect, test, type Page } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';
import { generateWordPracticeCourse } from '../../src/client/practice-course';
import { createTrackShare } from '../../src/shared/track-share';

async function incoming(page: Page, raw: string, stored = false) {
  await page.addInitScript(
    ({ raw, stored }) => {
      Object.defineProperty(window, 'devvit', {
        value: {
          context: { postId: 't3_sharetest' },
          ...(stored ? {} : { share: { userData: raw } }),
        },
        configurable: true,
      });
      if (stored)
        sessionStorage.setItem(
          'reddit-racer:pending-track-share:v1',
          JSON.stringify({ post: 't3_sharetest', raw, at: Date.now() })
        );
    },
    { raw, stored }
  );
}

test('native shared seed opens exact practice course with no ranked calls', async ({
  page,
}) => {
  const course = await generateWordPracticeCourse('banana');
  const payload = await createTrackShare('banana', course.track);
  await incoming(page, JSON.stringify(payload));
  const calls: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/trpc\//.test(req.url())) calls.push(req.url());
  });
  await page.goto('/game.html?daily=1');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-play-mode',
    'practice'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    payload.trackHash
  );
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-attempt-mode',
    'practice'
  );
  expect(calls).toEqual([]);
});

test('share sheet emits versioned exact-course data, not a claim of delivery', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'devvit', {
      value: { context: { postId: 't3_sharetest' } },
      configurable: true,
    });
    window.addEventListener('message', (event) => {
      if (event.data?.share?.userData)
        document.documentElement.dataset.shared = event.data.share.userData;
    });
  });
  await page.goto('/game.html?practice=1&word=banana');
  await waitForSceneAssets(page);
  await page.getByRole('button', { name: 'Choose a seed' }).click();
  await expect(page.getByLabel('Seed', { exact: true })).toHaveValue('banana');
  await expect(page.locator('#share-track-seed')).toHaveText(
    'Current seed: banana'
  );
  await page.getByRole('button', { name: 'Share track', exact: true }).click();
  await expect(page.locator('#share-track-status')).toContainText(
    'Choose where to share'
  );
  const payload = JSON.parse(
    (await page.locator('html').getAttribute('data-shared'))!
  );
  expect(payload.seed).toBe('banana');
  expect(payload.version).toBe(1);
  expect(payload.trackHash).toBe(
    await page.locator('#race').getAttribute('data-track-hash')
  );
  expect(JSON.stringify(payload).length).toBeLessThanOrEqual(1024);
  await expect(page.locator('#share-track-status')).not.toContainText('copied');
});

for (const fault of ['version', 'hash', 'malformed']) {
  test(`shared ${fault} fails closed without loading another or ranked course`, async ({
    page,
  }) => {
    const course = await generateWordPracticeCourse('banana');
    const payload = await createTrackShare('banana', course.track);
    await incoming(
      page,
      fault === 'malformed'
        ? '{'
        : JSON.stringify({
            ...payload,
            ...(fault === 'version'
              ? { version: 99 }
              : { trackHash: '0'.repeat(64) }),
          })
    );
    const calls: string[] = [];
    page.on('request', (req) => {
      if (/\/api\/trpc\//.test(req.url())) calls.push(req.url());
    });
    await page.goto('/game.html?daily=1');
    await expect(page.locator('#card-title')).toHaveText(
      'Shared track unavailable.'
    );
    await expect(page.locator('#start-button')).toBeDisabled();
    expect(
      await page.locator('#race').getAttribute('data-track-hash')
    ).toBeNull();
    expect(calls).toEqual([]);
    await page.locator('#word-course-open').click();
    await page.locator('#course-word').fill('apple');
    await page.locator('#word-course-submit').click();
    await waitForSceneAssets(page);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-word-code',
      'apple'
    );
  });
}

test('splash handoff is consumed once and still opens practice', async ({
  page,
}) => {
  const course = await generateWordPracticeCourse('banana');
  await incoming(
    page,
    JSON.stringify(await createTrackShare('banana', course.track)),
    true
  );
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-word-code',
    'banana'
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('reddit-racer:pending-track-share:v1')
    )
  ).toBeNull();
});

test('unavailable share has honest copy seed fallback with clipboard success and failure', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (seed: string) => {
          document.documentElement.dataset.copiedSeed = seed;
        },
      },
      configurable: true,
    })
  );
  await page.goto('/game.html?practice=1&courseSeed=banana');
  await waitForSceneAssets(page);
  await page.locator('#word-course-open').click();
  await expect(page.locator('#share-track-seed')).toHaveText(
    'Current seed: banana'
  );
  await page.getByRole('button', { name: 'Share track', exact: true }).click();
  await expect(page.locator('#share-track-status')).toContainText(
    'Sharing is unavailable'
  );
  await page.getByRole('button', { name: 'Copy seed', exact: true }).click();
  await expect(page.locator('#share-track-status')).toContainText(
    'Seed copied: banana'
  );
  expect(await page.locator('html').getAttribute('data-copied-seed')).toBe(
    'banana'
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Denied');
        },
      },
      configurable: true,
    })
  );
  await page.getByRole('button', { name: 'Copy seed', exact: true }).click();
  await expect(page.locator('#share-track-status')).toContainText(
    'Copy this seed manually: banana'
  );
  expect(
    await page
      .locator('#settings-dialog')
      .evaluate((e) => e.scrollWidth - e.clientWidth)
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: test.info().outputPath('seed-sharing-mobile.png'),
  });
});

test('splash saves native payload and expanded view consumes it when host omits it', async ({
  page,
}) => {
  const course = await generateWordPracticeCourse('banana');
  const raw = JSON.stringify(await createTrackShare('banana', course.track));
  await page.addInitScript((raw) => {
    Object.defineProperty(window, 'devvit', {
      value: {
        context: { postId: 't3_sharetest' },
        ...(location.pathname.includes('splash')
          ? { share: { userData: raw } }
          : {}),
      },
      configurable: true,
    });
  }, raw);
  await page.goto('/splash.html');
  await page.addScriptTag({
    type: 'module',
    content:
      "import { rememberShareForExpansion } from '/share-handoff.ts'; rememberShareForExpansion(); document.documentElement.dataset.handoff='saved';",
  });
  await expect(page.locator('html')).toHaveAttribute('data-handoff', 'saved');
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-play-mode',
    'practice'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-track-hash',
    course.trackHash
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('reddit-racer:pending-track-share:v1')
    )
  ).toBeNull();
});

test('missing canonical hashing never claims a share or loads an unchecked shared track', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'devvit', {
      value: { context: { postId: 't3_sharetest' } },
      configurable: true,
    });
    Object.defineProperty(crypto, 'subtle', {
      value: undefined,
      configurable: true,
    });
    window.addEventListener('message', (event) => {
      if (event.data?.share) document.documentElement.dataset.shared = 'yes';
    });
  });
  await page.goto('/game.html?practice=1&word=banana');
  await waitForSceneAssets(page);
  await page.locator('#word-course-open').click();
  await page.locator('#share-track-button').click();
  await expect(page.locator('#share-track-status')).toContainText(
    'Sharing is unavailable'
  );
  expect(await page.locator('html').getAttribute('data-shared')).toBeNull();
  const course = await generateWordPracticeCourse('banana');
  await incoming(
    page,
    JSON.stringify(await createTrackShare('banana', course.track))
  );
  await page.goto('/game.html');
  await expect(page.locator('#card-title')).toHaveText(
    'Shared track unavailable.'
  );
  await expect(page.locator('#start-button')).toBeDisabled();
});
