import { test, expect, devices } from '@playwright/test';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { generateBrakingCircuit } from '../../src/shared/braking-course-generator.ts';
import {
  createMinimapGeometry,
  sampleMinimap,
} from '../../src/client/circuit-minimap.ts';
import { waitForSceneAssets } from './scene-ready.ts';

test('six canonical seed outlines render at desktop and portrait sizes and follow actual simulation progress', async ({
  browser,
  baseURL,
}, info) => {
  if (!baseURL) throw new Error('Missing browser-test URL');
  const errors: string[] = [];
  const mobile = info.project.name === 'mobile-chromium';
  const shapes = new Set<string>();
  for (let i = 0; i < 6; i++) {
    // A separate browser context also isolates each virtual clock.
    const page = await browser.newPage({
      ...(mobile ? devices['Pixel 7'] : devices['Desktop Chrome']),
      deviceScaleFactor: 1,
      baseURL,
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (e) => {
      if (e.type() === 'error') errors.push(e.text());
    });
    await page.setViewportSize(
      mobile ? { width: 412, height: 839 } : { width: 960, height: 720 }
    );

    const seed = `minimap-${i}`;
    const track = generateElevatedCircuit(seed).track;
    const geometry = createMinimapGeometry(track);
    await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
    await page.goto(`/game.html?seed=${seed}`);
    await waitForSceneAssets(page);
    await expect(page.locator('#track-source')).toHaveAttribute(
      'data-seed',
      seed
    );
    const map = page.locator('#circuit-minimap');
    await expect(map).toBeHidden();
    await expect(page.locator('#minimap-course')).toHaveAttribute(
      'd',
      geometry.path
    );
    shapes.add(geometry.path);
    await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
    await page.locator('#start-button').click();
    await page.keyboard.down('Space');
    await page.clock.runFor(2500);
    await expect(map).toBeHidden();
    await page.clock.runFor(2500);
    await expect(map).toBeVisible();
    const distance = await page
      .locator('#lap-progress')
      .evaluate((e) => (e instanceof HTMLProgressElement ? e.value : -1));
    const point = sampleMinimap(geometry, distance);
    expect(
      Number(await page.locator('#minimap-player').getAttribute('cx'))
    ).toBeCloseTo(point.x, 1);
    expect(
      Number(await page.locator('#minimap-player').getAttribute('cy'))
    ).toBeCloseTo(point.y, 1);
    expect(
      Number(
        await page
          .locator('#minimap-completed')
          .getAttribute('stroke-dashoffset')
      )
    ).toBeCloseTo(1 - point.stroke, 4);
    await expect(
      page.getByRole('progressbar', { name: 'Lap progress' })
    ).toHaveAttribute(
      'aria-valuenow',
      String(Math.floor(point.completion * 100))
    );
    await expect(page.locator('#minimap-course')).toHaveAttribute(
      'd',
      geometry.path
    );
    await page.screenshot({
      path: `test-results/minimap/${seed}-${info.project.name}.png`,
    });
    await map.screenshot({
      path: `test-results/minimap/${seed}-map-${info.project.name}.png`,
    });
    await page.keyboard.up('Space');
    await page.close();
  }
  expect(shapes.size).toBe(6);
  expect(errors).toEqual([]);
});

test(
  'minimap stays clear of controls at small/safe layouts, passes native mouse or touch to the track, and clears interrupted progress',
  { tag: '@smoke' },
  async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Always change from an outline without a bridge to one with an overpass.
    const nextSeed = 'word-v2:silver-valley-02020202-1';
    const nextGeometry = createMinimapGeometry(
      generateBrakingCircuit(nextSeed).track
    );
    expect(nextGeometry.bridges).toHaveLength(1);
    await page.addInitScript(() => {
      const randomValues = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = (values) => {
        const result = randomValues(values);
        if (result instanceof Uint8Array && result.length === 4) result.fill(2);
        return result;
      };
    });
    await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
    await page.goto('/game.html?practice=1&seed=practice-1');
    await waitForSceneAssets(page);
    await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
    await page.locator('#start-button').click();
    await page.clock.runFor(3100);
    const map = page.locator('#circuit-minimap');
    const path = await page.locator('#minimap-course').getAttribute('d');
    const permanentNodes = map.locator(
      '*:not(.minimap-bridge, .minimap-bridge *)'
    );
    const nodes = await permanentNodes.count();
    await page.locator('#minimap-course').evaluate((node) => {
      document.documentElement.dataset.testOutlineWrites = '0';
      new MutationObserver((records) => {
        document.documentElement.dataset.testOutlineWrites = String(
          Number(document.documentElement.dataset.testOutlineWrites) +
            records.length
        );
      }).observe(node, { attributes: true, attributeFilter: ['d'] });
    });
    for (const [width, height] of [
      [320, 568],
      [412, 839],
      [1280, 800],
      [640, 360],
    ] satisfies [number, number][]) {
      await page.setViewportSize({ width, height });
      await expect(map).toBeVisible();
      const b = await map.boundingBox(),
        settings = await page.locator('#race-settings > summary').boundingBox(),
        timer = await page.locator('.timing').boundingBox(),
        restart = await page.locator('#restart-button').boundingBox();
      if (!b || !settings || !timer || !restart)
        throw new Error('Missing visible HUD');
      expect(b.x + b.width).toBeLessThanOrEqual(width - 13);
      expect(b.y + b.height).toBeLessThanOrEqual(height - 13);
      // Settings now lives bottom-left; require geometric separation, not old top-right placement.
      expect(
        b.x > settings.x + settings.width ||
          b.y > settings.y + settings.height ||
          b.y + b.height < settings.y
      ).toBe(true);
      // The map shares the top area with the HUD but clears each actual control.
      expect(b.y).toBeGreaterThanOrEqual(restart.y + restart.height + 8);
      expect(b.y).toBeLessThan(height / 2);
      expect(b.x).toBeGreaterThan(timer.x + timer.width + 8);
      expect(b.width).toBeGreaterThanOrEqual(87);
      expect(b.width).toBeLessThanOrEqual(141);
      await expect(page.locator('#minimap-course')).toHaveAttribute(
        'd',
        path ?? ''
      );
      const hit = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.id,
        { x: b.x + b.width / 2, y: b.y + b.height / 2 }
      );
      expect(hit).toBe('race-canvas');
    }
    await page.setViewportSize({ width: 412, height: 839 });
    const box = await map.boundingBox();
    if (!box) throw new Error('Missing minimap');
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (info.project.name === 'mobile-chromium') {
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...point, id: 1 }],
      });
      await expect(page.locator('#status')).toHaveAttribute(
        'data-held',
        'true'
      );
      await page.clock.runFor(500);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    } else {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await expect(page.locator('#status')).toHaveAttribute(
        'data-held',
        'true'
      );
      await page.clock.runFor(500);
      await page.mouse.up();
    }
    await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
    expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(
      0
    );
    await page.locator('#race-settings > summary').click();
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(map).toBeHidden();
    await page.locator('#settings-close').click();
    await expect(map).toBeVisible();
    // Exercise the shipped max()/env() rules with simulated device insets.
    const stylesheet = await page.request.get('/game.css?direct');
    await page.addStyleTag({
      content: (await stylesheet.text())
        .replaceAll('env(safe-area-inset-right)', '34px')
        .replaceAll('env(safe-area-inset-top)', '30px'),
    });
    const safe = await map.boundingBox();
    if (!safe) throw new Error('Missing safe-area map');
    expect(safe.x + safe.width).toBeCloseTo(412 - 34, 0);
    expect(safe.y).toBeCloseTo(30 + 56, 0);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'abandoned'
    );
    await expect(map).toBeHidden();
    await expect(page.locator('#minimap-completed')).toHaveAttribute(
      'stroke-dashoffset',
      '1'
    );
    await expect(page.locator('#minimap-progress')).toHaveAttribute(
      'aria-valuenow',
      '0'
    );
    await expect(page.locator('html')).toHaveAttribute(
      'data-test-outline-writes',
      '0'
    );
    await page.locator('#race-settings > summary').click();
    await page.locator('#next-practice-button').click();
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
    await waitForSceneAssets(page);
    await expect(page.locator('#track-source')).toHaveAttribute(
      'data-seed',
      nextSeed
    );
    await expect(map).toBeHidden();
    await expect(page.locator('#minimap-course')).toHaveAttribute(
      'd',
      nextGeometry.path
    );
    expect(nextGeometry.path).not.toBe(path);
    await page.locator('#start-button').click();
    await page.clock.runFor(3100);
    await expect(map).toBeVisible();
    await expect(page.locator('#minimap-progress')).toHaveAttribute(
      'aria-valuetext',
      'Lap 1, 0% complete'
    );
    expect(await permanentNodes.count()).toBe(nodes);
    await expect(map.locator('.minimap-bridge')).toHaveCount(
      nextGeometry.bridges.length
    );
    expect(
      await map
        .locator('.minimap-bridge path')
        .evaluateAll((paths) => paths.map((node) => node.getAttribute('d')))
    ).toEqual(
      nextGeometry.bridges.flatMap((bridge) => [
        bridge.path,
        bridge.path,
        bridge.path,
      ])
    );
    // Each current bridge owns one group and its three painted path layers.
    expect(await map.locator('*').count()).toBe(
      nodes + nextGeometry.bridges.length * 4
    );
    expect(await page.locator('canvas').count()).toBe(1);
    expect(errors).toEqual([]);
  }
);

