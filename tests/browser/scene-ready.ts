import { expect, type Page } from '@playwright/test';

/** Healthy initialized scenes must finish asset I/O before an artificial clock jump. */
export async function waitForSceneAssets(page: Page): Promise<void> {
  const scene = page.locator('#race');
  await expect(scene).toHaveAttribute('data-car-load', 'ready');
  await expect(scene).toHaveAttribute('data-car-art', 'kenney');
  await expect(scene).toHaveAttribute('data-scenery-art', 'kenney');
}
