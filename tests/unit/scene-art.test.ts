import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createCarVisual,
  CAR_VISUAL_GROUND_Y,
  CAR_VISUAL_LENGTH,
  type CarVisualFrame,
} from '../../src/client/car-visual.ts';
import {
  createSceneAssetCache,
  disposeAssetTemplate,
} from '../../src/client/scene-assets.ts';
import {
  buildSceneryPlacements,
  createScenery,
  hasSceneryClearance,
  MAX_SCENERY_INSTANCES,
} from '../../src/client/scenery.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { generateCircuit } from '../../src/shared/circuit-generator.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function template(): THREE.Group {
  const group = new THREE.Group();
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 120, 32, 255]),
    1,
    1
  );
  group.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 2),
      new THREE.MeshStandardMaterial({ map: texture })
    )
  );
  return group;
}
function resources(group: THREE.Group): {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
} {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      if (material instanceof THREE.MeshStandardMaterial && material.map)
        textures.add(material.map);
    }
  });
  return { geometries, materials, textures };
}
const frame: CarVisualFrame = {
  x: 0,
  z: 0,
  heading: 0,
  distance: 0,
  speed: 22,
  acceleration: 8,
  lateralAcceleration: 18,
  curvature: 0.04,
  slip: 0.5,
  held: true,
  racing: true,
  reducedMotion: false,
  deltaSeconds: 1 / 60,
};

// Decode actual authored geometry/hierarchy. Palette pixels are a fixture here;
// real image decoding and local palette URLs are covered by the browser loader.
class FixtureTextureLoader extends THREE.Loader<THREE.Texture> {
  override load(
    _url: string,
    onLoad?: (texture: THREE.Texture) => void
  ): THREE.Texture {
    const texture = new THREE.DataTexture(
      new Uint8Array([255, 120, 32, 255]),
      1,
      1
    );
    queueMicrotask(() => onLoad?.(texture));
    return texture;
  }
}
async function actualCar(): Promise<THREE.Group> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: globalThis,
  });
  try {
    const manager = new THREE.LoadingManager();
    manager.addHandler(/colormap\.png$/, new FixtureTextureLoader(manager));
    const bytes = await readFile(
      new URL(
        '../../src/client/assets/kenney/car-kit/race.glb',
        import.meta.url
      )
    );
    return (
      await new GLTFLoader(manager).parseAsync(
        Uint8Array.from(bytes).buffer,
        ''
      )
    ).scene;
  } finally {
    if (previous) Object.defineProperty(globalThis, 'self', previous);
    else Reflect.deleteProperty(globalThis, 'self');
  }
}

void test('selected original payloads match their provenance hashes and byte budget', async () => {
  const source: unknown = JSON.parse(
    await readFile(
      new URL('../../src/client/assets/kenney/manifest.json', import.meta.url),
      'utf8'
    )
  );
  assert.ok(record(source));
  assert.ok(Array.isArray(source.assets));
  assert.equal(source.assets.length, 7);
  let bytes = 0;
  for (const asset of source.assets) {
    assert.ok(record(asset));
    assert.equal(typeof asset.destination, 'string');
    assert.ok(typeof asset.destination === 'string');
    const payload = await readFile(
      new URL(`../../${asset.destination}`, import.meta.url)
    );
    assert.equal(payload.length, asset.bytes);
    assert.equal(
      createHash('sha256').update(payload).digest('hex'),
      asset.sha256
    );
    bytes += payload.length;
  }
  assert.equal(bytes, 211_791);
});

void test('car completion is independent of stalled props and both requests are memoized', async () => {
  const imported = template();
  let calls = 0;
  const cache = createSceneAssetCache((url) => {
    calls++;
    return url.includes('/car-kit/')
      ? Promise.resolve(imported)
      : new Promise(() => {});
  }, 25);
  const props = cache.loadSceneryAssets();
  const car = cache.loadCarAsset();
  assert.equal(cache.loadCarAsset(), car);
  assert.equal(cache.loadSceneryAssets(), props);
  assert.equal(await car, imported);
  assert.equal(calls, 6);
  assert.deepEqual(await props, {});
  assert.equal(await cache.loadCarAsset(), imported);
  cache.dispose();
});

