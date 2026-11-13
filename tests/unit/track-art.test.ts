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

void test('stunt road has elevated ramps and no triangles spanning the gap', async () => {
  const { createStuntCourse, jumpRoadHeight } =
    await import('../../src/shared/stunt-course.ts');
  const { track, jumps } = createStuntCourse();
  const group = createTrackRenderer(track, jumps);
  const road = group.children[1];
  assert.ok(road instanceof THREE.Mesh);
  const positions = road.geometry.getAttribute('position');
  const indices = road.geometry.getIndex();
  assert.ok(indices);
  let rampVertices = 0;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      z = positions.getZ(i);
    if (x >= 32 && x <= 64 && Math.abs(z) < 4) {
      assert.ok(
        Math.abs(positions.getY(i) - jumpRoadHeight(jumps, x) - 0.03) < 0.0001
      );
      if (positions.getY(i) > 1) rampVertices++;
    }
  }
  assert.ok(rampVertices > 10);
  for (let i = 0; i < indices.count; i += 3) {
    const vertices = [0, 1, 2].map((offset) => indices.getX(i + offset));
    if (vertices.every((vertex) => Math.abs(positions.getZ(vertex)) < 4)) {
      const midpoint =
        vertices.reduce((sum, vertex) => sum + positions.getX(vertex), 0) / 3;
      assert.ok(midpoint <= 42 || midpoint >= 52);
    }
  }
});

void test('dynamic-grip camber, wet asphalt and braking markers agree with the profile', async () => {
  const { createStuntCourse } =
    await import('../../src/shared/stunt-course.ts');
  const { gripSurfaceAt } = await import('../../src/shared/slot-grip.ts');
  const { buildRoadStripVertices } =
    await import('../../src/client/track-renderer.ts');
  const { track, jumps, gripZones } = createStuntCourse();
  const strip = buildRoadStripVertices(
    track,
    { side: -1, offset: 0 },
    { side: 1, offset: 0 },
    0.03,
    jumps,
    gripZones
  );
  const index = track.samples.findIndex((sample) => sample.s > 162);
  const sample = track.samples[index];
  assert.ok(sample);
  const bank = gripSurfaceAt(track, gripZones, sample.s).bank;
  assert.ok(bank < 0);
  assert.ok(
    Math.abs(
      (strip.positions[index * 6 + 4] ?? 0) -
        (strip.positions[index * 6 + 1] ?? 0) +
        sample.width * Math.tan(bank)
    ) < 1e-8
  );
  const group = createTrackRenderer(track, jumps, {
    dynamicGrip: true,
    zones: gripZones,
  });
  assert.ok(group.getObjectByName('grip-braking-markers'));
  const road = group.children[1];
  assert.ok(road instanceof THREE.Mesh);
  const colors = road.geometry.getAttribute('color');
  assert.ok(colors);
  const wetIndex = track.samples.findIndex((sample) => sample.s > 460);
  // Renderer inserts four jump boundaries before this point.
  let blue = 0;
  for (let i = wetIndex * 2; i < wetIndex * 2 + 20; i++)
    if (colors.getZ(i) > colors.getX(i)) blue++;
  assert.ok(blue > 10);
});
