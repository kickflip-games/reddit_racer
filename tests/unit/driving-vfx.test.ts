import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  createDrivingVfx,
  DRIVING_VFX_LIMITS,
  type DrivingVfx,
  type DrivingVfxFrame,
} from '../../src/client/driving-vfx.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import {
  roadPointAt,
  sampleTrack,
  type Track,
} from '../../src/shared/track.ts';
import {
  createSimulationState,
  SIMULATION_HZ,
  type SimulationState,
} from '../../src/shared/simulation.ts';
import {
  createRacingState,
  stepRace,
  type RacePhase,
} from '../../src/shared/race-rules.ts';
import { LIFT_REPLAY } from '../../src/shared/fixtures/reference-replays.ts';
import { runReplay } from '../../src/shared/replay.ts';

const track = createOvalTrack();
type FixtureOptions = {
  state?: Partial<SimulationState>;
  phase?: RacePhase;
  deltaSeconds?: number;
  reducedMotion?: boolean;
};
function frameAt(
  tick: number,
  options: FixtureOptions = {},
  course: Track = track
): DrivingVfxFrame {
  const speed = options.state?.speed ?? 12;
  const state = {
    ...createSimulationState(),
    tick,
    distance: (tick * speed) / SIMULATION_HZ,
    speed,
    slip: 0.8,
    ...options.state,
  };
  const s = course.startS + state.distance - 1.5;
  const left = roadPointAt(course, s, state.lateralOffset + 0.7);
  const right = roadPointAt(course, s, state.lateralOffset - 0.7);
  return {
    state,
    phase: options.phase ?? 'racing',
    held: true,
    acceleration: 0,
    rearLeft: { ...left, y: 0.045 },
    rearRight: { ...right, y: 0.045 },
    deltaSeconds: options.deltaSeconds ?? 1 / 60,
    cssPixelsPerMetre: 8,
    reducedMotion: options.reducedMotion ?? false,
  };
}
function particles(
  vfx: DrivingVfx,
  name: 'tyre-smoke' | 'offroad-dust'
): THREE.Points {
  const found = vfx.object.getObjectByName(name);
  assert.ok(found instanceof THREE.Points);
  return found;
}
function skids(vfx: DrivingVfx): THREE.Mesh {
  const found = vfx.object.getObjectByName('tyre-skids');
  assert.ok(found instanceof THREE.Mesh);
  return found;
}
function liveSkids(vfx: DrivingVfx): number {
  const colors = skids(vfx).geometry.getAttribute('color');
  let live = 0;
  for (let slot = 0; slot < DRIVING_VFX_LIMITS.skidQuads; slot++)
    if (colors.getW(slot * 4) > 0) live++;
  return live;
}
function emit(
  vfx: DrivingVfx,
  from: number,
  to: number,
  options: FixtureOptions = {},
  step = 4
): void {
  for (let tick = from; tick <= to; tick += step)
    vfx.update(frameAt(tick, options));
}

void test('fixed buffers and tick credits give the same bounded births at 30/60/120 Hz', () => {
  const observed = [];
  for (const hz of [30, 60, 120]) {
    const vfx = createDrivingVfx(track, { noiseSeed: 5 });
    const smoke = particles(vfx, 'tyre-smoke'),
      dust = particles(vfx, 'offroad-dust');
    assert.equal(smoke.geometry.getAttribute('position').count, 48);
    assert.equal(dust.geometry.getAttribute('position').count, 48);
    assert.equal(skids(vfx).geometry.getAttribute('position').count, 384 * 4);
    assert.equal(smoke.geometry.getAttribute('color').itemSize, 4);
    assert.ok(smoke.material instanceof THREE.PointsMaterial);
    assert.equal(smoke.material.vertexColors, true);
    assert.equal(smoke.material.transparent, true);
    assert.equal(smoke.material.depthWrite, false);
    emit(vfx, 0, 120, { deltaSeconds: 0 }, 120 / hz);
    observed.push({
      births: smoke.geometry.drawRange.count,
      marks: liveSkids(vfx),
    });
    assert.equal(smoke.geometry.drawRange.count, 32);
    assert.equal(dust.geometry.drawRange.count, 0);
    assert.equal(liveSkids(vfx), 58);
    const snapshot = Array.from(
      skids(vfx).geometry.getAttribute('position').array
    );
    for (let duplicate = 0; duplicate < 20; duplicate++)
      vfx.update(frameAt(120, { deltaSeconds: 0 }));
    assert.equal(smoke.geometry.drawRange.count, 32);
    assert.equal(liveSkids(vfx), 58);
    assert.deepEqual(
      Array.from(skids(vfx).geometry.getAttribute('position').array),
      snapshot
    );
    vfx.dispose();
  }
  assert.deepEqual(observed[0], observed[1]);
  assert.deepEqual(observed[1], observed[2]);
});