void test('timeout and teardown abort managers and dispose late imports exactly once', async () => {
  let finish: ((model: THREE.Group) => void) | undefined;
  let managerSignal: AbortSignal | undefined;
  const imported = template();
  let geometryDisposals = 0;
  let textureDisposals = 0;
  const owned = resources(imported);
  for (const geometry of owned.geometries)
    geometry.addEventListener('dispose', () => geometryDisposals++);
  for (const texture of owned.textures)
    texture.addEventListener('dispose', () => textureDisposals++);
  const cache = createSceneAssetCache((_url, loadingManager) => {
    managerSignal = loadingManager.abortController.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  }, 15);
  assert.equal(await cache.loadCarAsset(), undefined);
  assert.ok(managerSignal?.aborted);
  assert.ok(finish);
  finish(imported);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(geometryDisposals, 1);
  assert.equal(textureDisposals, 1);
  cache.dispose();
  cache.dispose();
  assert.equal(geometryDisposals, 1);
  assert.equal(await cache.loadCarAsset(), undefined);
});

void test('the actual four-wheel model stays grounded under combined lean and resets reuse borrowed resources', async () => {
  const imported = await actualCar();
  const sourceResources = resources(imported);
  let borrowedDisposals = 0;
  for (const resource of [
    ...sourceResources.geometries,
    ...sourceResources.materials,
    ...sourceResources.textures,
  ])
    resource.addEventListener('dispose', () => borrowedDisposals++);
  const car = createCarVisual();
  assert.equal(car.kind, 'fallback');
  assert.equal(car.installModel(new THREE.Group()), false);
  assert.equal(car.installModel(imported), true);
  assert.equal(car.kind, 'kenney');
  assert.equal(car.installModel(imported), true);
  car.object.updateMatrixWorld(true);
  const model = car.object.getObjectByName('car-model');
  assert.ok(model);
  const initial = new THREE.Box3().setFromObject(model);
  const visibleLength = initial.getSize(new THREE.Vector3()).z;
  assert.ok(visibleLength >= CAR_VISUAL_LENGTH && visibleLength <= 4);
  assert.ok(Math.abs(initial.min.y - CAR_VISUAL_GROUND_Y) < 1e-6);
  const wheel = car.object.getObjectByName('wheel-back-left');
  assert.ok(wheel);
  const axle = wheel.position.clone();
  const sourceWheel = imported.getObjectByName('wheel-back-left');
  assert.ok(sourceWheel);
  const sourceQuaternion = sourceWheel.quaternion.clone();
  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  car.getRearContacts(left, right);
  const groundedLeft = left.clone();
  assert.ok(left.z < 0 && right.z < 0 && left.x > right.x);
  assert.ok(Math.abs(left.y - CAR_VISUAL_GROUND_Y) < 1e-6);
  for (let retry = 0; retry < 20; retry++) {
    for (let tick = 0; tick < 20; tick++)
      car.update({
        ...frame,
        acceleration: retry % 2 ? 100 : -100,
        lateralAcceleration: 100,
        distance: tick + retry * 3,
      });
    car.object.updateMatrixWorld(true);
    const body = car.object.getObjectByName('body');
    assert.ok(body);
    assert.ok(
      new THREE.Box3().setFromObject(body).min.y >= CAR_VISUAL_GROUND_Y + 0.005
    );
    assert.deepEqual(wheel.position, axle);
    car.getRearContacts(left, right);
    assert.ok(left.distanceTo(groundedLeft) < 1e-6);
    car.reset();
  }
  car.update({
    ...frame,
    x: 5,
    z: 7,
    heading: Math.PI / 2,
    reducedMotion: true,
  });
  car.getRearContacts(left, right);
  assert.ok(left.x < 5 && right.x < 5);
  const bodyWrapper = car.object.getObjectByName('car-body-wrapper');
  assert.ok(bodyWrapper);
  assert.equal(bodyWrapper.rotation.x, 0);
  assert.equal(bodyWrapper.rotation.z, 0);
  assert.ok(sourceWheel.quaternion.equals(sourceQuaternion));
  car.dispose();
  car.dispose();
  assert.equal(borrowedDisposals, 0);
  disposeAssetTemplate(imported);
});

