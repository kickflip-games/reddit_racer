import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMinimapGeometry,
  sampleMinimap,
} from '../../src/client/circuit-minimap.ts';
import { generateCircuit } from '../../src/shared/circuit-generator.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import {
  createOvalTrack,
  createTrackFromPoints,
} from '../../src/shared/track-authoring.ts';
import { createStuntCourse } from '../../src/shared/stunt-course.ts';
import { serializeTrack, sampleTrack } from '../../src/shared/track.ts';
import { createSimulationDriver } from '../../src/client/simulation-driver.ts';

void test('six generated seeds, hairpins and elevated circuits retain their true aspect ratio and fixed world orientation', () => {
  const shapes = new Set<string>();
  const courses = [
    ...Array.from(
      { length: 6 },
      (_, i) => generateCircuit(`minimap-${i}`).track
    ),
    generateElevatedCircuit('flow-probe-21').track,
    createStuntCourse().track,
  ];
  for (const track of courses) {
    const before = serializeTrack(track);
    const map = createMinimapGeometry(track);
    shapes.add(map.path);
    assert.equal(map.points.length, track.samples.length + 1);
    assert.ok(map.path.startsWith('M') && map.path.endsWith('Z'));
    assert.equal(serializeTrack(track), before);
    const xs = track.samples.map((p) => p.x),
      zs = track.samples.map((p) => p.z);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minZ = Math.min(...zs),
      maxZ = Math.max(...zs);
    const scale = 136 / Math.max(maxX - minX, maxZ - minZ);
    for (let i = 0; i < track.samples.length; i++) {
      const a = track.samples[i],
        p = map.points[i];
      assert.ok(a && p);
      assert.ok(
        p.x >= 12 - 1e-8 &&
          p.x <= 148 + 1e-8 &&
          p.y >= 12 - 1e-8 &&
          p.y <= 148 + 1e-8
      );
      assert.ok(
        Math.abs(p.x - (80 + (a.x - (minX + maxX) / 2) * scale)) < 1e-8
      );
      assert.ok(
        Math.abs(p.y - (80 + (a.z - (minZ + maxZ) / 2) * scale)) < 1e-8
      );
    }
  }
  assert.equal(shapes.size, courses.length);
});
void test('dot and progress follow stored arc-length segments including the closing seam', () => {
  const track = generateElevatedCircuit('flow-probe-21').track;
  const map = createMinimapGeometry(track);
  for (let i = 0; i < map.points.length - 1; i += 17) {
    const a = map.points[i],
      b = map.points[i + 1];
    assert.ok(a && b);
    const s = (a.s + b.s) / 2,
      p = sampleMinimap(map, s);
    assert.ok(Math.abs(p.x - (a.x + b.x) / 2) < 1e-8);
    assert.ok(Math.abs(p.y - (a.y + b.y) / 2) < 1e-8);
    assert.equal(p.completion, s / track.totalLength);
    assert.ok(
      Math.abs(p.stroke - (a.drawn + b.drawn) / 2 / map.drawnLength) < 1e-8
    );
  }
  const last = map.points.at(-2),
    first = map.points[0];
  assert.ok(last && first);
  const seam = sampleMinimap(map, (last.s + track.totalLength) / 2);
  assert.ok(Math.abs(seam.x - (last.x + first.x) / 2) < 1e-8);
  assert.ok(Math.abs(seam.y - (last.y + first.y) / 2) < 1e-8);
  const finish = sampleMinimap(map, track.totalLength);
  assert.equal(finish.completion, 1);
  assert.equal(finish.stroke, 1);
  assert.ok(Math.hypot(finish.x - first.x, finish.y - first.y) < 1e-8);
});
void test('continuous practice resets at the authoritative lap count while ranked finish clamps at 100 percent', () => {
  const map = createMinimapGeometry(createOvalTrack());
  for (const lap of [0, 1, 3, 17]) {
    const start = sampleMinimap(map, map.totalLength * lap, lap);
    assert.equal(start.completion, 0);
    assert.equal(start.stroke, 0);
    const middle = sampleMinimap(map, map.totalLength * (lap + 0.4), lap);
    assert.ok(Math.abs(middle.completion - 0.4) < 1e-12);
  }
  assert.equal(sampleMinimap(map, map.totalLength * 2).completion, 1);
  assert.equal(sampleMinimap(map, -10).completion, 0);
  assert.throws(() => sampleMinimap(map, NaN));
  assert.throws(() => sampleMinimap(map, 0, -1));
  assert.throws(() => sampleMinimap(map, 0, 0.5));
});
void test('crossing positions remain distinguishable by completed route rather than distance to finish', () => {
  const track = createTrackFromPoints(
    Array.from({ length: 720 }, (_, i) => {
      const t = (i / 720) * Math.PI * 2;
      return { x: 40 * Math.sin(t), z: 20 * Math.sin(2 * t) };
    }),
    {
      seed: 'minimap-crossing',
      generatorVersion: 'minimap-test',
      sampleSpacing: 0.25,
    }
  );
  const map = createMinimapGeometry(track);
  const start = sampleMinimap(map, 0),
    crossing = sampleMinimap(map, track.totalLength / 2);
  assert.ok(Math.hypot(crossing.x - start.x, crossing.y - start.y) < 1);
  assert.equal(start.stroke, 0);
  assert.ok(crossing.stroke > 0.49 && crossing.stroke < 0.51);
  assert.equal(crossing.completion, 0.5);
});
void test('thin or collapsed projected bounds stay finite and centred, and invalid coordinates are rejected', () => {
  const track = createOvalTrack();
  const thin = {
    ...track,
    samples: track.samples.map((p) => ({ ...p, x: 7 })),
  };
  const map = createMinimapGeometry(thin);
  assert.ok(map.points.every((p) => p.x === 80 && Number.isFinite(p.y)));
  const collapsed = createMinimapGeometry({
    ...thin,
    samples: thin.samples.map((p) => ({ ...p, z: 4 })),
  });
  assert.ok(collapsed.points.every((p) => p.x === 80 && p.y === 80));
  assert.equal(sampleMinimap(collapsed, track.totalLength / 2).stroke, 0);
  assert.throws(() => createMinimapGeometry({ ...track, totalLength: 0 }));
  assert.throws(() => createMinimapGeometry({ ...track, samples: [] }));
  assert.throws(() =>
    createMinimapGeometry({
      ...track,
      samples: track.samples.map((p, i) =>
        i === 0 ? { ...p, x: Infinity } : p
      ),
    })
  );
});
void test('sampling a racing minimap cannot mutate track hashes, shared simulation, input tape or replay results', () => {
  const track = generateElevatedCircuit('flow-probe-21').track;
  const before = serializeTrack(track),
    map = createMinimapGeometry(track);
  const control = createSimulationDriver(track),
    observed = createSimulationDriver(track);
  control.start(0);
  observed.start(0);
  for (let frame = 0; frame < 1000; frame++) {
    const time = (frame * 1000) / 60;
    if (frame % 100 === 0)
      for (const driver of [control, observed])
        driver.setInput(frame % 200 === 0, time);
    control.advance(time);
    observed.advance(time);
    sampleMinimap(map, observed.state.distance);
  }
  assert.equal(serializeTrack(track), before);
  assert.deepEqual(observed.state, control.state);
  assert.deepEqual(observed.replay, control.replay);
  const actual = sampleTrack(track, observed.state.distance);
  assert.ok(Number.isFinite(actual.x + actual.z));
});
