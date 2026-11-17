import { test, expect } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

test('two real touches drift; lifting either retains throttle; cancel and blur clear', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/game.html?practice=1&seed=showcase-3');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#start-button').click();
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 3,
  });
  const box = (await page.locator('#race-canvas').boundingBox())!;
  const first = {
    id: 1,
    x: box.x + box.width * 0.3,
    y: box.y + box.height * 0.5,
  };
  const second = {
    id: 2,
    x: box.x + box.width * 0.7,
    y: box.y + box.height * 0.5,
  };
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [first],
  });
  await page.clock.runFor(4200);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [first, second],
  });
  await page.clock.runFor(100);
  await expect(page.locator('#race')).toHaveAttribute('data-drifting', 'true');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [second],
  });
  await page.clock.runFor(50);
  await expect(page.locator('#race')).toHaveAttribute('data-drifting', 'false');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [second, first],
  });
  await page.clock.runFor(50);
  await expect(page.locator('#race')).toHaveAttribute('data-drifting', 'true');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [first],
  });
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#race')).toHaveAttribute('data-drifting', 'false');
});
test('Space and Shift drift, releasing Shift retains throttle', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/game.html?practice=1&seed=showcase-3');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(4200);
  await page.keyboard.down('Shift');
  await page.clock.runFor(100);
  await expect(page.locator('#race')).toHaveAttribute('data-drifting', 'true');
  await page.keyboard.up('Shift');
  await page.clock.runFor(50);
  await expect(page.locator('#race')).toHaveAttribute('data-drifting', 'false');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
  await page.keyboard.up('Space');
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
});

test('unexpected practice capture loss clears both fingers instead of handing off throttle', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/game.html?practice=1&seed=showcase-3');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#start-button').click();
  const canvas = page.locator('#race-canvas');
  await canvas.evaluate((node) =>
    node.addEventListener('pointerdown', (event) => {
      if (event instanceof PointerEvent && event.isPrimary)
        node.setAttribute('data-primary', String(event.pointerId));
    })
  );
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 2,
  });
  const box = (await canvas.boundingBox())!;
  const points = [
    { id: 1, x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 },
    { id: 2, x: box.x + box.width * 0.7, y: box.y + box.height * 0.5 },
  ];
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: points,
  });
  // Establish pending implicit capture before deliberately revoking it.
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: points.map((p) => ({ ...p, x: p.x + 0.5 })),
  });
  await page.clock.runFor(4200);
  await expect(page.locator('#race')).toHaveAttribute('data-drifting', 'true');
  expect(
    await canvas.evaluate((node) =>
      node.hasPointerCapture(Number(node.getAttribute('data-primary')))
    )
  ).toBe(true);
  await canvas.evaluate((node) =>
    node.releasePointerCapture(Number(node.getAttribute('data-primary')))
  );
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: points.map((p) => ({ ...p, x: p.x + 1 })),
  });
  await page.clock.runFor(16);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await expect(page.locator('#race')).toHaveAttribute('data-drifting', 'false');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchCancel',
    touchPoints: [],
  });
});