void test('scenery placement is deterministic, capped and clear of every closed-loop segment', () => {
  for (const track of [
    createOvalTrack(),
    generateCircuit('art-clearance-a').track,
    generateCircuit('art-clearance-b').track,
  ]) {
    const placements = buildSceneryPlacements(track);
    assert.deepEqual(buildSceneryPlacements(track), placements);
    assert.ok(
      placements.length > 0 && placements.length <= MAX_SCENERY_INSTANCES
    );
    for (const placement of placements)
      assert.ok(
        hasSceneryClearance(track, placement.x, placement.z, placement.radius)
      );
    const first = track.samples[0];
    const last = track.samples.at(-1);
    assert.ok(first && last);
    assert.equal(
      hasSceneryClearance(
        track,
        (first.x + last.x) / 2,
        (first.z + last.z) / 2,
        0.1
      ),
      false
    );
    const wider = {
      ...track,
      samples: track.samples.map((sample) => ({ ...sample, width: 200 })),
    };
    for (const placement of placements)
      assert.equal(
        hasSceneryClearance(wider, placement.x, placement.z, placement.radius),
        false
      );
  }
});

void test('scenery swaps instance buffers while borrowing imported geometry and materials', () => {
  const tree = new THREE.Group();
  tree.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 1, 0.25),
      new THREE.MeshStandardMaterial({ color: '#4f8f56' })
    )
  );
  const imported = resources(tree);
  let borrowedDisposals = 0;
  for (const resource of [
    ...imported.geometries,
    ...imported.materials,
    ...imported.textures,
  ])
    resource.addEventListener('dispose', () => borrowedDisposals++);
  const scenery = createScenery(createOvalTrack());
  assert.ok(scenery.object.getObjectByName('scenery-treeSmall'));
  const assets = { treeSmall: tree };
  assert.equal(scenery.installAssets(assets), true);
  const batch = scenery.object.children[0];
  assert.ok(batch);
  let borrowedInstances = 0;
  scenery.object.traverse((node) => {
    if (
      node instanceof THREE.InstancedMesh &&
      imported.geometries.has(node.geometry)
    )
      borrowedInstances += node.count;
  });
  assert.ok(borrowedInstances > 0);
  for (let retry = 0; retry < 20; retry++)
    assert.equal(scenery.installAssets(assets), true);
  assert.equal(scenery.object.children[0], batch);
  scenery.dispose();
  scenery.dispose();
  assert.equal(borrowedDisposals, 0);
  disposeAssetTemplate(tree);
});

void test('a failed palette keeps fallback and successful cache teardown frees each owned resource once', async () => {
  const failed = template();
  let failedDisposals = 0;
  for (const geometry of resources(failed).geometries)
    geometry.addEventListener('dispose', () => failedDisposals++);
  const broken = createSceneAssetCache(async (_url, manager) => {
    manager.itemError('Textures/colormap.png');
    return failed;
  });
  assert.equal(await broken.loadCarAsset(), undefined);
  assert.equal(failedDisposals, 1);
  broken.dispose();
  const imported = template();
  let disposals = 0;
  const owned = resources(imported);
  for (const resource of [
    ...owned.geometries,
    ...owned.materials,
    ...owned.textures,
  ])
    resource.addEventListener('dispose', () => disposals++);
  const cache = createSceneAssetCache(async (url, manager) => {
    const remapped = manager.resolveURL(
      new URL('Textures/colormap.png', url).href
    );
    assert.ok(remapped.includes('/car-kit/Textures/colormap.png'));
    assert.notEqual(
      remapped,
      manager.resolveURL(new URL('Textures/different.png', url).href)
    );
    return imported;
  });
  assert.equal(await cache.loadCarAsset(), imported);
  cache.dispose();
  cache.dispose();
  assert.equal(
    disposals,
    owned.geometries.size + owned.materials.size + owned.textures.size
  );
  assert.equal(await cache.loadCarAsset(), undefined);
  assert.deepEqual(await cache.loadSceneryAssets(), {});
});

