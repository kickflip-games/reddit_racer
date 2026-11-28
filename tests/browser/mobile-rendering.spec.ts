import { expect, test, type Page } from '@playwright/test';
import {
  readSceneGraphics,
  setRaceSettingsOpen,
  waitForSceneAssets,
} from './scene-ready.ts';

const epoch = new Date('2026-11-12T00:00:00Z');
const paused = new Date('2026-11-12T00:01:00Z');

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function installNativeCounters(page: Page): Promise<void> {
  // Test-only pass-through instrumentation. It neither replaces rendering nor adds an RAF loop.
  await page.addInitScript(() => {
    let frames = 0;
    let clears = 0;
    let draws = 0;
    let resizes = 0;
    function publish(): void {
      const root = document.documentElement;
      if (!root) return;
      root.dataset.testNativeFrames = String(frames);
      root.dataset.testNativeClears = String(clears);
      root.dataset.testNativeDraws = String(draws);
      root.dataset.testNativeResizes = String(resizes);
    }
    const request = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) =>
      request.call(window, (timestamp) => {
        frames += 1;
        publish();
        callback.call(window, timestamp);
      });
    window.addEventListener('resize', () => {
      resizes += 1;
      publish();
    });
    const prototype = WebGL2RenderingContext.prototype;
    const clear = prototype.clear;
    prototype.clear = function (this: WebGL2RenderingContext, mask) {
      clears += 1;
      publish();
      clear.call(this, mask);
    };
    const drawElements = prototype.drawElements;
    prototype.drawElements = function (
      this: WebGL2RenderingContext,
      mode,
      count,
      type,
      offset
    ) {
      draws += 1;
      publish();
      drawElements.call(this, mode, count, type, offset);
    };
    const drawArrays = prototype.drawArrays;
    prototype.drawArrays = function (
      this: WebGL2RenderingContext,
      mode,
      first,
      count
    ) {
      draws += 1;
      publish();
      drawArrays.call(this, mode, first, count);
    };
    const drawElementsInstanced = prototype.drawElementsInstanced;
    prototype.drawElementsInstanced = function (
      this: WebGL2RenderingContext,
      mode,
      count,
      type,
      offset,
      instances
    ) {
      draws += 1;
      publish();
      drawElementsInstanced.call(this, mode, count, type, offset, instances);
    };
    const drawArraysInstanced = prototype.drawArraysInstanced;
    prototype.drawArraysInstanced = function (
      this: WebGL2RenderingContext,
      mode,
      first,
      count,
      instances
    ) {
      draws += 1;
      publish();
      drawArraysInstanced.call(this, mode, first, count, instances);
    };
  });
}

async function counters(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      frames: Number(root.dataset.testNativeFrames ?? 0),
      clears: Number(root.dataset.testNativeClears ?? 0),
      draws: Number(root.dataset.testNativeDraws ?? 0),
      resizes: Number(root.dataset.testNativeResizes ?? 0),
    };
  });
}

async function openFrozenGame(page: Page): Promise<void> {
  await page.clock.install({ time: epoch });
  await installNativeCounters(page);
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await page.clock.pauseAt(paused);
  await page.clock.runFor(1500);
}

async function expectControlHit(page: Page, id: string): Promise<void> {
  const control = page.locator(`#${id}`);
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  if (!box) throw new Error(`Missing visible control: ${id}`);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Missing browser-test viewport');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(
    await control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2
      );
      return hit === element || element.contains(hit);
    })
  ).toBe(true);
}

