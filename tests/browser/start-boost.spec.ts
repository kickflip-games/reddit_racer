import { expect, test, type Page } from '@playwright/test';
import { START_BOOST_SPEED } from '../../src/shared/start-boost';
import { waitForSceneAssets } from './scene-ready';

type Launch = {
  tick: number;
  speed: number;
  distance: number;
  awarded: boolean;
};
async function state(page: Page): Promise<Launch> {
  return JSON.parse(
    (await page.locator('#race').getAttribute('data-test-launch')) ?? '{}'
  );
}
async function boot(page: Page, entry = '/game.html') {
  // Observe authoritative simulation without changing input or physics.
  await page.route('**/game-scene.ts*', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'renderer.render(scene, camera);',
      `raceRoot.dataset.testLaunch = JSON.stringify({ tick: driver.state.tick, speed: driver.state.speed, distance: driver.state.distance, awarded: driver.state.startBoostTick != null }); renderer.render(scene, camera);`
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
    };
  const session = await page.context().newCDPSession(page);
  const box = (await page.locator('#race-canvas').boundingBox())!;
  return {
    down: () =>
      session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          { id: 1, x: box.x + box.width * 0.3, y: box.y + box.height * 0.6 },
        ],
      }),
    up: () =>
      session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      }),
  };
}

for (const entry of ['/game.html', '/game.html?practice=1']) {
  for (const reduced of [false, true]) {
    test(`${entry === '/game.html' && !reduced ? '@smoke ' : ''}timely start awards a small bonus and resets: ${entry}, reduced motion ${reduced}`, async ({
      page,
      isMobile,
    }, info) => {
      if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
      await boot(page, entry);
      const input = await controls(page, isMobile);
      await page.clock.runFor(3100);
      await expect(page.locator('#race-countdown')).toHaveText('GO!');
      const waiting = await state(page);
      expect(waiting.tick).toBeGreaterThan(0);
      expect(waiting.tick).toBeLessThanOrEqual(36);
      expect(waiting.speed).toBe(0);
      expect(waiting.distance).toBe(0);
      await input.down();
      await page.clock.runFor(50);
      const launched = await state(page);
      expect(launched.awarded).toBe(true);
      expect(launched.speed).toBeGreaterThan(START_BOOST_SPEED);
      expect(launched.speed).toBeLessThan(START_BOOST_SPEED + 2);
      await expect(page.locator('#race-countdown')).toHaveText(
        'Perfect start!'
      );
      await page.screenshot({ path: info.outputPath('perfect-start.png') });
      await input.up();
      await page
        .getByRole('button', { name: 'Restart race', exact: true })
        .click();
      await page.clock.runFor(100);
      expect((await state(page)).awarded).toBe(false);
      expect((await state(page)).speed).toBe(0);
      await expect(page.locator('#race-countdown')).not.toHaveText(
        'Perfect start!'
      );
    });
  }
}

test('early held and late starts accelerate normally without a bonus or penalty', async ({
  page,
  isMobile,
}) => {
  await boot(page);
  const input = await controls(page, isMobile);
  await input.down();
  await page.clock.runFor(1000);
  expect((await state(page)).speed).toBe(0);
  expect((await state(page)).tick).toBe(0);
  await page.clock.runFor(2150);
  const early = await state(page);
  expect(early.awarded).toBe(false);
  expect(early.speed).toBeGreaterThan(0);
  await expect(page.locator('#race-countdown')).not.toHaveText(
    'Perfect start!'
  );
  await input.up();
  await page.getByRole('button', { name: 'Restart race', exact: true }).click();
  await page.clock.runFor(3500);
  expect((await state(page)).tick).toBeGreaterThan(36);
  expect((await state(page)).speed).toBe(0);
  await input.down();
  await page.clock.runFor(150);
  const late = await state(page);
  expect(late.awarded).toBe(false);
  expect(late.speed).toBeGreaterThan(0);
  // Same ordinary acceleration, allowing one render-frame alignment difference.
  expect(Math.abs(late.speed - early.speed)).toBeLessThan(0.5);
  await expect(page.locator('#race-countdown')).not.toHaveText(
    'Perfect start!'
  );
  await input.up();
});
