import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready.ts';

type TouchPoint = { x: number; y: number; id: number };

async function prepareTouchRace(page: Page) {
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.clock.runFor(3100);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  const canvas = page.locator('#race-canvas');
  await canvas.evaluate((node) =>
    node.addEventListener('pointerdown', (event) => {
      if (event instanceof PointerEvent) {
        node.setAttribute(
          event.isPrimary ? 'data-test-primary' : 'data-test-secondary',
          String(event.pointerId)
        );
      }
    })
  );
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Race canvas is missing');
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  return {
    canvas,
    session,
    point: { x: box.x + box.width * 0.5, y: box.y + box.height * 0.45, id: 1 },
    box,
  };
}

async function touch(
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  points: TouchPoint[]
) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

async function pagePosition(page: Page) {
  return page.evaluate(() => ({
    x: scrollX,
    y: scrollY,
    scale: visualViewport?.scale,
    selection: getSelection()?.toString(),
  }));
}

test('native touch holds, captures outside movement, brakes, finishes and retries without scrolling', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { canvas, session, point, box } = await prepareTouchRace(page);
  const position = await pagePosition(page);
  await touch(session, 'touchStart', [point]);
  await page.clock.runFor(700);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  const pointerId = Number(await canvas.getAttribute('data-test-primary'));
  expect(
    await canvas.evaluate((node, id) => node.hasPointerCapture(id), pointerId)
  ).toBe(true);
  const menuAllowed = await canvas.evaluate((node) =>
    node.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    )
  );
  expect(menuAllowed).toBe(false);
  await touch(session, 'touchMove', [{ ...point, x: box.x + box.width + 20 }]);
  await page.clock.runFor(300);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  const speed = Number(await page.locator('#speed').textContent());
  expect(speed).toBeGreaterThan(0);
  await touch(session, 'touchEnd', []);
  await page.clock.runFor(300);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  expect(Number(await page.locator('#speed').textContent())).toBeLessThan(
    speed
  );
  expect(
    await canvas.evaluate((node, id) => node.hasPointerCapture(id), pointerId)
  ).toBe(false);
  expect(await pagePosition(page)).toEqual(position);

  await touch(session, 'touchStart', [{ ...point, id: 2 }]);
  await page.clock.runFor(9000);
  await page.screenshot({ path: 'test-results/touch-driving-mobile.png' });
  await page.clock.runFor(11000);
  await expect(page.locator('#card-kicker')).toHaveText('');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  const lastPointer = Number(await canvas.getAttribute('data-test-primary'));
  expect(
    await canvas.evaluate((node, id) => node.hasPointerCapture(id), lastPointer)
  ).toBe(false);
  await touch(session, 'touchEnd', []);
  await page.locator('#retry-button').click();
  await page.clock.runFor(32);
  expect(Number(await page.locator('#timer').textContent())).toBeLessThan(0.5);
  await expect(page.locator('#speed')).toHaveText('0');
  expect(await pagePosition(page)).toEqual(position);
  expect(errors).toEqual([]);
});

test('combined Space and touch release independently and cancellation brakes safely', async ({
  page,
}) => {
  const { canvas, session, point } = await prepareTouchRace(page);
  await page.keyboard.down('Space');
  await touch(session, 'touchStart', [point]);
  await page.clock.runFor(200);
  await touch(session, 'touchEnd', []);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await page.keyboard.up('Space');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');

  await touch(session, 'touchStart', [{ ...point, id: 2 }]);
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await page.clock.runFor(500);
  const speed = Number(await page.locator('#speed').textContent());
  const pointerId = Number(await canvas.getAttribute('data-test-primary'));
  await touch(session, 'touchCancel', []);
  await page.clock.runFor(300);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  expect(Number(await page.locator('#speed').textContent())).toBeLessThan(
    speed
  );
  expect(
    await canvas.evaluate((node, id) => node.hasPointerCapture(id), pointerId)
  ).toBe(false);
});

test('secondary touches do not replace capture and focus cleanup releases the primary', async ({
  page,
}) => {
  const { canvas, session, point } = await prepareTouchRace(page);
  await touch(session, 'touchStart', [point]);
  await touch(session, 'touchStart', [
    point,
    { ...point, x: point.x + 50, id: 2 },
  ]);
  // Process pending implicit capture with a real movement before testing its loss.
  await touch(session, 'touchMove', [
    { ...point, x: point.x + 1 },
    { ...point, x: point.x + 50, id: 2 },
  ]);
  await page.clock.runFor(100);
  const primary = Number(await canvas.getAttribute('data-test-primary'));
  const secondary = Number(await canvas.getAttribute('data-test-secondary'));
  expect(Number.isInteger(secondary)).toBe(true);
  expect(
    await canvas.evaluate((node, id) => node.hasPointerCapture(id), primary)
  ).toBe(true);
  // Browsers implicitly capture touch pointers, even though only the primary owns game input.
  await canvas.evaluate((node, id) => node.releasePointerCapture(id), primary);
  await touch(session, 'touchMove', [
    { ...point, x: point.x + 2 },
    { ...point, x: point.x + 50, id: 2 },
  ]);
  await page.clock.runFor(16);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await touch(session, 'touchCancel', []);

  await touch(session, 'touchStart', [{ ...point, id: 3 }]);
  await page.clock.runFor(100);
  const captured = Number(await canvas.getAttribute('data-test-primary'));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#card-title')).toHaveText('Race interrupted.');
  expect(
    await canvas.evaluate((node, id) => node.hasPointerCapture(id), captured)
  ).toBe(false);
  await touch(session, 'touchCancel', []);
});