test('emulated DPR1/2/3 cap correctly and same-CSS raw DPR changes redraw a paused ready view', async ({
  browser,
  baseURL,
}, info) => {
  if (!baseURL) throw new Error('Missing local browser-test base URL');
  const evidence: Array<{
    label: string;
    graphics: Awaited<ReturnType<typeof readSceneGraphics>>;
    counters?: Awaited<ReturnType<typeof counters>>;
  }> = [];
  const mobile = info.project.name === 'mobile-chromium';
  for (const dpr of [1, 2, 3]) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 320, height: 568 },
      deviceScaleFactor: dpr,
      isMobile: mobile,
      hasTouch: mobile,
    });
    try {
      const page = await context.newPage();
      const errors = collectErrors(page);
      await openFrozenGame(page);
      const initial = await readSceneGraphics(page);
      expect(initial.devicePixelRatio).toBe(dpr);
      expect(initial.canvasCss).toEqual([320, 568]);
      expect(initial.drawingBuffer).toEqual([
        320 * Math.min(dpr, 2),
        568 * Math.min(dpr, 2),
      ]);
      evidence.push({
        label: 'Fresh browser-emulated DPR; not a physical display',
        graphics: initial,
      });
      if (dpr === 3) {
        const session = await context.newCDPSession(page);
        for (const nextDpr of [4, 1.5]) {
          const before = await counters(page);
          await session.send('Emulation.setDeviceMetricsOverride', {
            width: 320,
            height: 568,
            deviceScaleFactor: nextDpr,
            mobile,
          });
          // Native DPR overrides can omit MQL/resize events; allow the real RAF guard to run.
          await page.clock.runFor(32);
          await expect
            .poll(async () => (await readSceneGraphics(page)).drawingBuffer)
            .toEqual([
              Math.floor(320 * Math.min(nextDpr, 2)),
              Math.floor(568 * Math.min(nextDpr, 2)),
            ]);
          const current = await readSceneGraphics(page);
          expect(current.devicePixelRatio).toBe(nextDpr);
          expect(current.canvasCss).toEqual(initial.canvasCss);
          if (nextDpr === 1.5)
            await expect
              .poll(async () => (await counters(page)).clears)
              .toBeGreaterThan(before.clears);
          await expect(page.locator('#race')).toHaveAttribute(
            'data-phase',
            'ready'
          );
          await expect(page.locator('#timer')).toHaveText('00.0');
          const glError = await page
            .locator('#race-canvas')
            .evaluate((canvas) => {
              if (!(canvas instanceof HTMLCanvasElement))
                throw new Error('Missing real canvas');
              const gl = canvas.getContext('webgl2');
              if (!gl) throw new Error('Missing real WebGL2 context');
              return gl.getError();
            });
          expect(glError).toBe(0);
          evidence.push({
            label:
              'Same-CSS native CDP DPR override; one scheduled render opportunity, unchanged inactive simulation',
            graphics: current,
            counters: await counters(page),
          });
        }
        await page.screenshot({
          path: `test-results/mobile-dpr-emulation-${info.project.name}.png`,
        });
        await session.detach();
      }
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  }
  await info.attach('emulated-resolution-evidence', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});

test('home preview draws while moving, reduced-motion home settles, and real driving retains every frame', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 393, height: 852 });
  await openFrozenGame(page);
  await setRaceSettingsOpen(page, true);
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-toggle')).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.clock.runFor(300);
  await setRaceSettingsOpen(page, false);
  const before = await counters(page);
  await page.clock.runFor(300);
  const moving = await counters(page);
  expect(moving.frames - before.frames).toBeGreaterThanOrEqual(10);
  expect(moving.draws).toBeGreaterThan(before.draws);
  await setRaceSettingsOpen(page, true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(async () => (await counters(page)).clears)
    .toBeGreaterThan(moving.clears);
  const preference = await counters(page);
  await setRaceSettingsOpen(page, false);
  await page.clock.runFor(300);
  const settled = await counters(page);
  await page.clock.runFor(300);
  const idle = await counters(page);
  expect(idle.clears).toBe(settled.clears);
  expect(idle.draws).toBe(settled.draws);
  await page.setViewportSize({ width: 381, height: 700 });
  await expect
    .poll(async () => (await counters(page)).clears)
    .toBeGreaterThan(preference.clears);
  await expect(page.locator('#timer')).toHaveText('00.0');
  const activeBefore = await counters(page);
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(3300);
  const active = await counters(page);
  expect(active.frames - activeBefore.frames).toBeGreaterThan(100);
  expect(active.clears - activeBefore.clears).toBeGreaterThanOrEqual(
    active.frames - activeBefore.frames - 2
  );
  expect(active.draws).toBeGreaterThan(activeBefore.draws);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await page.clock.runFor(100);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  expect(errors).toEqual([]);
  await test.info().attach('native-render-invalidation', {
    body: JSON.stringify(
      {
        label:
          'Pass-through native draw counters under controlled animation clock, not presented FPS',
        before,
        idle,
        preference,
        activeBefore,
        active,
      },
      null,
      2
    ),
    contentType: 'application/json',
  });
});

