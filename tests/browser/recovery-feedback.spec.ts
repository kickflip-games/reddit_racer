import { test, expect } from '@playwright/test';
import type { CarVisualFrame } from '../../src/client/car-visual';
import { waitForSceneAssets } from './scene-ready';

test('RECOVERY VISUAL FIXTURE flashes only the owned car and uses a steady reduced-motion halo', async ({
  page,
}, info) => {
  await page.route('**/recovery-visual-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Recovery visual fixture</title><body style="background:#f5eddb;font:16px sans-serif"><h1>Recovery visual fixture</h1><p>Actual car asset, synthetic presentation frames. No racing state is injected.</p><main style="display:flex;flex-wrap:wrap"></main>',
    })
  );
  await page.goto('/recovery-visual-fixture.html');
  const result = await page.evaluate(async () => {
    const threeUrl = '/@id/three',
      carUrl = '/car-visual.ts',
      assetsUrl = '/scene-assets.ts',
      ghostUrl = '/ghost-visual.ts';
    const THREE: typeof import('three') = await import(threeUrl);
    const { createCarVisual }: typeof import('../../src/client/car-visual') =
      await import(carUrl);
    const {
      loadCarAsset,
      disposeSceneAssets,
    }: typeof import('../../src/client/scene-assets') = await import(assetsUrl);
    const {
      createGhostVisual,
    }: typeof import('../../src/client/ghost-visual') = await import(ghostUrl);
    const template = await loadCarAsset();
    if (!template) throw new Error('Missing real car');
    const car = createCarVisual(),
      ghost = createGhostVisual();
    if (!car.installModel(template) || !ghost.installModel(template))
      throw new Error('Car rig failed');
    const rig = car.object.getObjectByName('car-model'),
      halo = car.object.getObjectByName('car-recovery-halo');
    if (!rig || !halo) throw new Error('Missing recovery visuals');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#77a55b');
    scene.add(car.object, new THREE.HemisphereLight('#ffffff', '#536e42', 2.6));
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(300, 260);
    const camera = new THREE.OrthographicCamera(
      -3.4,
      3.4,
      2.95,
      -2.95,
      0.1,
      30
    );
    camera.position.set(5, 6, 7);
    camera.lookAt(0, 0.4, 0);
    const base: CarVisualFrame = {
      x: 0,
      z: 0,
      heading: 0,
      distance: 0,
      speed: 0,
      acceleration: 0,
      lateralAcceleration: 0,
      curvature: 0,
      slip: 0,
      held: true,
      racing: true,
      reducedMotion: false,
      deltaSeconds: 0,
    };
    const recovery = (tick: number, count = 1) => ({
      attemptId: 1,
      phase: 'racing' as const,
      state: {
        tick,
        recovering: true,
        recoveryCount: count,
        recoveryTicksRemaining: 119,
      },
    });
    const materials: string[] = [];
    rig.traverse((node) => {
      if (node instanceof THREE.Mesh)
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          materials.push(
            `${material.uuid}:${material.opacity}:${material.transparent}`
          );
    });
    function snapshot(label: string) {
      renderer.render(scene, camera);
      const figure = document.createElement('figure'),
        image = document.createElement('img'),
        caption = document.createElement('figcaption');
      image.src = renderer.domElement.toDataURL();
      caption.textContent = label;
      figure.append(image, caption);
      document.querySelector('main')?.append(figure);
    }
    car.update({ ...base, recovery: recovery(100) });
    snapshot('Recovery begins: visible car and steady halo');
    const first = rig.visible;
    car.update({ ...base, recovery: recovery(140) });
    snapshot('Recovery off phase: halo preserves location');
    const hidden = !rig.visible;
    for (let count = 2; count <= 5; count++) {
      car.update({ ...base, recovery: recovery(count * 200, count) });
      if (!rig.visible) throw new Error('New recovery did not start visibly');
      car.update({ ...base, recovery: recovery(count * 200 + 40, count) });
      if (rig.visible) throw new Error('Repeated recovery did not flash');
      car.update(base);
      if (!rig.visible || halo.visible)
        throw new Error('Recovery completion did not restore');
    }
    for (const tick of [1200, 1240, 1280, 1320]) {
      car.update({ ...base, recovery: recovery(tick, 6), reducedMotion: true });
      if (!rig.visible || !halo.visible)
        throw new Error('Reduced motion was not static');
    }
    snapshot('Reduced motion: steady car and halo');
    car.reset();
    snapshot('Interrupted/reset: normal car restored');
    const restored = rig.visible && !halo.visible;
    const after: string[] = [];
    rig.traverse((node) => {
      if (node instanceof THREE.Mesh)
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          after.push(
            `${material.uuid}:${material.opacity}:${material.transparent}`
          );
    });
    ghost.update(
      {
        ticks: 120,
        points: [
          [0, 0, 0, 0],
          [120, 5, 0, 0],
        ],
      },
      60,
      true
    );
    const ghostVisible = ghost.object.visible;
    car.update({ ...base, recovery: recovery(1400, 7) });
    car.update({ ...base, recovery: recovery(1440, 7) });
    const ghostUnaffected =
      ghost.object.visible === ghostVisible &&
      !ghost.object.getObjectByName('car-recovery-halo');
    car.dispose();
    ghost.dispose();
    renderer.dispose();
    disposeSceneAssets();
    return {
      first,
      hidden,
      restored,
      materialsUnchanged: JSON.stringify(materials) === JSON.stringify(after),
      ghostVisible,
      ghostUnaffected,
    };
  });
  expect(result).toEqual({
    first: true,
    hidden: true,
    restored: true,
    materialsUnchanged: true,
    ghostVisible: true,
    ghostUnaffected: true,
  });
  await page.screenshot({
    path: info.outputPath('recovery-visuals.png'),
    fullPage: true,
  });
});

