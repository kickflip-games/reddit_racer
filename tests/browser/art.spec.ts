import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { CarVisual, CarVisualFrame } from '../../src/client/car-visual.ts';
import { DEFAULT_REQUEST_TIMEOUT_MS } from '../../src/client/request-deadline.ts';

const carHash =
  'e1408c4c6e135f5a39c5f34cbfbcac9ae21c5c491e793fdee74bccac8334d942';
const paletteHash =
  'f3622a03a20c6696065cae9cbe391351be873508af190c2ebd1d420c055787a5';

function binaryCar(url: URL): boolean {
  return (
    url.pathname.endsWith('/race.glb') &&
    !url.searchParams.has('import') &&
    !url.searchParams.has('url')
  );
}

async function pausedGame(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-11-12T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-12T00:00:01Z'));
  await page.goto('/game.html');
  await expect(page.locator('#race')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('#start-button')).toBeEnabled();
}

test('ASSET FIXTURE loads the selected car and palette with grounded wheels and stable visual resources', async ({
  page,
}) => {
  const bodies: Array<Promise<{ path: string; hash: string }>> = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      response.status() === 200 &&
      !url.searchParams.has('import') &&
      !url.searchParams.has('url') &&
      (url.pathname.endsWith('/race.glb') ||
        url.pathname.endsWith('/colormap.png'))
    )
      bodies.push(
        response.body().then((body) => ({
          path: url.pathname,
          hash: createHash('sha256').update(body).digest('hex'),
        }))
      );
  });
  await page.route('**/asset-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><title>ASSET FIXTURE</title><body style="margin:0;background:#f5eddb;color:#183529;font:14px sans-serif"><h1 style="font-size:14px;margin:12px">ASSET FIXTURE · selected Kenney car</h1><p style="margin:12px">Static presentation; no race or score.</p></body>',
    })
  );
  await page.goto('/asset-fixture.html');
  const metrics = await page.evaluate(async () => {
    const threeModuleUrl = '/@id/three';
    const THREE: typeof import('three') = await import(threeModuleUrl);
    const assetModuleUrl = '/scene-assets.ts';
    const carModuleUrl = '/car-visual.ts';
    const { loadCarAsset, disposeSceneAssets } = await import(assetModuleUrl);
    const { createCarVisual, CAR_VISUAL_LENGTH, CAR_VISUAL_GROUND_Y } =
      await import(carModuleUrl);
    const template = await loadCarAsset();
    if (!(template instanceof THREE.Group))
      throw new Error('The selected real car did not load');
    const visual: CarVisual = createCarVisual();
    if (!visual.installModel(template))
      throw new Error('The real car hierarchy was not accepted');
    const scene = new THREE.Scene();
    scene.add(visual.object, new THREE.HemisphereLight(0xffffff, 0x536e42, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(4, 7, 5);
    scene.add(light);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(360, 280);
    renderer.setClearColor(0xf5eddb);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.append(renderer.domElement);
    const camera = new THREE.OrthographicCamera(-3, 3, 2.33, -2.33, 0.1, 40);
    camera.position.set(5, 4, 6);
    camera.lookAt(0, 0.55, 0);
    const frame: CarVisualFrame = {
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
      racing: false,
      reducedMotion: false,
      deltaSeconds: 1 / 60,
    };
    visual.update(frame);
    visual.object.updateMatrixWorld(true);
    const model = visual.object.getObjectByName('car-model');
    const body = visual.object.getObjectByName('car-body-wrapper');
    const lamps = visual.object.getObjectByName('rear-brake-lamps');
    if (!model || !body || !lamps) throw new Error('Missing public car rig');
    const modelBounds = new THREE.Box3();
    const paletteSizes: number[][] = [];
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.parent?.name !== 'rear-brake-lamps')
        modelBounds.union(new THREE.Box3().setFromObject(node));
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        if (material instanceof THREE.MeshToonMaterial && material.map) {
          const image: unknown = material.map.image;
          if (
            !(image instanceof ImageBitmap) &&
            !(image instanceof HTMLImageElement)
          )
            throw new Error('The real car palette image is unavailable');
          paletteSizes.push([image.width, image.height]);
        }
      }
    });
    const wheelNames = [
      'wheel-front-left',
      'wheel-front-right',
      'wheel-back-left',
      'wheel-back-right',
    ];
    const wheels = wheelNames.map((name) => {
      const node = visual.object.getObjectByName(name);
      if (!node) throw new Error(`Missing wheel ${name}`);
      return node;
    });
    const wheelPositions = wheels.map((node) =>
      node.getWorldPosition(new THREE.Vector3()).toArray()
    );
    const wheelQuaternions = wheels.map((node) => node.quaternion.clone());
    const left = new THREE.Vector3(),
      right = new THREE.Vector3();
    visual.getRearContacts(left, right);
    const contacts = [left.toArray(), right.toArray()];
    function resources(): string[] {
      const ids = new Set<string>();
      visual.object.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        ids.add(`geometry:${node.geometry.id}`);
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material]) {
          ids.add(`material:${material.id}`);
          if (material instanceof THREE.MeshToonMaterial && material.map)
            ids.add(`texture:${material.map.id}`);
        }
      });
      return [...ids].sort();
    }
    renderer.render(scene, camera);
    const initialResources = resources();
    const initialMemory = { ...renderer.info.memory };
    visual.update({
      ...frame,
      distance: 1,
      speed: 14,
      acceleration: -9,
      lateralAcceleration: 18,
      held: false,
      racing: true,
    });
    visual.object.updateMatrixWorld(true);
    const wheelSpin = wheels.map((node, index) => {
      const initial = wheelQuaternions[index];
      if (!initial) throw new Error('Missing initial wheel rotation');
      return node.quaternion.angleTo(initial);
    });
    visual.getRearContacts(left, right);
    const spunContacts = [left.toArray(), right.toArray()];
    const lampPositions = lamps.children.map((node) =>
      node.getWorldPosition(new THREE.Vector3()).toArray()
    );
    const brakeColors = lamps.children.map((node) =>
      node instanceof THREE.Mesh &&
      node.material instanceof THREE.MeshBasicMaterial
        ? node.material.color.getHexString()
        : ''
    );
    const leanedBody = [body.rotation.x, body.rotation.z];
    const leanedBodyMinimumY = new THREE.Box3().setFromObject(body).min.y;
    renderer.render(scene, camera);
    for (let cycle = 0; cycle < 20; cycle++) {
      visual.reset();
      visual.update({ ...frame, distance: cycle + 2, speed: 12, racing: true });
      visual.reset();
      if ((await loadCarAsset()) !== template)
        throw new Error('A reset replaced the cached car template');
    }
    renderer.render(scene, camera);
    const resetWheelAngles = wheels.map((node, index) => {
      const initial = wheelQuaternions[index];
      if (!initial) throw new Error('Missing reset wheel rotation');
      return node.quaternion.angleTo(initial);
    });
    const result = {
      kind: visual.kind,
      targetLength: CAR_VISUAL_LENGTH,
      groundY: CAR_VISUAL_GROUND_Y,
      size: modelBounds.getSize(new THREE.Vector3()).toArray(),
      minimumY: modelBounds.min.y,
      wheelPositions,
      wheelSpin,
      contacts,
      spunContacts,
      lampPositions,
      brakeColors,
      leanedBody,
      leanedBodyMinimumY,
      resetWheelAngles,
      paletteSizes,
      resourcesStable:
        JSON.stringify(initialResources) === JSON.stringify(resources()),
      initialMemory,
      finalMemory: { ...renderer.info.memory },
      drawCalls: renderer.info.render.calls,
    };
    visual.dispose();
    disposeSceneAssets();
    renderer.dispose();
    return result;
  });
  expect(metrics.kind).toBe('kenney');
  expect(metrics.targetLength).toBe(3.8);
  expect(metrics.size[2]).toBeCloseTo(3.8, 5);
  expect(metrics.minimumY).toBeCloseTo(metrics.groundY, 5);
  expect(metrics.paletteSizes.length).toBeGreaterThan(0);
  expect(
    metrics.paletteSizes.every((size) => size[0] === 512 && size[1] === 512)
  ).toBe(true);
  expect(
    metrics.wheelPositions
      .slice(0, 2)
      .every((point) => point[2] !== undefined && point[2] > 0)
  ).toBe(true);
  expect(
    metrics.wheelPositions
      .slice(2)
      .every((point) => point[2] !== undefined && point[2] < 0)
  ).toBe(true);
  expect(metrics.wheelSpin.every((angle) => angle > 0.1)).toBe(true);
  expect(metrics.resetWheelAngles.every((angle) => angle < 1e-6)).toBe(true);
  expect(metrics.contacts).toEqual(metrics.spunContacts);
  for (const contact of metrics.contacts)
    expect(contact[1]).toBeCloseTo(metrics.groundY, 5);
  expect(
    metrics.contacts.every(
      (point) =>
        point[2] !== undefined &&
        point[1] !== undefined &&
        point[2] < 0 &&
        point[1] < 0.1
    )
  ).toBe(true);
  expect(metrics.lampPositions).toHaveLength(2);
  expect(
    metrics.lampPositions.every(
      (point) => point[2] !== undefined && point[2] < -1.8
    )
  ).toBe(true);
  expect(metrics.brakeColors).toEqual(['ff3026', 'ff3026']);
  expect(metrics.leanedBody.some((angle) => Math.abs(angle) > 0.001)).toBe(
    true
  );
  expect(metrics.resourcesStable).toBe(true);
  expect(metrics.leanedBodyMinimumY).toBeGreaterThanOrEqual(0.03);
  expect(metrics.finalMemory).toEqual(metrics.initialMemory);
  expect(metrics.initialMemory.textures).toBeGreaterThanOrEqual(1);
  expect(metrics.drawCalls).toBeGreaterThanOrEqual(7);
  expect(metrics.drawCalls).toBeLessThanOrEqual(12);
  await page.screenshot({
    path: `test-results/asset-fixture-${test.info().project.name}.png`,
  });
  const loaded = await Promise.all(bodies);
  expect(loaded.filter((entry) => entry.path.endsWith('/race.glb'))).toEqual([
    { path: expect.any(String), hash: carHash },
  ]);
  expect(
    loaded.filter((entry) => entry.path.endsWith('/colormap.png'))
  ).toEqual([{ path: expect.any(String), hash: paletteHash }]);
});