test('painted progress ends at the player at every responsive minimap size', async ({
  page,
}) => {
  await page.goto('/game.html?practice=1&seed=practice-1');
  await waitForSceneAssets(page);
  const map = page.locator('#circuit-minimap');
  // Known geometry tests actual paint independently of the sampling function.
  await map.evaluate((root) => {
    root.removeAttribute('hidden');
    for (const id of ['minimap-halo', 'minimap-course', 'minimap-completed']) {
      root
        .querySelector(`#${id}`)
        ?.setAttribute('d', 'M20 20L140 20L140 140L20 140Z');
    }
    root.querySelector('#minimap-start')?.setAttribute('d', '');
    root.querySelector('#minimap-player')?.setAttribute('r', '0');
  });
  await page.addStyleTag({
    content:
      '#circuit-minimap {display:block !important;top:100px;bottom:auto;background:white;z-index:100} #minimap-halo, #minimap-course {stroke:#888888} #minimap-completed {stroke:#ff0000}',
  });
  for (const width of [88, 100, 120, 140, 160]) {
    await map.evaluate((root, width) => {
      root.style.width = `${width}px`;
    }, width);
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      await page
        .locator('#minimap-completed')
        .evaluate(
          (node, fraction) =>
            node.setAttribute('stroke-dashoffset', String(1 - fraction)),
          fraction
        );
      // Screenshot the real SVG; serializing it into an SVG image uses a
      // different rendering path and does not reproduce the dash-scale bug.
      const png = (await map.screenshot()).toString('base64');
      const painted = await page.evaluate(async (png) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Missing raster context');
        ctx.drawImage(image, 0, 0);
        return [
          [80, 20],
          [140, 80],
          [80, 140],
          [20, 80],
        ].map(([x, y]) => {
          const [r, g] = ctx.getImageData(
            Math.floor((x! * image.width) / 160),
            Math.floor((y! * image.height) / 160),
            1,
            1
          ).data;
          return (r ?? 0) > (g ?? 0) + 80;
        });
      }, png);
      expect(painted, `width=${width}, completion=${fraction}`).toEqual(
        [0.125, 0.375, 0.625, 0.875].map((p) => p < fraction)
      );
    }
  }
});