void test('pooled particles and skid ring recycle without growing their fixed budgets', () => {
  const vfx = createDrivingVfx(track);
  emit(vfx, 0, 2400, { deltaSeconds: 0 });
  assert.equal(particles(vfx, 'tyre-smoke').geometry.drawRange.count, 48);
  assert.equal(liveSkids(vfx), 384);
  assert.equal(skids(vfx).geometry.drawRange.count, 384 * 6);
  emit(vfx, 2404, 4800, {
    state: { offRoad: true, lateralOffset: 5 },
    deltaSeconds: 0,
  });
  assert.equal(particles(vfx, 'offroad-dust').geometry.drawRange.count, 48);
  assert.equal(particles(vfx, 'tyre-smoke').geometry.drawRange.count, 48);
  assert.equal(liveSkids(vfx), 384);
  for (const node of vfx.object.children) {
    assert.ok(node instanceof THREE.Mesh || node instanceof THREE.Points);
    for (const attribute of Object.values(node.geometry.attributes)) {
      assert.ok(attribute instanceof THREE.BufferAttribute);
      assert.ok(attribute.updateRanges.length <= 1);
    }
  }
  vfx.dispose();
});

void test('stationary, low-slip, countdown, recovery and repeated tick frames do not emit', () => {
  const vfx = createDrivingVfx(track);
  const inactivePhases: RacePhase[] = [
    'ready',
    'countdown',
    'abandoned',
    'finished',
  ];
  for (const phase of inactivePhases) {
    for (let tick = 0; tick < 120; tick += 4)
      vfx.update(frameAt(tick, { phase }));
  }
  emit(vfx, 0, 120, { state: { speed: 0 } });
  emit(vfx, 0, 120, { state: { slip: 0 } });
  emit(vfx, 0, 120, { state: { recovering: true, recoveryTicksRemaining: 5 } });
  assert.equal(particles(vfx, 'tyre-smoke').geometry.drawRange.count, 0);
  assert.equal(particles(vfx, 'offroad-dust').geometry.drawRange.count, 0);
  assert.equal(liveSkids(vfx), 0);
  vfx.dispose();
});

void test('recovery, teleport, backward progress, phases and excessive gaps never bridge trails', () => {
  for (const boundary of [
    'recovery',
    'counter',
    'teleport',
    'progress-jump',
    'backward',
    'gap',
    'phase',
  ]) {
    const vfx = createDrivingVfx(track);
    emit(vfx, 0, 60, { deltaSeconds: 0 });
    const before = liveSkids(vfx);
    let bad = frameAt(64, { deltaSeconds: 0 });
    if (boundary === 'recovery')
      bad = frameAt(64, {
        state: { recovering: true, recoveryTicksRemaining: 10 },
        deltaSeconds: 0,
      });
    if (boundary === 'counter')
      bad = frameAt(64, { state: { recoveryCount: 1 }, deltaSeconds: 0 });
    if (boundary === 'teleport')
      bad = {
        ...bad,
        rearLeft: { x: bad.rearLeft.x + 100, y: 0.045, z: bad.rearLeft.z },
        rearRight: { x: bad.rearRight.x + 100, y: 0.045, z: bad.rearRight.z },
      };
    if (boundary === 'progress-jump')
      bad = frameAt(64, { state: { distance: 100 }, deltaSeconds: 0 });
    if (boundary === 'backward') bad = frameAt(4, { deltaSeconds: 0 });
    if (boundary === 'gap') bad = frameAt(120, { deltaSeconds: 0 });
    if (boundary === 'phase')
      bad = frameAt(64, { phase: 'abandoned', deltaSeconds: 0 });
    vfx.update(bad);
    assert.equal(liveSkids(vfx), before, boundary);
    assert.equal(
      particles(vfx, 'tyre-smoke').geometry.drawRange.count,
      16,
      boundary
    );
    vfx.dispose();
  }
});