test('RECOVERY actual player resets flash once per lifecycle and sound once, with normal restart and interruption restored', async ({
  page,
}, info) => {
  await page.route('**/game-scene.ts', async (route) => {
    const response = await route.fetch(),
      source = await response.text();
    const body = source.replace(
      'renderer.render(scene, camera);',
      `raceRoot.dataset.testRecovery = JSON.stringify({phase:driver.raceState.phase,tick:driver.state.tick,count:driver.state.recoveryCount,recovering:driver.state.recovering,visible:carVisual.object.getObjectByName('car-model')?.visible,halo:carVisual.object.getObjectByName('car-recovery-halo')?.visible});renderer.render(scene, camera);`
    );
    if (body === source) throw new Error('Missing render observation point');
    await route.fulfill({ response, body });
  });
  await page.route('**/driving-audio.ts', async (route) => {
    const response = await route.fetch(),
      source = await response.text();
    const body = source.replace(
      /backend\?\.cue\((["'])recovery\1\);/,
      `document.documentElement.dataset.testRecoveryCues=String(Number(document.documentElement.dataset.testRecoveryCues??0)+1);backend?.cue('recovery');`
    );
    if (body === source) throw new Error('Missing sound observation point');
    await route.fulfill({ response, body });
  });
  await page.clock.install({ time: new Date('2026-11-23T12:00:00Z') });
  await page.goto('/game.html?practice=1&word=banana');
  await waitForSceneAssets(page);
  await page.clock.pauseAt(new Date('2026-11-23T12:01:00Z'));
  const pose = async () =>
    JSON.parse(
      (await page.locator('#race').getAttribute('data-test-recovery')) ?? '{}'
    );
  await page.locator('#start-button').click();
  await page.clock.runFor(50); // Observe the next real rendered frame.
  expect((await pose()).visible).toBe(true);
  expect(
    Number(await page.locator('html').getAttribute('data-test-recovery-cues'))
  ).toBe(0);
  await page.keyboard.down('Space');
  let seenHidden = false,
    seenRestored = false,
    count = 0;
  for (let ms = 0; ms < 65000; ms += 100) {
    await page.clock.runFor(100);
    const p = await pose();
    count = p.count;
    if (p.recovering && !p.visible) seenHidden = true;
    if (!p.recovering && seenHidden && p.visible && !p.halo)
      seenRestored = true;
    if (count >= 2 && p.recovering && !p.visible) {
      await page.screenshot({
        path: info.outputPath('actual-reset-off-phase.png'),
      });
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.clock.runFor(20);
      const interrupted = await pose();
      expect(interrupted.visible).toBe(true);
      expect(interrupted.halo).toBe(false);
      break;
    }
  }
  await page.keyboard.up('Space');
  expect(count).toBeGreaterThanOrEqual(2);
  expect(seenHidden && seenRestored).toBe(true);
  expect(
    Number(await page.locator('html').getAttribute('data-test-recovery-cues'))
  ).toBe(count);
  await info.attach('actual-reset-observations', {
    body: JSON.stringify({ count, seenHidden, seenRestored }),
    contentType: 'application/json',
  });
});