void test('corner roll lowers the world-space outward body side on fallback and authored rigs', async () => {
  const imported = await actualCar();
  for (const useModel of [false, true]) {
    const car = createCarVisual();
    if (useModel) assert.ok(car.installModel(imported));
    const body = car.object.getObjectByName('car-body-wrapper');
    assert.ok(body);
    for (const heading of [0, Math.PI / 2]) {
      for (const sign of [-1, 1]) {
        car.reset();
        const neutral = {
          ...frame,
          heading,
          acceleration: 0,
          curvature: 0,
          lateralAcceleration: 0,
        };
        car.update(neutral);
        car.object.updateMatrixWorld(true);
        const center = body.getWorldPosition(new THREE.Vector3());
        // Track normal = (-cos heading, 0, sin heading); outward is its opposite.
        const outward = new THREE.Vector3(
          Math.cos(heading) * sign,
          0,
          -Math.sin(heading) * sign
        );
        const outerPoint = body.worldToLocal(
          center.clone().addScaledVector(outward, 0.5)
        );
        const innerPoint = body.worldToLocal(
          center.clone().addScaledVector(outward, -0.5)
        );
        const outerBefore = body.localToWorld(outerPoint.clone());
        const innerBefore = body.localToWorld(innerPoint.clone());
        assert.ok(Math.abs(outerBefore.y - innerBefore.y) < 1e-8);
        for (let tick = 0; tick < 40; tick++)
          car.update({ ...neutral, curvature: sign * 0.03 });
        car.object.updateMatrixWorld(true);
        const outerAfter = body.localToWorld(outerPoint.clone());
        const innerAfter = body.localToWorld(innerPoint.clone());
        assert.ok(
          outerAfter.y < outerBefore.y - 0.005,
          `${car.kind}, heading ${heading}, sign ${sign}: outward side lowers`
        );
        assert.ok(
          innerAfter.y > innerBefore.y + 0.005,
          `${car.kind}, heading ${heading}, sign ${sign}: inward side rises`
        );
        assert.ok(outerAfter.y < innerAfter.y);
        for (let tick = 0; tick < 80; tick++)
          car.update({
            ...neutral,
            curvature: sign * 0.03,
            lateralAcceleration: -sign * 0.03 * neutral.speed * neutral.speed,
          });
        car.object.updateMatrixWorld(true);
        assert.ok(
          Math.abs(body.localToWorld(outerPoint.clone()).y - outerBefore.y) <
            1e-6
        );
        assert.ok(
          Math.abs(body.localToWorld(innerPoint.clone()).y - innerBefore.y) <
            1e-6
        );
      }
    }
    const lamps = car.object.getObjectByName('rear-brake-lamps');
    assert.ok(lamps);
    const neutral = {
      ...frame,
      acceleration: 0,
      curvature: 0,
      lateralAcceleration: 0,
      heading: 0,
    };
    car.reset();
    car.update(neutral);
    car.object.updateMatrixWorld(true);
    const lampBounds = new THREE.Box3().setFromObject(lamps);
    assert.ok(lampBounds.min.z >= -2.00001 && lampBounds.max.z < -1.8);
    assert.ok(
      Math.abs(lampBounds.getSize(new THREE.Vector3()).z - 0.16) < 1e-6
    );
    car.dispose();
  }
  disposeAssetTemplate(imported);
});

