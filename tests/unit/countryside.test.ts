import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  generateSceneryLayout,
  SCENERY_LIMITS,
  groundHeightAt,
  type SceneryLayout,
} from '../../src/client/scenery-layout.ts';
import { createVegetation } from '../../src/client/vegetation.ts';
import { createEnvironment } from '../../src/client/environment.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { generateCircuit } from '../../src/shared/circuit-generator.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { createStuntCourse } from '../../src/shared/stunt-course.ts';
import { serializeTrack, type Track } from '../../src/shared/track.ts';
import {
  createSimulationState,
  stepSimulation,
} from '../../src/shared/simulation.ts';
import { handlingForTrack } from '../../src/shared/scored-runtime.ts';

function independentClearance(track: Track, x: number, z: number) {
  let edge = Infinity;
  for (let i = 0; i < track.samples.length; i++) {
    const a = track.samples[i],
      b = track.samples[(i + 1) % track.samples.length];
    assert.ok(a && b);
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))
    );
    edge = Math.min(
      edge,
      Math.hypot(x - a.x - dx * t, z - a.z - dz * t) -
        Math.max(a.width, b.width) / 2
    );
  }
  return edge;
}
void test('scenery reconstructs exactly, separates its own seed and leaves canonical tracks and scored movement unchanged', () => {
  const track = generateCircuit('spring-reproducible').track;
  const before = serializeTrack(track),
    state = createSimulationState(track),
    next = stepSimulation(track, state, true);
  const a = generateSceneryLayout(track, { seed: 'orchard' });
  assert.deepEqual(generateSceneryLayout(track, { seed: 'orchard' }), a);
  const b = generateSceneryLayout(track, { seed: 'meadow' });
  assert.notDeepEqual(a.regions, b.regions);
  assert.notDeepEqual(a.plants, b.plants);
  assert.equal(serializeTrack(track), before);
  assert.deepEqual(stepSimulation(track, state, true), next);
  assert.ok(a.plants.length > 500);
  assert.ok(new Set(a.regions.map((r) => r.kind)).size >= 4);
});
void test('twelve track seeds have distinct composed regions and bounded placement work, including maximum density and invalid controls', () => {
  const identities = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const track = generateCircuit(`spring-gallery-${i}`).track;
    const layout = generateSceneryLayout(track, {
      regions: i === 0 ? 999 : 1,
      trees: i === 0 ? 999 : 1,
      groundCover: i === 0 ? 999 : 1,
    });
    identities.add(JSON.stringify(layout.regions));
    assert.ok(layout.regions.length <= SCENERY_LIMITS.regions);
    assert.ok(layout.work.candidates <= SCENERY_LIMITS.candidates);
    assert.ok(layout.plants.length <= SCENERY_LIMITS.plants);
    assert.ok(layout.props.length <= SCENERY_LIMITS.props);
    assert.ok(
      layout.plants.filter((p) => p.kind === 'tree' || p.kind === 'blossom')
        .length <= SCENERY_LIMITS.trees
    );
    assert.ok(
      layout.work.segmentChecks <=
        (SCENERY_LIMITS.candidates + 30) * track.samples.length
    );
  }
  assert.equal(identities.size, 12);
  const track = createOvalTrack();
  assert.deepEqual(
    generateSceneryLayout(track, {
      regions: NaN,
      trees: Infinity,
      groundCover: NaN,
    }),
    generateSceneryLayout(track)
  );
  assert.equal(
    generateSceneryLayout(track, { regions: 0, groundCover: 0, trees: 0 })
      .plants.length,
    0
  );
});
void test('all plant silhouettes stay off the road, solid scenery preserves recovery, and every root matches the rendered ground', () => {
  const elevated = generateElevatedCircuit('flow-probe-21').track;
  const stunt = createStuntCourse();
  for (const [track, jumps] of [
    [createOvalTrack(), []],
    [elevated, []],
    [stunt.track, stunt.jumps],
  ] satisfies [Track, typeof stunt.jumps][]) {
    const layout = generateSceneryLayout(track, { jumps });
    for (const p of layout.plants) {
      assert.ok(
        Number.isFinite(p.x + p.y + p.z + p.heading + p.scale + p.phase)
      );
      assert.ok(p.scale > 0 && p.scale < 2 && p.radius > 0);
      assert.equal(p.y, groundHeightAt(layout.surface, p.x, p.z));
      assert.ok(
        p.x - p.radius >= layout.surface.minX &&
          p.x + p.radius <= layout.surface.minX + layout.surface.width
      );
      assert.ok(
        p.z - p.radius >= layout.surface.minZ &&
          p.z + p.radius <= layout.surface.minZ + layout.surface.depth
      );
      const low = p.kind === 'flower' || p.kind === 'grass';
      assert.ok(
        independentClearance(track, p.x, p.z) >=
          p.radius +
            (low
              ? 1.15
              : handlingForTrack(track).recoveryDistanceBeyondEdge + 2.65) -
            1e-8
      );
    }
    const environment = createEnvironment(track, layout.props, layout);
    const mesh = environment.getObjectByName('diorama-terrain');
    assert.ok(mesh instanceof THREE.Mesh);
    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 17)
      assert.ok(
        Math.abs(
          groundHeightAt(layout.surface, positions.getX(i), positions.getZ(i)) -
            positions.getY(i)
        ) < 0.0001
      );
    environment.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        n.geometry.dispose();
        for (const m of Array.isArray(n.material) ? n.material : [n.material])
          m.dispose();
      }
    });
  }
});
void test('light detail thins the same planting without moving the groves or terrain', () => {
  const track = generateCircuit('spring-light').track;
  const full = generateSceneryLayout(track),
    light = generateSceneryLayout(track, { quality: 'light' });
  assert.deepEqual(full.regions, light.regions);
  assert.deepEqual(full.surface, light.surface);
  assert.ok(light.plants.length < full.plants.length * 0.65);
  const identities = new Set(full.plants.map((p) => JSON.stringify(p)));
  for (const p of light.plants) assert.ok(identities.has(JSON.stringify(p)));
});
void test('wind shares uniforms without changing instance transforms, stops for reduced motion/idle, and regeneration disposes owned resources once', () => {
  const layout: SceneryLayout = generateSceneryLayout(createOvalTrack());
  for (let generation = 0; generation < 4; generation++) {
    const vegetation = createVegetation(layout);
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    const batches: THREE.InstancedMesh[] = [];
    vegetation.object.traverse((n) => {
      if (n instanceof THREE.InstancedMesh) {
        resources.add(n.geometry);
        for (const m of Array.isArray(n.material) ? n.material : [n.material])
          resources.add(m);
        if (
          n.name.startsWith('vegetation-') &&
          !n.name.startsWith('vegetation-shadow')
        )
          batches.push(n);
      }
    });
    assert.ok(batches.length > 0 && batches.length < 180);
    const first = batches[0];
    assert.ok(first);
    const matrix = first.instanceMatrix.array.slice();
    const material = first.material;
    assert.ok(material instanceof THREE.ShaderMaterial);
    assert.equal(vegetation.update(1, new THREE.Vector3(), false, true), true);
    assert.equal(material.uniforms.uMotion?.value, 1);
    assert.equal(material.uniforms.uTime?.value, 1);
    assert.deepEqual(first.instanceMatrix.array, matrix);
    vegetation.update(2, new THREE.Vector3(), true, true);
    assert.equal(material.uniforms.uMotion?.value, 0);
    assert.equal(vegetation.update(3, new THREE.Vector3(), true, false), false);
    const disposed = new Map<unknown, number>();
    for (const r of resources)
      r.addEventListener('dispose', () =>
        disposed.set(r, (disposed.get(r) ?? 0) + 1)
      );
    vegetation.dispose();
    vegetation.dispose();
    for (const r of resources) assert.equal(disposed.get(r), 1);
    assert.equal(vegetation.object.children.length, 0);
  }
});
