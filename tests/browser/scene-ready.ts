import { expect, type Page } from '@playwright/test';

/** Healthy initialized scenes must finish asset I/O before an artificial clock jump. */
export async function waitForSceneAssets(page: Page): Promise<void> {
  const scene = page.locator('#race');
  await expect(scene).toHaveAttribute('data-car-load', 'ready');
  await expect(scene).toHaveAttribute('data-car-art', 'kenney');
  await expect(scene).toHaveAttribute('data-scenery-art', 'kenney');
}

/** Use the same native disclosure a player opens; it is collapsed for each attempt. */
export async function setRaceSettingsOpen(
  page: Page,
  open: boolean
): Promise<void> {
  const settings = page.locator('#race-settings');
  const current = await settings.evaluate((element) => {
    if (!(element instanceof HTMLDetailsElement))
      throw new Error('Missing native race settings');
    return element.open;
  });
  if (current !== open) {
    if (open) await settings.locator(':scope > summary').click();
    else await page.locator('#settings-close').click();
  }
  if (open) {
    await expect(settings).toHaveAttribute('open');
    await expect(page.locator('#settings-dialog')).toBeVisible();
  } else await expect(settings).not.toHaveAttribute('open');
}

/** Read the real game context for CI evidence; no renderer or driver is replaced. */
export async function readSceneGraphics(page: Page) {
  return page.locator('#race-canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement))
      throw new Error('Missing real game canvas');
    const context = canvas.getContext('webgl2');
    if (!context) throw new Error('Missing active WebGL2 context');
    const gl = context;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    function textParameter(parameter: number): string {
      const value: unknown = gl.getParameter(parameter);
      return typeof value === 'string' ? value : 'unavailable';
    }
    return {
      label: 'Actual game context; runtime metadata, not presented FPS',
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio,
      viewport: [innerWidth, innerHeight],
      canvasCss: [canvas.clientWidth, canvas.clientHeight],
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      version: textParameter(gl.VERSION),
      vendor: textParameter(gl.VENDOR),
      renderer: textParameter(gl.RENDERER),
      unmaskedVendor: debug
        ? textParameter(debug.UNMASKED_VENDOR_WEBGL)
        : 'unavailable',
      unmaskedRenderer: debug
        ? textParameter(debug.UNMASKED_RENDERER_WEBGL)
        : 'unavailable',
      attributes: gl.getContextAttributes(),
    };
  });
}

export async function openPracticeModes(page: Page): Promise<void> {
  const modes = page.locator('#practice-modes');
  if ((await modes.count()) && !(await modes.getAttribute('open'))) {
    const open = await modes.evaluate(
      (e) => e instanceof HTMLDetailsElement && e.open
    );
    if (!open) await modes.locator(':scope > summary').click();
  }
}

/** Advance every real rendered frame, stopping as soon as the observed state is reached. */
export async function advanceRaceClockUntil(
  page: Page,
  condition: () => Promise<boolean>,
  maximumMilliseconds: number
): Promise<void> {
  for (let elapsed = 0; elapsed < maximumMilliseconds; elapsed += 1000) {
    if (await condition()) return;
    await page.clock.runFor(Math.min(1000, maximumMilliseconds - elapsed));
  }
  expect(await condition()).toBe(true);
}