void test('off-road dust makes no grass marks and canonical edge-crossing quads are rejected', () => {
  const vfx = createDrivingVfx(track);
  emit(vfx, 0, 120, {
    state: { offRoad: true, lateralOffset: 5 },
    deltaSeconds: 0,
  });
  assert.ok(particles(vfx, 'offroad-dust').geometry.drawRange.count > 0);
  assert.equal(liveSkids(vfx), 0);
  vfx.reset();
  // Lie about the surface flag: containment must still reject tyre contacts beyond the road.
  emit(vfx, 0, 120, {
    state: { offRoad: false, lateralOffset: 5 },
    deltaSeconds: 0,
  });
  assert.equal(liveSkids(vfx), 0);
  vfx.reset();
  emit(vfx, 0, 120, { deltaSeconds: 0 });
  assert.ok(liveSkids(vfx) > 0);
  const positions = skids(vfx).geometry.getAttribute('position');
  for (
    let index = 0;
    index < (skids(vfx).geometry.drawRange.count / 6) * 4;
    index++
  ) {
    assert.ok(Number.isFinite(positions.getX(index) + positions.getZ(index)));
    assert.ok(Math.abs(positions.getY(index) - 0.043) < 1e-6);
  }
  vfx.dispose();
});

void test('particles and marks fade after finish, and reduced motion clears immediately', () => {
  const vfx = createDrivingVfx(track);
  emit(vfx, 0, 120);
  const smoke = particles(vfx, 'tyre-smoke');
  assert.ok(smoke.geometry.drawRange.count > 0 && liveSkids(vfx) > 0);
  const alpha = smoke.geometry.getAttribute('color').getW(0);
  vfx.update(frameAt(120, { phase: 'finished', deltaSeconds: 0.05 }));
  assert.ok(smoke.geometry.getAttribute('color').getW(0) < alpha);
  for (let age = 0; age < 160; age++)
    vfx.update(frameAt(120, { phase: 'finished', deltaSeconds: 0.05 }));
  assert.equal(smoke.geometry.drawRange.count, 0);
  assert.equal(skids(vfx).geometry.drawRange.count, 0);
  vfx.reset();
  emit(vfx, 0, 60, { deltaSeconds: 0 });
  vfx.update(frameAt(64, { reducedMotion: true }));
  assert.equal(smoke.geometry.drawRange.count, 0);
  assert.equal(liveSkids(vfx), 0);
  emit(vfx, 68, 200, { reducedMotion: true, deltaSeconds: 0 });
  assert.equal(smoke.geometry.drawRange.count, 0);
  vfx.update(frameAt(204, { deltaSeconds: 0 }));
  assert.equal(smoke.geometry.drawRange.count, 0);
  vfx.dispose();
});

void test('20 retries reuse every GPU resource and teardown disposes each resource once', () => {
  const vfx = createDrivingVfx(track);
  const nodes = vfx.object.children.map((node) => {
    assert.ok(node instanceof THREE.Mesh || node instanceof THREE.Points);
    return node;
  });
  function resourceBuffers(): unknown[] {
    const result: unknown[] = [];
    for (const node of nodes)
      for (const attribute of Object.values(node.geometry.attributes)) {
        assert.ok(attribute instanceof THREE.BufferAttribute);
        result.push(attribute, attribute.array);
      }
    return result;
  }
  const buffers = resourceBuffers();
  const geometries = new Set(nodes.map((node) => node.geometry));
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const node of nodes)
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      if (material instanceof THREE.PointsMaterial && material.map)
        textures.add(material.map);
    }
  assert.equal(geometries.size, 4);
  assert.equal(materials.size, 4);
  assert.equal(textures.size, 1);
  for (let retry = 0; retry < 20; retry++) {
    emit(vfx, 0, 60, { deltaSeconds: 0 });
    vfx.reset();
    const currentBuffers = resourceBuffers();
    currentBuffers.forEach((buffer, index) =>
      assert.equal(buffer, buffers[index])
    );
    for (const node of nodes) assert.equal(node.geometry.drawRange.count, 0);
    assert.equal(liveSkids(vfx), 0);
  }
  let geometryDisposals = 0,
    materialDisposals = 0,
    textureDisposals = 0;
  for (const geometry of geometries)
    geometry.addEventListener('dispose', () => geometryDisposals++);
  for (const material of materials)
    material.addEventListener('dispose', () => materialDisposals++);
  for (const texture of textures)
    texture.addEventListener('dispose', () => textureDisposals++);
  vfx.dispose();
  vfx.dispose();
  assert.equal(geometryDisposals, 4);
  assert.equal(materialDisposals, 4);
  assert.equal(textureDisposals, 1);
  assert.equal(vfx.object.children.length, 0);
});