test('PRESENTATION FIXTURE keeps enlarged text, native safe areas, settings and scrolled Retry keyboard focus usable', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 393, height: 852 });
  const session = await page.context().newCDPSession(page);
  const insets = { top: 28, right: 22, bottom: 26, left: 24 };
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets });
  await openFrozenGame(page);
  const scaling = await page.evaluate(() => {
    function element(id: string): HTMLElement {
      const found = document.getElementById(id);
      if (!found) throw new Error(`Missing layout fixture element: ${id}`);
      return found;
    }
    element('mode-label').textContent = 'UI FIXTURE';
    element('card-title').textContent = 'PRESENTATION FIXTURE';
    element('card-copy').textContent =
      'A long unverified-response message remains readable while standings and actions can be reached by keyboard. No race was driven and no result was submitted.';
    element('card').dataset.leaderboard = 'true';
    element('start-button').hidden = true;
    element('retry-button').hidden = false;
    element('retry-label').textContent = 'Fixture Retry';
    element('track-note').textContent =
      'PRESENTATION FIXTURE: no race or leaderboard claim.';
    element('result-summary').hidden = false;
    element('leaderboard-me').textContent =
      'Presentation fixture with a long racer name: VeryLongRacingName_ForTextEnlargementAndWrapping_Only';
    element('leaderboard-outcome').hidden = false;
    element('leaderboard-outcome').textContent =
      'No score or improvement is claimed by this fixture.';
    element('result-target').hidden = false;
    element('result-target').textContent =
      'Additional text checks card scrolling and clear action placement.';
    element('leaderboard').hidden = false;
    element('leaderboard-status').textContent =
      'Synthetic layout rows only; no authenticated competition.';
    element('leaderboard-top').hidden = false;
    const body = element('leaderboard-top').querySelector('tbody');
    if (!body) throw new Error('Missing source standings table');
    for (let index = 0; index < 12; index += 1) {
      const row = document.createElement('tr');
      for (const value of [
        '—',
        `LayoutRacer_${index}_WithALongFixtureNameForTextSizing`,
        'fixture',
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    }
    const copy = element('card-copy');
    const before = Number.parseFloat(getComputedStyle(copy).fontSize);
    const fonts = Array.from(
      document.querySelectorAll<HTMLElement>('body *')
    ).map((node) => ({
      node,
      size: Number.parseFloat(getComputedStyle(node).fontSize),
    }));
    for (const { node, size } of fonts)
      if (Number.isFinite(size) && size > 0)
        node.style.fontSize = `${size * 2}px`;
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)';
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const safeArea = {
      top: Number.parseFloat(style.paddingTop),
      right: Number.parseFloat(style.paddingRight),
      bottom: Number.parseFloat(style.paddingBottom),
      left: Number.parseFloat(style.paddingLeft),
    };
    probe.remove();
    return {
      label:
        'Labelled DOM text-only enlargement fixture; native CDP safe-area emulation, not OS zoom or a physical notch',
      before,
      after: Number.parseFloat(getComputedStyle(copy).fontSize),
      safeArea,
    };
  });
  expect(scaling.after).toBe(scaling.before * 2);
  expect(scaling.safeArea).toEqual(insets);
  for (const viewport of [
    { width: 393, height: 852 },
    { width: 640, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await setRaceSettingsOpen(page, true);
    for (const id of ['sound-toggle']) {
      await page.locator(`#${id}`).focus();
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await expectControlHit(page, id);
      const box = await page.locator(`#${id}`).boundingBox();
      if (!box) throw new Error('Missing enlarged setting');
      expect(box.x).toBeGreaterThanOrEqual(insets.left);
      expect(box.x + box.width).toBeLessThanOrEqual(
        viewport.width - insets.right
      );
      expect(box.y + box.height).toBeLessThanOrEqual(
        viewport.height - insets.bottom
      );
    }
    await page.screenshot({
      path: `test-results/mobile-enlarged-settings-${viewport.width}-${test.info().project.name}.png`,
    });
    await setRaceSettingsOpen(page, false);
    await page.locator('#leaderboard-title').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#leaderboard-details')).toHaveAttribute('open');
    await page.keyboard.press('Tab');
    await expect(page.locator('#leaderboard-refresh')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#leaderboard-title')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#retry-button')).toBeFocused();
    await expectControlHit(page, 'retry-button');
    const focus = await page.locator('#retry-button').evaluate((button) => {
      const card = document.getElementById('card');
      if (!card) throw new Error('Missing source card');
      const bounds = button.getBoundingClientRect();
      const clip = card.getBoundingClientRect();
      const style = getComputedStyle(button);
      const outset = Math.max(
        0,
        Number.parseFloat(style.outlineWidth) +
          Number.parseFloat(style.outlineOffset)
      );
      return {
        top: bounds.top - outset,
        bottom: bounds.bottom + outset,
        clipTop: clip.top + card.clientTop,
        clipBottom: clip.top + card.clientTop + card.clientHeight,
      };
    });
    expect(focus.top).toBeGreaterThanOrEqual(focus.clipTop - 0.5);
    expect(focus.bottom).toBeLessThanOrEqual(focus.clipBottom + 0.5);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: `test-results/mobile-enlarged-safe-area-${viewport.width}-${test.info().project.name}.png`,
    });
    await page.locator('#leaderboard-details').evaluate((details) => {
      if (!(details instanceof HTMLDetailsElement))
        throw new Error('Missing native standings');
      details.open = false;
    });
  }
  expect(errors).toEqual([]);
  await test.info().attach('emulated-safe-area-and-text', {
    body: JSON.stringify(scaling, null, 2),
    contentType: 'application/json',
  });
  await session.detach();
});

