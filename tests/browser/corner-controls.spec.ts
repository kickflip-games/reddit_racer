import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 960, height: 540 },
  { width: 640, height: 360 },
]) {
  test(
    'corner controls remain usable at ' +
      viewport.width +
      'x' +
      viewport.height,
    async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.clock.install({ time: new Date('2026-11-15T00:00:00Z') });
      await page.goto('/game.html?practice=1&word=banana&wordVersion=2');
      await waitForSceneAssets(page);
      await expect(page.locator('#race')).toHaveAttribute(
        'data-phase',
        'ready'
      );
      await page.clock.pauseAt(new Date('2026-11-15T00:01:00Z'));
      const restart = page.getByRole('button', {
        name: 'Restart race',
        exact: true,
      });
      const settings = page.locator('#race-settings > summary');
      await expect(settings).toHaveAttribute('aria-label', 'Settings');
      await expect(settings).toHaveText('');
      await expect(restart).toBeHidden();
      await settings.click();
      await expect(
        page.getByRole('dialog', { name: 'Settings' })
      ).toBeVisible();
      await expect(page.locator('#race')).toHaveAttribute(
        'data-phase',
        'ready'
      );
      await page.getByRole('button', { name: 'Close settings' }).click();
      await expect(settings).toBeFocused();
      await page.locator('#start-button').click();
      await page.clock.runFor(20);
      await expect(restart).toBeVisible();
      const boxes = await Promise.all([
        restart.boundingBox(),
        settings.boundingBox(),
      ]);
      const [r, s] = boxes;
      if (!r || !s) throw new Error('Missing corner control bounds');
      expect(r.width).toBeGreaterThanOrEqual(44);
      expect(r.height).toBeGreaterThanOrEqual(44);
      expect(s.width).toBeGreaterThanOrEqual(44);
      expect(s.height).toBeGreaterThanOrEqual(44);
      expect(r.x + r.width).toBeLessThanOrEqual(viewport.width - 14);
      expect(r.x + r.width).toBeGreaterThanOrEqual(viewport.width - 16);
      expect(r.y).toBeGreaterThanOrEqual(14);
      expect(r.y).toBeLessThanOrEqual(16);
      expect(s.x).toBeGreaterThanOrEqual(14);
      expect(s.x).toBeLessThanOrEqual(16);
      expect(s.y + s.height).toBeLessThanOrEqual(viewport.height - 14);
      expect(s.y + s.height).toBeGreaterThanOrEqual(viewport.height - 16);
      await page.clock.runFor(3080);
      await expect(page.locator('#race')).toHaveAttribute(
        'data-phase',
        'racing'
      );
      await page.screenshot({
        path: 'test-results/corner-controls-' + viewport.width + '.png',
      });
      await settings.click();
      await expect(
        page.getByRole('dialog', { name: 'Settings' })
      ).toBeVisible();
      await page.getByRole('button', { name: 'Close settings' }).click();
      await restart.click();
      await expect(page.locator('#race')).toHaveAttribute(
        'data-phase',
        'countdown'
      );
      await expect(page.locator('#race')).not.toHaveAttribute(
        'data-settings-open',
        'true'
      );
    }
  );
}