void test('scenery theme clones preserve source maps and roughness and dispose only owned materials', () => {
  const texture = new THREE.DataTexture(
    new Uint8Array([120, 200, 160, 255]),
    1,
    1
  );
  const foliage = new THREE.MeshStandardMaterial({
    color: '#95c5af',
    roughness: 0.72,
    map: texture,
  });
  foliage.name = 'grass';
  const bark = new THREE.MeshStandardMaterial({
    color: '#ebd4ae',
    roughness: 0.91,
  });
  bark.name = 'bark';
  const tree = new THREE.Group();
  tree.add(
    new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2), foliage),
    new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.05), bark)
  );
  const originalFoliage = foliage.color.clone();
  const originalBark = bark.color.clone();
  const scenery = createScenery(createOvalTrack());
  let sourceDisposals = 0;
  foliage.addEventListener('dispose', () => sourceDisposals++);
  bark.addEventListener('dispose', () => sourceDisposals++);
  texture.addEventListener('dispose', () => sourceDisposals++);
  assert.ok(scenery.installAssets({ treeSmall: tree }));
  const themed = new Set<THREE.MeshStandardMaterial>();
  scenery.object.traverse((node) => {
    if (
      node instanceof THREE.InstancedMesh &&
      node.name === 'scenery-treeSmall'
    ) {
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        assert.ok(material instanceof THREE.MeshStandardMaterial);
        themed.add(material);
      }
    }
  });
  assert.equal(themed.size, 2);
  let themedDisposals = 0;
  for (const material of themed) {
    material.addEventListener('dispose', () => themedDisposals++);
    assert.notEqual(material, foliage);
    assert.notEqual(material, bark);
    if (material.name === 'grass') {
      assert.equal(material.color.getHexString(), '3b7650');
      assert.equal(material.map, texture);
      assert.equal(material.roughness, foliage.roughness);
    } else {
      assert.equal(material.color.getHexString(), '8a6746');
      assert.equal(material.roughness, bark.roughness);
    }
  }
  assert.ok(foliage.color.equals(originalFoliage));
  assert.ok(bark.color.equals(originalBark));
  assert.ok(scenery.installAssets({ treeSmall: tree }));
  scenery.object.traverse((node) => {
    if (
      node instanceof THREE.InstancedMesh &&
      node.name === 'scenery-treeSmall'
    ) {
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        assert.ok(themed.has(material));
    }
  });
  scenery.dispose();
  scenery.dispose();
  assert.equal(themedDisposals, 2);
  assert.equal(sourceDisposals, 0);
  disposeAssetTemplate(tree);
});

void test('all four tyres roll forward in world space on fallback and authored rigs', async () => {
  const imported = await actualCar();
  for (const useModel of [false, true]) {
    const car = createCarVisual();
    if (useModel) assert.ok(car.installModel(imported));
    for (const heading of [0, Math.PI / 2]) {
      car.reset();
      const neutral = {
        ...frame,
        heading,
        acceleration: 0,
        curvature: 0,
        lateralAcceleration: 0,
        distance: 0,
      };
      car.update(neutral);
      car.object.updateMatrixWorld(true);
      const forward = new THREE.Vector3(
        Math.sin(heading),
        0,
        Math.cos(heading)
      );
      const contacts = [
        'wheel-front-left',
        'wheel-front-right',
        'wheel-back-left',
        'wheel-back-right',
      ].map((name) => {
        const wheel = car.object.getObjectByName(name);
        assert.ok(wheel);
        const bounds = new THREE.Box3().setFromObject(wheel);
        const bottom = bounds.getCenter(new THREE.Vector3());
        bottom.y = bounds.min.y;
        return {
          name,
          wheel,
          before: bottom.clone(),
          local: wheel.worldToLocal(bottom),
        };
      });
      car.update({ ...neutral, distance: 0.04 });
      car.object.updateMatrixWorld(true);
      for (const contact of contacts) {
        const after = contact.wheel.localToWorld(contact.local.clone());
        const displacement = after.sub(contact.before).dot(forward);
        assert.ok(
          displacement < -0.02,
          `${car.kind}, heading ${heading}, ${contact.name}: tyre bottom must move backward, got ${displacement}`
        );
      }
    }
    car.dispose();
  }
  disposeAssetTemplate(imported);
});
