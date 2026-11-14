import { expect, test, type Page } from '@playwright/test';
import { setRaceSettingsOpen, waitForSceneAssets } from './scene-ready.ts';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function openPausedGame(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
}

test('sound controls retain native activation without holding the accelerator', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.setViewportSize(
    test.info().project.name === 'chromium'
      ? { width: 640, height: 360 }
      : { width: 320, height: 568 }
  );
  await openPausedGame(page);
  const race = page.locator('#race');
  const sound = page.locator('#sound-toggle');
  await expect(page.locator('#motion-select, #scenery-detail')).toHaveCount(0);
  await expect(page.locator('#race-settings')).not.toHaveAttribute('open');
  await setRaceSettingsOpen(page, true);
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await setRaceSettingsOpen(page, false);
  await page.screenshot({
    path: `test-results/minimal-ready-${test.info().project.name}.png`,
  });
  await setRaceSettingsOpen(page, true);
  // Modal settings explicitly close and restore focus before the primary action.
  await page.keyboard.press('Escape');
  await expect(page.locator('#race-settings > summary')).toBeFocused();
  await page.locator('#start-button').focus();
  await page.keyboard.press('Enter');
  await page.clock.runFor(3100);
  await expect(race).toHaveAttribute('data-phase', 'racing');
  await expect(page.locator('#race-settings')).not.toHaveAttribute('open');
  await expect(sound).toBeHidden();
  await expect(page.locator('#timer')).toBeVisible();
  await expect(page.locator('.race-brand')).toBeHidden();
  await expect(page.locator('#daily-details')).toBeHidden();
  await expect(page.locator('#race-diagnostics')).toBeHidden();
  await expect(page.locator('#speed')).toBeHidden();
  await expect(page.locator('#lap-progress')).toBeHidden();
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await expect(page.locator('#speed')).toHaveText('0');

  await setRaceSettingsOpen(page, true);
  await sound.focus();
  await page.keyboard.press('Space');
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(120);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await expect(page.locator('#speed')).toHaveText('0');
  await page.keyboard.press('Space');
  await expect(sound).toHaveAttribute('aria-pressed', 'false');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(race).toHaveAttribute('data-reduced-motion', 'true');
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await sound.click();
  await setRaceSettingsOpen(page, false);

  // Actual canvas input still moves the same live attempt after using utility controls.
  await page.locator('#race-canvas').focus();
  await page.keyboard.down('Space');
  await page.clock.runFor(200);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  const heldSpeed = Number(await page.locator('#speed').textContent());
  expect(heldSpeed).toBeGreaterThan(0);
  await page.screenshot({
    path: `test-results/minimal-driving-${test.info().project.name}.png`,
  });
  await page.keyboard.up('Space');
  await page.clock.runFor(200);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  expect(Number(await page.locator('#speed').textContent())).toBeLessThan(
    heldSpeed
  );
  await expect(race).toHaveAttribute('data-phase', 'racing');
  expect(errors).toEqual([]);
});

test('device motion and saved sound stay independent without visual settings', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    if (localStorage.getItem('settings-migration-tested')) return;
    localStorage.setItem('settings-migration-tested', 'true');
    localStorage.setItem(
      'reddit-racer:feedback-preferences:v1',
      JSON.stringify({ schemaVersion: 1, muted: false, motion: 'full' })
    );
    localStorage.setItem('reddit-racer.scenery-detail.v1', 'light');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/game.html');
  const race = page.locator('#race');
  await expect(page.locator('#motion-select, #scenery-detail')).toHaveCount(0);
  const sound = page.locator('#sound-toggle');
  await expect(race).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#race-settings')).not.toHaveAttribute('open');
  await setRaceSettingsOpen(page, true);
  await expect(race).toHaveAttribute('data-reduced-motion', 'true');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(race).toHaveAttribute('data-reduced-motion', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await expect(race).toHaveAttribute('data-reduced-motion', 'true');
  await waitForSceneAssets(page);
  await page.reload();
  await expect(race).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#race-settings')).not.toHaveAttribute('open');
  await setRaceSettingsOpen(page, true);
  await expect(race).toHaveAttribute('data-reduced-motion', 'true');
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await expect(race).toHaveAttribute('data-audio-state', 'muted');
  await waitForSceneAssets(page);
  expect(errors).toEqual([]);
});

test('deliberately unavailable browser audio reports its state while real driving remains usable', async ({
  page,
}) => {
  // Negative capability fixture only; the positive audio fixture uses the native API.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: undefined,
    });
  });
  const errors = collectErrors(page);
  await openPausedGame(page);
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-audio-state',
    'unavailable'
  );
  await expect(page.locator('#sound-feedback')).toContainText(/unavailable/i);
  await page.keyboard.down('Space');
  await page.clock.runFor(3300);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(0);
  await page.keyboard.up('Space');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  expect(errors).toEqual([]);
});

test('feedback controls remain reachable at 320 pixels and in compact landscape', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await openPausedGame(page);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 640, height: 360 },
  ]) {
    await page.setViewportSize(viewport);
    await setRaceSettingsOpen(page, true);
    for (const id of ['sound-toggle']) {
      const control = page.locator(`#${id}`);
      await expect(control).toBeVisible();
      await expect(control).toBeEnabled();
      const bounds = await control.boundingBox();
      if (!bounds) throw new Error(`Missing visible feedback control: ${id}`);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
      expect(
        await control.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          );
          return hit === element || element.contains(hit);
        })
      ).toBe(true);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
    await page.screenshot({
      path: `test-results/feedback-controls-${viewport.width}-${test.info().project.name}.png`,
    });
    await setRaceSettingsOpen(page, false);
  }
  expect(errors).toEqual([]);
});