test('twenty real start/abandon cycles retain loaded car and scenery without repeated asset requests', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      /\.(?:glb|png)$/.test(url.pathname) &&
      !url.searchParams.has('import') &&
      !url.searchParams.has('url')
    )
      requests.push(request.url());
  });
  await pausedGame(page);
  await expect(page.locator('#race')).toHaveAttribute('data-car-load', 'ready');
  await expect(page.locator('#race')).toHaveAttribute('data-car-art', 'kenney');
  await expect(page.locator('#race')).toHaveAttribute(
    'data-scenery-art',
    'kenney'
  );
  const loaded = [...requests];
  expect(
    loaded.some((url) => new URL(url).pathname.endsWith('/race.glb'))
  ).toBe(true);
  const phases = await page.evaluate(() => {
    const phases: string[] = [];
    for (let cycle = 0; cycle < 20; cycle++) {
      const button = document.getElementById(
        cycle ? 'retry-button' : 'start-button'
      );
      if (!(button instanceof HTMLButtonElement))
        throw new Error('Missing real attempt action');
      button.click();
      phases.push(document.getElementById('race')?.dataset.phase ?? 'missing');
      window.dispatchEvent(new Event('blur'));
      phases.push(document.getElementById('race')?.dataset.phase ?? 'missing');
    }
    return phases;
  });
  expect(phases).toEqual(
    Array.from({ length: 20 }, () => ['countdown', 'abandoned']).flat()
  );
  await expect(page.locator('#retry-button')).toBeVisible();
  await expect(page.locator('#status')).toHaveAttribute('data-held', 'false');
  await expect(page.locator('#race')).toHaveAttribute('data-car-art', 'kenney');
  expect(requests).toEqual(loaded);
});

