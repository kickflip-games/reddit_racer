import { test, expect } from '@playwright/test';

// These visual/physics tests use Vite without the Reddit archive backend.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/trpc/dailyStandings*', (route) =>
    route.fulfill({ status: 200, json: { result: { data: null } } })
  );
});
import { waitForSceneAssets } from './scene-ready';

test('ordinary game track remounts reuse their GL state without accumulating fallback textures', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const observed = new WeakSet(),
      live = new Set<WebGLTexture>();
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value: function (this: HTMLCanvasElement, ...args: unknown[]) {
        const result: unknown = Reflect.apply(original, this, args);
        if (result instanceof WebGL2RenderingContext && !observed.has(result)) {
          observed.add(result);
          const create = result.createTexture.bind(result),
            remove = result.deleteTexture.bind(result);
          const update = () => {
            document.documentElement.dataset.testTextures = String(live.size);
          };
          result.createTexture = () => {
            const value = create();
            if (value) live.add(value);
            update();
            return value;
          };
          result.deleteTexture = (value) => {
            if (value) live.delete(value);
            remove(value);
            update();
          };
        }
        return result;
      },
    });
  });
  await page.goto('/game.html?practice=1&seed=practice-1');
  await waitForSceneAssets(page);
  const initial = Number(
    await page.locator('html').getAttribute('data-test-textures')
  );
  expect(initial).toBeGreaterThan(0);
  const counts: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.locator('#race-settings > summary').click();
    await page.locator('#next-practice-button').click();
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
    await waitForSceneAssets(page);
    await expect
      .poll(async () =>
        Number(await page.locator('html').getAttribute('data-test-textures'))
      )
      .toBeLessThanOrEqual(initial + 1);
    counts.push(
      Number(await page.locator('html').getAttribute('data-test-textures'))
    );
  }
  await test.info().attach('real-game-texture-lifetimes', {
    body: JSON.stringify({ initial, counts }),
    contentType: 'application/json',
  });
});

test(
  'spring scenery renders on native elevated driving and reduced motion preserves a quiet ready scene',
  { tag: '@smoke' },
  async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (e) => {
      if (e.type() === 'error') errors.push(e.text());
    });
    await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
    await page.goto(
      '/game.html?elevated=1&seed=flow-probe-21&sceneryQuality=standard'
    );
    await waitForSceneAssets(page);
    const race = page.locator('#race');
    await expect(race).toHaveAttribute('data-phase', 'ready');
    await expect(race).toHaveAttribute(
      'data-scenery-version',
      'green-composition-v5'
    );
    expect(
      Number(await race.getAttribute('data-vegetation-count'))
    ).toBeGreaterThan(500);
    await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
    await page.locator('#race-settings > summary').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#settings-close').click();
    await expect(race).toHaveAttribute('data-reduced-motion', 'true');
    await page.locator('#start-button').click();
    await page.keyboard.down('Space');
    await page.clock.runFor(7000);
    await expect(race).toHaveAttribute('data-phase', 'racing');
    expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(
      0
    );
    const fullCount = Number(await race.getAttribute('data-vegetation-count'));
    const distanceBefore = await page
      .locator('#lap-progress')
      .evaluate((p) => (p instanceof HTMLProgressElement ? p.value : -1));
    await page.locator('#race-settings > summary').click();
    await expect(page.locator('#scenery-detail')).toHaveCount(0);
    await page.locator('#settings-close').click();
    await expect(race).toHaveAttribute('data-phase', 'racing');
    expect(Number(await race.getAttribute('data-vegetation-count'))).toBe(
      fullCount
    );
    expect(
      await page
        .locator('#lap-progress')
        .evaluate((p) => (p instanceof HTMLProgressElement ? p.value : -1))
    ).toBeGreaterThanOrEqual(distanceBefore);
    await page.keyboard.up('Space');
    await page.screenshot({
      path: `test-results/countryside-native-${test.info().project.name}.png`,
    });
    expect(errors).toEqual([]);
  }
);

test('development workshop renders twelve distinct seed compositions with working region and clearance controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/environment-gallery.html');
  await expect(page.locator('#environment-status')).toHaveAttribute(
    'data-state',
    'ready'
  );
  const stats = page.locator('#environment-stats');
  await expect(stats).toHaveAttribute('data-track-hash', /^[a-f0-9]{64}$/);
  const hash = await stats.getAttribute('data-track-hash');
  await page.locator('#scenery-seed').fill('orchard');
  await page.locator('#overlay').selectOption('regions');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await expect(stats).toHaveAttribute('data-track-hash', hash ?? '');
  await page.locator('#overlay').selectOption('clearance');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await page.locator('#overlay').selectOption('none');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await page.locator('#gallery-button').click();
  const gallery = page.locator('#environment-gallery');
  await expect(gallery).toHaveAttribute('data-state', 'complete', {
    timeout: 60000,
  });
  await expect(gallery.locator('button')).toHaveCount(12);
  const images = await gallery
    .locator('img')
    .evaluateAll((nodes) =>
      nodes.map((n) => (n instanceof HTMLImageElement ? n.src : ''))
    );
  expect(new Set(images).size).toBe(12);
  await page.screenshot({
    path: `test-results/countryside-gallery-${test.info().project.name}.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('wind changes actual canvas pixels, switches off cleanly and repeated regeneration retains bounded GPU resources', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto('/environment-gallery.html');
  await expect(page.locator('#environment-status')).toHaveAttribute(
    'data-state',
    'ready'
  );
  await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
  const canvas = page.locator('#environment-canvas');
  await page.clock.runFor(200);
  const before = await canvas.screenshot();
  await page.clock.runFor(1600);
  const after = await canvas.screenshot();
  expect(before.equals(after)).toBe(false);
  await page.locator('#wind').uncheck();
  await page.clock.runFor(200);
  const still = await canvas.screenshot();
  await page.clock.runFor(1600);
  expect(still.equals(await canvas.screenshot())).toBe(true);
  const resources = [];
  for (let i = 0; i < 5; i++) {
    await page.locator('#seed').fill(`spring-regeneration-${i}`);
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await page.clock.runFor(600);
    const stats = await page
      .locator('#environment-stats')
      .evaluate((e) => ({ ...e.dataset }));
    resources.push(stats);
    expect(Number(stats.geometries)).toBeLessThan(250);
    expect(Number(stats.textures)).toBeLessThan(8);
    expect(Number(stats.programs)).toBeLessThan(24);
  }
  await test.info().attach('actual-regeneration-resources', {
    body: JSON.stringify(resources),
    contentType: 'application/json',
  });
  expect(errors).toEqual([]);
});
