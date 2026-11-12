import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createTrackRenderer } from '../../src/client/track-renderer.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { serializeTrack } from '../../src/shared/track.ts';

function mesh(group: THREE.Group, name: string): THREE.Mesh {
  const found = group.getObjectByName(name);
  assert(found instanceof THREE.Mesh, `Missing ${name}`);
  return found;
}

void test('checker grid stays one bounded surface with upward faces and two crisp colours', () => {
  const group = createTrackRenderer(createOvalTrack());
  assert.equal(group.children.length, 7);
  const grid = mesh(group, 'starting-grid');
  const positions = grid.geometry.getAttribute('position');
  const colors = grid.geometry.getAttribute('color');
  const indices = grid.geometry.index;
  assert(positions && colors && indices);
  assert.equal(positions.count, 16 * 4);
  assert.equal(indices.count, 16 * 6);
  const palette = new Set<string>();
  for (let cell = 0; cell < 16; cell++) {
    const first = cell * 4;
    const color = [colors.getX(first), colors.getY(first), colors.getZ(first)];
    palette.add(color.join(','));
    for (let vertex = first; vertex < first + 4; vertex++) {
      assert.deepEqual(
        [colors.getX(vertex), colors.getY(vertex), colors.getZ(vertex)],
        color
      );
      assert(Math.abs(positions.getY(vertex) - 0.04) < 1e-7);
    }
  }
  assert.equal(palette.size, 2);
  assertUpward(grid);
});

function assertUpward(surface: THREE.Mesh): void {
  const positions = surface.geometry.getAttribute('position');
  const indices = surface.geometry.index;
  assert(positions && indices);
  for (let triangle = 0; triangle < indices.count; triangle += 3) {
    const a = indices.getX(triangle),
      b = indices.getX(triangle + 1),
      c = indices.getX(triangle + 2);
    const ax = positions.getX(b) - positions.getX(a);
    const az = positions.getZ(b) - positions.getZ(a);
    const bx = positions.getX(c) - positions.getX(a);
    const bz = positions.getZ(c) - positions.getZ(a);
    assert(az * bx - ax * bz > 0, 'Paint must face upwards');
  }
}

void test('both kerbs close, stay outside the unchanged road and inside its existing shoulder', () => {
  const track = createOvalTrack();
  const group = createTrackRenderer(track);
  for (const side of [-1, 1]) {
    const kerb = mesh(group, side === 1 ? 'kerb-right' : 'kerb-left');
    assertUpward(kerb);
    const positions = kerb.geometry.getAttribute('position');
    assert(positions);
    assert.equal(positions.count, track.samples.length * 4);
    for (let index = 0; index < track.samples.length; index++) {
      const sample = track.samples[index];
      assert(sample);
      for (const corner of [0, 1]) {
        const vertex = index * 4 + corner;
        const signed =
          (positions.getX(vertex) - sample.x) * -sample.tz +
          (positions.getZ(vertex) - sample.z) * sample.tx;
        const expected =
          side * (sample.width / 2 + (corner === 0 ? 0.04 : 0.64));
        assert(Math.abs(signed - expected) < 0.00002);
        assert(Math.abs(signed) > sample.width / 2);
        assert(Math.abs(signed) < sample.width / 2 + 0.8);
      }
    }
    for (let corner = 0; corner < 2; corner++) {
      assert.equal(
        positions.getX(corner),
        positions.getX(positions.count - 2 + corner)
      );
      assert.equal(
        positions.getZ(corner),
        positions.getZ(positions.count - 2 + corner)
      );
    }
  }
});

void test('road art creation cannot change the canonical track used by replay verification', () => {
  const track = createOvalTrack();
  const before = serializeTrack(track);
  createTrackRenderer(track);
  assert.equal(serializeTrack(track), before);
});