test('an undersized view interrupts a real held attempt and restores accessible Retry without automatic racing', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await openFrozenGame(page);
  await setRaceSettingsOpen(page, true);
  await page.locator('#sound-toggle').click();
  await setRaceSettingsOpen(page, false);
  await page.setViewportSize({ width: 320, height: 320 });
  await expect(page.locator('#race')).toHaveAttribute(
    'data-viewport-usable',
    'true'
  );
  await expect(page.locator('#viewport-message')).toBeHidden();
  await expectControlHit(page, 'start-button');
  expect((await readSceneGraphics(page)).canvasCss).toEqual([320, 320]);
  await page.screenshot({
    path: `test-results/mobile-minimum-320-${test.info().project.name}.png`,
  });
  await setRaceSettingsOpen(page, true);
  await expectControlHit(page, 'sound-toggle');
  await page.screenshot({
    path: `test-results/mobile-minimum-settings-320-${test.info().project.name}.png`,
  });
  await setRaceSettingsOpen(page, false);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(3300);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(0);
  await page.setViewportSize({ width: 240, height: 220 });
  await expect(page.locator('#race')).toHaveAttribute(
    'data-viewport-usable',
    'false'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'abandoned'
  );
  expect(
    await page
      .locator('#race')
      .evaluate((root) => root instanceof HTMLElement && root.inert)
  ).toBe(true);
  await expect(page.locator('#viewport-message')).toBeVisible();
  await expect(page.locator('#viewport-message')).toContainText(
    /rotate.*expand/i
  );
  await expect(page.locator('#viewport-message')).toBeFocused();
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await page.keyboard.up('Space');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight
    )
  ).toBe(true);
  await page.screenshot({
    path: `test-results/mobile-too-small-${test.info().project.name}.png`,
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator('#race')).toHaveAttribute(
    'data-viewport-usable',
    'true'
  );
  await expect(page.locator('#viewport-message')).toBeHidden();
  await expect(page.locator('#card-title')).toBeFocused();
  await expect(page.locator('#card-copy')).toContainText(
    'The view became too small'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'abandoned'
  );
  const time = await page.locator('#timer').textContent();
  if (time === null) throw new Error('Missing interrupted timer');
  await page.clock.runFor(100);
  await expect(page.locator('#timer')).toHaveText(time);
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
  await expect(page.locator('#timer')).toHaveText('00.0');
  await expect(page.locator('#speed')).toHaveText('0');
  expect(errors).toEqual([]);
});