void test('effects do not mutate the authoritative replay, race state or finishing tick', () => {
  const replay = structuredClone(LIFT_REPLAY),
    before = JSON.stringify(replay);
  const expected = runReplay(track, replay);
  const vfx = createDrivingVfx(track);
  let race = createRacingState(track),
    input = false,
    transition = 0;
  while (race.phase === 'racing') {
    if (replay.transitions[transition]?.tick === race.simulation.tick) {
      input = replay.transitions[transition]?.held ?? false;
      transition++;
    }
    race = stepRace(track, race, input);
    const state = Object.freeze(race.simulation);
    const pose = frameAt(state.tick, {
      state,
      phase: race.phase,
      deltaSeconds: 1 / SIMULATION_HZ,
    });
    vfx.update(pose);
  }
  assert.deepEqual(race.simulation, expected.state);
  assert.equal(race.simulation.finishedTick, expected.finishTicks);
  assert.equal(JSON.stringify(replay), before);
  vfx.dispose();
});

void test('canonical variable-width boundaries reject an inside tyre centre whose full mark crosses the edge', () => {
  const points = [
    { x: 0, z: 0, tx: 1, tz: 0, width: 2 },
    { x: 10, z: 0, tx: 1, tz: 0, width: 6 },
    { x: 20, z: 10, tx: 0, tz: 1, width: 6 },
    { x: 20, z: 20, tx: 0, tz: 1, width: 6 },
    { x: 10, z: 30, tx: -1, tz: 0, width: 6 },
    { x: 0, z: 30, tx: -1, tz: 0, width: 6 },
    { x: -10, z: 20, tx: 0, tz: -1, width: 6 },
    { x: -10, z: 10, tx: 0, tz: -1, width: 6 },
  ];
  let length = 0;
  const samples = points.map((point, index) => {
    const sample = { ...point, s: length, curvature: 0 };
    const next = points[(index + 1) % points.length];
    assert.ok(next);
    length += Math.hypot(next.x - point.x, next.z - point.z);
    return sample;
  });
  const course: Track = {
    schemaVersion: 1,
    generatorVersion: 'visual-trapezoid-fixture',
    seed: 'width-boundary',
    totalLength: length,
    startS: 0,
    samples,
    checkpoints: [],
  };
  const vfx = createDrivingVfx(course);
  for (let tick = 0; tick <= 60; tick += 4) {
    const distance = 3.5 + tick / 10;
    const frame = frameAt(
      tick,
      { state: { distance }, deltaSeconds: 0 },
      course
    );
    const road = sampleTrack(course, distance - 1.5);
    vfx.update({
      ...frame,
      rearLeft: { x: road.x, y: 0.045, z: road.width / 2 - 0.04 },
      rearRight: { x: road.x, y: 0.045, z: -0.5 },
    });
  }
  assert.ok(liveSkids(vfx) > 0);
  const geometry = skids(vfx).geometry,
    position = geometry.getAttribute('position');
  // Only the safe right tyre may leave a mark; the other centre is still on asphalt.
  for (let vertex = 0; vertex < (geometry.drawRange.count / 6) * 4; vertex++) {
    assert.ok(position.getZ(vertex) >= -0.6 && position.getZ(vertex) <= -0.4);
  }
  vfx.dispose();
});

void test('the canonical closing segment stays continuous without a seam bridge or missing marks', () => {
  const course = createOvalTrack({
    radiusX: 20,
    radiusZ: 20,
    sampleSpacing: 5,
  });
  const vfx = createDrivingVfx(course);
  for (let tick = 0; tick <= 120; tick += 4) {
    vfx.update(
      frameAt(
        tick,
        {
          state: { distance: course.totalLength - 2 + tick / 10 },
          deltaSeconds: 0,
        },
        course
      )
    );
  }
  assert.equal(liveSkids(vfx), 58);
  const position = skids(vfx).geometry.getAttribute('position');
  for (
    let vertex = 0;
    vertex < (skids(vfx).geometry.drawRange.count / 6) * 4;
    vertex++
  ) {
    const radius = Math.hypot(position.getX(vertex), position.getZ(vertex));
    assert.ok(radius > 15 && radius < 24);
  }
  vfx.dispose();
});

