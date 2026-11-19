import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateSceneryLayout } from '../../src/client/scenery-layout.ts';
import { createEnvironment } from '../../src/client/environment.ts';
import {
  buildSceneryPlacements,
  hasSceneryClearance,
} from '../../src/client/scenery.ts';
import { createStuntCourse } from '../../src/shared/stunt-course.ts';
void test('terrain and contact shadows use bounded buffers and preserve road/runoff clearance', () => {
  const { track } = createStuntCourse();
  const placements = buildSceneryPlacements(track);
  const group = createEnvironment(track, placements);
  const ground = group.getObjectByName('diorama-terrain');
  assert.ok(ground instanceof THREE.Mesh);
  assert.ok(ground.material instanceof THREE.ShaderMaterial);
  assert.equal(ground.material.transparent, false);
  assert.equal(ground.material.lights, false);
  assert.match(ground.material.fragmentShader, /float band/);
  assert.ok(Number.isFinite(ground.material.uniforms.uSeedPhase?.value));
  const lightLayout = generateSceneryLayout(track, { quality: 'light' });
  const lightGround = createEnvironment(
    track,
    lightLayout.props,
    lightLayout
  ).getObjectByName('diorama-terrain');
  assert.ok(lightGround instanceof THREE.Mesh);
  assert.deepEqual(
    lightGround.geometry.getAttribute('color').array,
    ground.geometry.getAttribute('color').array
  );
  assert.deepEqual(
    lightGround.geometry.getAttribute('position').array,
    ground.geometry.getAttribute('position').array
  );
  assert.equal(generateSceneryLayout(track).options.lighting, 'toon');
  const position = ground.geometry.getAttribute('position');
  assert.ok(position.count <= 65 * 65);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i),
      y = position.getY(i);
    assert.ok(Number.isFinite(x + z + y));
    if (
      track.samples.some(
        (p, j) => j % 6 === 0 && Math.hypot(x - p.x, z - p.z) < p.width / 2 + 14
      )
    )
      assert.ok(y < 0);
  }
  const shadows = group.getObjectByName('scenery-contact-shadows');
  assert.ok(shadows instanceof THREE.InstancedMesh);
  const trees = generateSceneryLayout(track).plants.filter(
    (p) => p.kind === 'tree' || p.kind === 'blossom'
  );
  assert.equal(shadows.count, placements.length + Math.min(256, trees.length));
  assert.ok(shadows.count <= 64 + 256);
  for (const p of placements)
    assert.ok(hasSceneryClearance(track, p.x, p.z, p.radius));
});
