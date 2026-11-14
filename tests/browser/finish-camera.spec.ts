import { expect, test } from '@playwright/test';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { createSimulationDriver } from '../../src/client/simulation-driver.ts';
import { waitForSceneAssets } from './scene-ready.ts';

const driver = createSimulationDriver(
  generateElevatedCircuit('country-1').track
);
driver.start(0);
driver.setInput(true, 0);
let finish = 0;
for (let tick = 1; driver.active && tick < 20000; tick++) {
  finish = (tick * 1000) / 120;
  driver.advance(finish);
}
if (driver.raceState.phase !== 'finished')
  throw new Error('Missing reference finish');

test('default one-lap finish does not reframe the camera when results appear', async ({
  page,
}) => {
  // Observe the production renderer without replacing simulation or camera code.
  await page.route(
    (url) => url.pathname.endsWith('/game-scene.ts'),
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const observed = body.replace(
        /renderer\.render\(scene,\s*camera\);/,
        `raceRoot.dataset.testCamera = JSON.stringify({
        car: carVisual.object.position.clone().project(camera).toArray(),
        position: camera.position.toArray(),
        projection: camera.projectionMatrix.toArray()
      }); renderer.render(scene, camera);`
      );
      expect(observed).not.toBe(body);
      await route.fulfill({ response, body: observed });
    }
  );
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.goto('/game.html');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-12T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  const epoch = await page.evaluate(() => performance.now());
  const advanceTo = async (ms: number) => {
    const now = await page.evaluate(() => performance.now());
    await page.clock.runFor(Math.max(0, epoch + ms - now));
  };
  await advanceTo(finish - 100);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
  const carBefore = JSON.parse(
    (await page.locator('#race').getAttribute('data-test-camera')) ?? '{}'
  ).car;
  const before = await page.locator('#race').evaluate((e) => ({
    top: e.style.getPropertyValue('--hud-bottom'),
    bottom: e.style.getPropertyValue('--footer-inset'),
  }));
  await page.screenshot({
    path: `test-results/finish-before-${test.info().project.name}.png`,
  });
  await advanceTo(finish + 100);
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'finished');
  await expect(page.locator('#retry-button')).toBeVisible();
  const after = await page.locator('#race').evaluate((e) => ({
    top: e.style.getPropertyValue('--hud-bottom'),
    bottom: e.style.getPropertyValue('--footer-inset'),
  }));
  await page.screenshot({
    path: `test-results/finish-after-${test.info().project.name}.png`,
  });
  await test.info().attach('finish-camera-insets', {
    body: JSON.stringify({ before, after }),
    contentType: 'application/json',
  });
  expect(after).toEqual(before);
  const carAfter = JSON.parse(
    (await page.locator('#race').getAttribute('data-test-camera')) ?? '{}'
  ).car;
  // 200 ms of genuine driving may move a few pixels, not reframe half the view.
  expect(
    Math.hypot(carAfter[0] - carBefore[0], carAfter[1] - carBefore[1])
  ).toBeLessThan(0.1);
  await page.clock.runFor(500);
  await expect(page.locator('#retry-button')).toBeVisible();
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-phase',
    'countdown'
  );
});
