import { expect, test } from '@playwright/test';
import { waitForSceneAssets } from './scene-ready';

test('stopped car and camera settle without repeated pose jitter', async ({
  page,
}, info) => {
  await page.route('**/game-scene.ts', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'renderer.render(scene, camera);',
      `raceRoot.dataset.testPose = JSON.stringify({speed: driver.state.speed, lateralVelocity: driver.state.lateralVelocity, position: carVisual.object.position.toArray(), heading: carVisual.object.rotation.y, camera: camera.position.toArray(), projection: camera.projectionMatrix.toArray(), body: carVisual.object.getObjectByName('body')?.rotation.toArray()}); renderer.render(scene, camera);`
    );
    await route.fulfill({ response, body });
  });
  await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
  await page.goto('/game.html?practice=1&seed=country-1');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
  const initial = JSON.parse(
    (await page.locator('#race').getAttribute('data-test-pose')) ?? '{}'
  );
  expect(initial.speed).toBe(0);
  expect(Number.isFinite(initial.heading)).toBe(true);
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(10500);
  await page.keyboard.up('Space');
  const poses: {
    speed: number;
    heading: number;
    position: number[];
    camera: number[];
    projection: number[];
    body?: unknown;
  }[] = [];
  for (let n = 0; n < 40; n++) {
    await page.clock.runFor(100);
    poses.push(
      JSON.parse(
        (await page.locator('#race').getAttribute('data-test-pose')) ?? '{}'
      )
    );
  }
  await info.attach('stopping-poses', {
    body: JSON.stringify(poses),
    contentType: 'application/json',
  });

  await page.screenshot({
    path: `test-results/stopped-${info.project.name}.png`,
  });
  const stop = poses.findIndex(
    (pose, index) =>
      index > 0 && pose.speed === 0 && poses[index - 1]!.speed > 0
  );
  expect(stop).toBeGreaterThan(0);
  const delta = poses[stop]!.heading - poses[stop - 1]!.heading;
  expect(Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)))).toBeLessThan(
    0.12
  );
  expect(poses.at(-1)!.speed).toBe(0);
  const settled = poses.slice(-5);
  for (const pose of settled) {
    expect(pose.position).toEqual(settled[0]!.position);
    expect(pose.heading).toBe(settled[0]!.heading);
    expect(pose.body).toEqual(settled[0]!.body);
    for (const field of ['camera', 'projection'] as const) {
      for (let i = 0; i < pose[field].length; i++)
        expect(Math.abs(pose[field][i]! - settled[0]![field][i]!)).toBeLessThan(
          1e-5
        );
    }
  }
  console.log(
    JSON.stringify({
      viewport: info.project.name,
      stopYawDegrees: (Math.abs(delta) * 180) / Math.PI,
      settledCameraMax: Math.max(
        ...settled.flatMap((pose) =>
          pose.camera.map((v: number, i: number) =>
            Math.abs(v - settled[0]!.camera[i]!)
          )
        )
      ),
    })
  );
  // Existing controls still accelerate after the stop; no simulation clamp added.
  await page.keyboard.down('Space');
  const restartingHeadings: number[] = [poses.at(-1)!.heading];
  for (let n = 0; n < 32; n++) {
    await page.clock.runFor(16);
    restartingHeadings.push(
      JSON.parse(
        (await page.locator('#race').getAttribute('data-test-pose')) ?? '{}'
      ).heading
    );
  }
  const restartSteps = restartingHeadings.slice(1).map((heading, index) => {
    const delta = heading - restartingHeadings[index]!;
    return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
  });
  console.log(
    JSON.stringify({
      maximumRestartYawDegrees: (Math.max(...restartSteps) * 180) / Math.PI,
    })
  );
  expect(Math.max(...restartSteps)).toBeLessThan(0.08);
  expect(
    JSON.parse(
      (await page.locator('#race').getAttribute('data-test-pose')) ?? '{}'
    ).speed
  ).toBeGreaterThan(1);
  await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Restart race', exact: true }).click();
  await page.clock.runFor(100);
  const restarted = JSON.parse(
    (await page.locator('#race').getAttribute('data-test-pose')) ?? '{}'
  );
  expect(restarted.speed).toBe(0);
  expect(restarted.heading).toBe(initial.heading);
  expect(restarted.position).toEqual(initial.position);
});
