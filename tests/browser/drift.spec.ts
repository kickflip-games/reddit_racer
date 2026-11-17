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