for (const failure of ['network', 'palette', 'deadline']) {
  test(`a ${failure} car load keeps a usable fallback and accepts real input`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let requested = 0;
    await page.route(
      (url) =>
        failure === 'palette'
          ? url.pathname.endsWith('/colormap.png') &&
            !url.searchParams.has('import') &&
            !url.searchParams.has('url')
          : binaryCar(url),
      async (route) => {
        requested++;
        if (failure !== 'deadline') await route.abort();
        // A deliberately unanswered binary request exercises the real deadline.
      }
    );
    await pausedGame(page);
    if (failure === 'deadline') {
      await expect(page.locator('#race')).toHaveAttribute(
        'data-car-load',
        'loading'
      );
      await expect.poll(() => requested).toBe(1);
      await page.clock.fastForward(DEFAULT_REQUEST_TIMEOUT_MS + 10);
    }
    await expect(page.locator('#race')).toHaveAttribute(
      'data-car-load',
      'unavailable'
    );
    await expect(page.locator('#race')).toHaveAttribute(
      'data-car-art',
      'fallback'
    );
    await page.locator('#start-button').click();
    await page.keyboard.down('Space');
    await page.clock.runFor(3200);
    await expect(page.locator('#race')).toHaveAttribute('data-phase', 'racing');
    expect(Number(await page.locator('#speed').textContent())).toBeGreaterThan(
      0
    );
    await page.screenshot({
      path: `test-results/asset-fallback-${failure}-${test.info().project.name}.png`,
    });
    await page.keyboard.up('Space');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(page.locator('#retry-button')).toBeVisible();
    expect(requested).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('a late car download cannot swap the car during a lap or after interruption and retry', async ({
  page,
}) => {
  let releaseAsset: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    releaseAsset = resolve;
  });
  await page.route(binaryCar, async (route) => {
    await ready;
    await route.continue();
  });
  await page.goto('/game.html?practice=1&seed=practice-1');
  await expect(page.locator('#start-button')).toBeEnabled();
  await page.locator('#start-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-car-art',
    'fallback'
  );
  releaseAsset();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-car-load',
    'deferred'
  );
  await expect(page.locator('#race')).toHaveAttribute(
    'data-car-art',
    'fallback'
  );
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#retry-button')).toBeVisible();
  await page.locator('#retry-button').click();
  await expect(page.locator('#race')).toHaveAttribute(
    'data-car-art',
    'fallback'
  );
});