void test('caller-owned contact vectors can be reused and long catch-up cannot burst beyond four particles', () => {
  const vfx = createDrivingVfx(track);
  const first = frameAt(0, { deltaSeconds: 0 });
  const left = new THREE.Vector3(
    first.rearLeft.x,
    first.rearLeft.y,
    first.rearLeft.z
  );
  const right = new THREE.Vector3(
    first.rearRight.x,
    first.rearRight.y,
    first.rearRight.z
  );
  for (let tick = 0; tick <= 60; tick += 4) {
    const next = frameAt(tick, { deltaSeconds: 0 });
    left.set(next.rearLeft.x, next.rearLeft.y, next.rearLeft.z);
    right.set(next.rearRight.x, next.rearRight.y, next.rearRight.z);
    vfx.update({ ...next, rearLeft: left, rearRight: right });
  }
  assert.equal(particles(vfx, 'tyre-smoke').geometry.drawRange.count, 16);
  assert.equal(liveSkids(vfx), 28);
  vfx.reset();
  vfx.update(frameAt(0, { deltaSeconds: 0 }));
  vfx.update(frameAt(24, { deltaSeconds: 0 }));
  assert.equal(particles(vfx, 'tyre-smoke').geometry.drawRange.count, 4);
  const skidMesh = skids(vfx);
  vfx.reset();
  emit(vfx, 0, 60, { deltaSeconds: 0 });
  const p = skidMesh.geometry.getAttribute('position');
  for (let quad = 0; quad < skidMesh.geometry.drawRange.count / 6; quad++) {
    const a = quad * 4,
      b = a + 1,
      c = a + 2;
    const normalY =
      (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) -
      (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
    assert.ok(normalY > 0);
  }
  vfx.dispose();
});

void test('empty effects remain unchanged while explicit reset and reduced-motion clear invalidate once', () => {
  const vfx = createDrivingVfx(track);
  const empty = frameAt(0, { phase: 'ready', state: { speed: 0 } });
  assert.equal(vfx.update(empty), false);
  assert.equal(vfx.update({ ...empty, cssPixelsPerMetre: 12 }), false);
  assert.equal(vfx.update(empty), false);
  vfx.reset();
  assert.equal(vfx.update(empty), true);
  assert.equal(vfx.update(empty), false);
  assert.equal(vfx.update({ ...empty, reducedMotion: true }), true);
  assert.equal(vfx.update({ ...empty, reducedMotion: true }), false);
  assert.equal(vfx.update(empty), false);
  vfx.dispose();
  assert.equal(vfx.update(empty), false);
});

void test('births, visible point sizing, fading and the final clear report changes without duplicate tick uploads', () => {
  const vfx = createDrivingVfx(track);
  assert.equal(vfx.update(frameAt(0, { deltaSeconds: 0 })), false);
  const born = frameAt(4, { deltaSeconds: 0 });
  assert.equal(vfx.update(born), true);
  assert.equal(vfx.update(born), false);
  const resized = { ...born, cssPixelsPerMetre: 10 };
  assert.equal(vfx.update(resized), true);
  assert.equal(vfx.update(resized), false);
  emit(vfx, 8, 120, { deltaSeconds: 0 });
  const finish = frameAt(120, { phase: 'finished', deltaSeconds: 0 });
  assert.equal(vfx.update(finish), false, 'History-only phase change');
  const nodes = vfx.object.children.map((node) => {
    assert.ok(node instanceof THREE.Mesh || node instanceof THREE.Points);
    return node;
  });
  let finalClear = false;
  for (let age = 0; age < 160; age++) {
    const changed = vfx.update({ ...finish, deltaSeconds: 0.05 });
    const allEmpty = nodes.every((node) => node.geometry.drawRange.count === 0);
    if (allEmpty) {
      assert.equal(
        changed,
        true,
        'Final invisible draw range still needs a clear'
      );
      finalClear = true;
      break;
    }
    assert.equal(changed, true, 'Visible particles/marks keep fading');
  }
  assert.equal(finalClear, true);
  const versions = nodes.map((node) => {
    const position = node.geometry.getAttribute('position');
    const color = node.geometry.getAttribute('color');
    assert.ok(position instanceof THREE.BufferAttribute);
    assert.ok(color instanceof THREE.BufferAttribute);
    return [position.version, color.version];
  });
  for (let idle = 0; idle < 120; idle++)
    assert.equal(vfx.update({ ...finish, deltaSeconds: 0.05 }), false);
  nodes.forEach((node, index) => {
    const position = node.geometry.getAttribute('position');
    const color = node.geometry.getAttribute('color');
    assert.ok(position instanceof THREE.BufferAttribute);
    assert.ok(color instanceof THREE.BufferAttribute);
    assert.deepEqual([position.version, color.version], versions[index]);
  });
  vfx.dispose();
});

void test('reset and reduced-motion clears retain exactly one pending visual invalidation with live pools', () => {
  const vfx = createDrivingVfx(track);
  emit(vfx, 0, 60, { deltaSeconds: 0 });
  vfx.reset();
  const ready = frameAt(0, { phase: 'ready', deltaSeconds: 0 });
  assert.equal(vfx.update(ready), true);
  assert.equal(vfx.update(ready), false);
  emit(vfx, 0, 60, { deltaSeconds: 0 });
  const reduced = frameAt(64, { reducedMotion: true, deltaSeconds: 0 });
  assert.equal(vfx.update(reduced), true);
  assert.equal(vfx.update(reduced), false);
  assert.equal(particles(vfx, 'tyre-smoke').geometry.drawRange.count, 0);
  assert.equal(skids(vfx).geometry.drawRange.count, 0);
  assert.equal(vfx.update(frameAt(68, { deltaSeconds: 0 })), false);
  assert.equal(vfx.update(frameAt(72, { deltaSeconds: 0 })), true);
  vfx.dispose();
});

void test('speed streaks follow the car at speed, including flight, with fixed buffers and safe lifecycle', () => {
  const vfx = createDrivingVfx(track);
  const streaks = vfx.object.getObjectByName('car-speed-streaks');
  assert.ok(streaks instanceof THREE.Mesh);
  const p = streaks.geometry.getAttribute('position');
  assert.equal(p.count, DRIVING_VFX_LIMITS.speedStreaks * 4);
  const fly = frameAt(120, {
    state: {
      speed: 28,
      slip: 0,
      vertical: {
        height: 5,
        velocity: 1,
        airborne: true,
        landings: 0,
        impact: 0,
      },
    },
  });
  const airborne = {
    ...fly,
    rearLeft: { ...fly.rearLeft, y: 5 },
    rearRight: { ...fly.rearRight, y: 5 },
  };
  assert.equal(vfx.update(airborne), true);
  assert.equal(
    streaks.geometry.drawRange.count,
    DRIVING_VFX_LIMITS.speedStreaks * 6
  );
  for (let i = 0; i < p.count; i++) assert.ok(p.getY(i) > 5 && p.getY(i) < 6);
  assert.equal(particles(vfx, 'tyre-smoke').geometry.drawRange.count, 0);
  assert.equal(liveSkids(vfx), 0);
  assert.equal(vfx.update({ ...airborne, deltaSeconds: 0 }), false);
  assert.equal(vfx.update({ ...airborne, phase: 'finished' }), true);
  assert.equal(streaks.geometry.drawRange.count, 0);
  vfx.update(airborne);
  vfx.update({ ...airborne, reducedMotion: true });
  assert.equal(streaks.geometry.drawRange.count, 0);
  vfx.update({ ...airborne, state: { ...airborne.state, speed: 0 } });
  assert.equal(streaks.geometry.drawRange.count, 0);
  vfx.update({ ...airborne, state: { ...airborne.state, recovering: true } });
  assert.equal(streaks.geometry.drawRange.count, 0);
  vfx.dispose();
});

void test('landing particles are bounded, impact-sensitive and never fabricated on initial state', () => {
  for (const impact of [0, 1]) {
    const vfx = createDrivingVfx(track);
    const initial = frameAt(0, {
      state: {
        vertical: {
          height: 0,
          velocity: 0,
          airborne: false,
          landings: 4,
          impact,
        },
      },
    });
    vfx.update(initial);
    assert.equal(particles(vfx, 'offroad-dust').geometry.drawRange.count, 0);
    const landed = frameAt(4, {
      state: {
        slip: 0,
        vertical: {
          height: 0,
          velocity: 0,
          airborne: false,
          landings: 5,
          impact,
        },
      },
      deltaSeconds: 0,
    });
    vfx.update(landed);
    assert.equal(
      particles(vfx, 'offroad-dust').geometry.drawRange.count,
      6 + impact * 6
    );
    vfx.update(landed);
    assert.equal(
      particles(vfx, 'offroad-dust').geometry.drawRange.count,
      6 + impact * 6
    );
    vfx.dispose();
  }
});
