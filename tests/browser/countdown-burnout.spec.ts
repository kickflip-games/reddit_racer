import { expect, test, type Page } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

type Pose = {
  tick: number;
  speed: number;
  distance: number;
  position: number[];
  wheel: number[];
  smoke: number;
};

async function pose(page: Page): Promise<Pose> {
  return JSON.parse(
    (await page.locator('#race').getAttribute('data-test-burnout')) ?? '{}'
  );
}

async function boot(page: Page, entry = '/game.html'): Promise<void> {
  // Observe actual rendered objects and authoritative state without replacing either.
  await page.route('**/game-scene.ts', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'renderer.render(scene, camera);',
      `const smoke = drivingVfx.object.getObjectByName('tyre-smoke');
      raceRoot.dataset.testBurnout = JSON.stringify({
        tick: driver.state.tick,
        speed: driver.state.speed,
        distance: driver.state.distance,
        position: carVisual.object.position.toArray(),
        wheel: carVisual.object.getObjectByName('wheel-back-left')?.quaternion.toArray(),
        smoke: smoke instanceof THREE.Points ? smoke.geometry.drawRange.count : -1
      });
      renderer.render(scene, camera);`
    );
    await route.fulfill({ response, body });
  });
  await page.clock.install();
  await page.goto(entry);
  await waitForSceneAssets(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
}

async function controls(page: Page, mobile: boolean) {
  if (!mobile)
    return {
      down: () => page.keyboard.down('Space'),
      up: () => page.keyboard.up('Space'),
      cancel: () => page.keyboard.up('Space'),
    };
  const session = await page.context().newCDPSession(page);
  const box = (await page.locator('#race-canvas').boundingBox())!;
  const point = {
    id: 1,
    x: box.x + box.width * 0.3,
    y: box.y + box.height * 0.6,
  };
  return {
    down: () =>
      session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point],
      }),
    up: () =>
      session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      }),
    cancel: () =>
      session.send('Input.dispatchTouchEvent', {
        type: 'touchCancel',
        touchPoints: [],
      }),
  };
}

for (const entry of ['/game.html', '/game.html?practice=1&seed=practice-1']) {
  test(`holding countdown spins tyres and smoke without movement, then accelerates: ${entry}`, async ({
    page,
    isMobile,
  }, info) => {
    await boot(page, entry);
    const input = await controls(page, isMobile);
    const initial = await pose(page);
    expect(initial.tick).toBe(0);
    expect(initial.smoke).toBe(0);
    await input.down();
    await page.clock.runFor(700);
    const burning = await pose(page);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'countdown'
    );
    await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
    expect(burning.tick).toBe(0);
    expect(burning.speed).toBe(0);
    expect(burning.distance).toBe(0);
    expect(burning.position).toEqual(initial.position);
    expect(burning.wheel).not.toEqual(initial.wheel);
    expect(burning.smoke).toBeGreaterThan(0);
    await page.clock.runFor(100);
    expect((await pose(page)).wheel).not.toEqual(burning.wheel);
    await page.clock.runFor(1400);
    await expect(page.locator('#race')).toHaveAttribute(
      'data-phase',
      'countdown'
    );
    await page.screenshot({ path: info.outputPath('countdown-burnout.png') });
    await page.clock.runFor(1100);
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
    const running = await pose(page);
    expect(running.tick).toBeGreaterThan(0);
    expect(running.speed).toBeGreaterThan(0);
    expect(running.distance).toBeGreaterThan(0);
    await expect(page.locator('#status')).toHaveAttribute('data-held', 'true');
    await input.up();
    await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  });
}

test('release, cancellation, restart and focus loss clear countdown burnout', async ({
  page,
  isMobile,
}) => {
  await boot(page);
  const input = await controls(page, isMobile);
  await input.down();
  await page.clock.runFor(300);
  expect((await pose(page)).smoke).toBeGreaterThan(0);
  await input.up();
  await page.clock.runFor(100);
  const released = await pose(page);
  await page.clock.runFor(900);
  const settled = await pose(page);
  expect(settled.tick).toBe(0);
  expect(settled.speed).toBe(0);
  expect(settled.position).toEqual(released.position);
  expect(settled.wheel).toEqual(released.wheel);
  expect(settled.smoke).toBe(0);
  await input.down();
  await page.clock.runFor(150);
  await input.cancel();
  await page.clock.runFor(100);
  const cancelled = await pose(page);
  await page.clock.runFor(100);
  expect((await pose(page)).wheel).toEqual(cancelled.wheel);
  await page.getByRole('button', { name: 'Restart race', exact: true }).click();
  await page.clock.runFor(100);
  expect((await pose(page)).smoke).toBe(0);
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await input.down();
  await page.clock.runFor(150);
  expect((await pose(page)).smoke).toBeGreaterThan(0);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(100);
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'abandoned'
  );
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  expect((await pose(page)).smoke).toBe(0);
  await input.up();
});

test('reduced motion suppresses countdown decoration without losing held start input', async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page);
  const initial = await pose(page);
  const input = await controls(page, isMobile);
  await input.down();
  await page.clock.runFor(900);
  const held = await pose(page);
  expect(held.tick).toBe(0);
  expect(held.speed).toBe(0);
  expect(held.position).toEqual(initial.position);
  expect(held.wheel).toEqual(initial.wheel);
  expect(held.smoke).toBe(0);
  await page.clock.runFor(2400);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  expect((await pose(page)).speed).toBeGreaterThan(0);
  await input.up();
});
