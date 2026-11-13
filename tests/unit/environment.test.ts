import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
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
  assert.equal(shadows.count, placements.length);
  assert.ok(shadows.count <= 64);
  for (const p of placements)
    assert.ok(hasSceneryClearance(track, p.x, p.z, p.radius));
});
