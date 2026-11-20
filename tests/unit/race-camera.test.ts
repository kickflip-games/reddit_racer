import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import {
  createRaceCamera,
  type RaceCameraViewport,
} from '../../src/client/race-camera.ts';
import { generateCircuit } from '../../src/shared/circuit-generator.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { createStuntCourse } from '../../src/shared/stunt-course.ts';
import { sampleTrack, type Track } from '../../src/shared/track.ts';
import { createSimulationState } from '../../src/shared/simulation.ts';
import { stepSlotSimulation } from '../../src/shared/slot-grip.ts';
import { generateBrakingCircuit } from '../../src/shared/braking-course-generator.ts';
import { createRacingState, stepRace } from '../../src/shared/race-rules.ts';
const views: RaceCameraViewport[] = [
  {
    width: 320,
    height: 568,
    insets: { top: 120, bottom: 24, left: 14, right: 14 },
  },
  {
    width: 412,
    height: 839,
    insets: { top: 120, bottom: 24, left: 14, right: 14 },
  },
  {
    width: 1280,
    height: 800,
    insets: { top: 120, bottom: 24, left: 14, right: 14 },
  },
  {
    width: 640,
    height: 360,
    insets: { top: 70, bottom: 24, left: 14, right: 14 },
  },
];
function pose(track: Track, distance: number, lateralOffset = 0) {
  const f = sampleTrack(track, distance);
  return {
    distance,
    lateralOffset,
    heading: Math.atan2(f.tx, f.tz),
    speed: 20,
  };
}
function screen(
  camera: ReturnType<typeof createRaceCamera>['camera'],
  view: RaceCameraViewport,
  x: number,
  y: number,
  z: number
) {
  const p = new Vector3(x, y, z).project(camera);
  return {
    x: ((p.x + 1) * view.width) / 2,
    y: ((1 - p.y) * view.height) / 2,
    z: p.z,
  };
}
function assertCar(
  track: Track,
  camera: ReturnType<typeof createRaceCamera>['camera'],
  view: RaceCameraViewport,
  distance: number,
  lateralOffset: number,
  elevation = 0
) {
  const f = sampleTrack(track, distance),
    x = f.x + f.nx * lateralOffset,
    z = f.z + f.nz * lateralOffset;
  for (const dx of [-2.2, 2.2])
    for (const dz of [-2.2, 2.2])
      for (const y of [elevation, elevation + 1.8]) {
        const p = screen(camera, view, x + dx, y, z + dz);
        assert.ok(
          p.x >= view.insets.left - 0.1 &&
            p.x <= view.width - view.insets.right + 0.1,
          `car x ${p.x}`
        );
        assert.ok(
          p.y >= view.insets.top - 0.1 &&
            p.y <= view.height - view.insets.bottom + 0.1,
          `car y ${p.y}`
        );
        assert.ok(p.z >= -1 && p.z <= 1);
      }
}
void test('steeper hill replay keeps the complete car inside every supported camera viewport', () => {
  const course = generateBrakingCircuit('word-v2:tui');
  const replay = course.quality.fastReplay;
  assert.ok(course.quality.valid && replay);
  for (const view of views) {
    const camera = createRaceCamera(course.track);
    camera.resize(view);
    let race = createRacingState(course.track),
      held = false,
      index = 0;
    camera.update(pose(course.track, 0), {
      mode: 'chase',
      deltaSeconds: 0,
      reset: true,
    });
    while (race.phase === 'racing') {
      while (replay.transitions[index]?.tick === race.simulation.tick)
        held = replay.transitions[index++]!.held;
      race = stepRace(course.track, race, held);
      const s = race.simulation,
        elevation = s.vertical?.height ?? 0;
      camera.update(
        {
          ...pose(course.track, s.distance, s.lateralOffset),
          speed: s.speed,
          elevation,
        },
        { mode: 'chase', deltaSeconds: 1 / 120 }
      );
      if (s.tick % 12 === 0)
        assertCar(
          course.track,
          camera.camera,
          view,
          s.distance,
          s.lateralOffset,
          elevation
        );
    }
  }
});
void test('hero preview keeps a readable car rather than fitting a wide circuit thumbnail', () => {
  for (const track of [createOvalTrack(), createStuntCourse().track])
    for (const view of views) {
      const c = createRaceCamera(track);
      c.resize(view);
      c.update(pose(track, 0), {
        mode: 'overview',
        deltaSeconds: 0,
        reset: true,
      });
      assertCar(track, c.camera, view, 0, 0);
      const pxPerMetre = view.width / (c.camera.right - c.camera.left);
      assert.ok(pxPerMetre * 3.8 > 30);
    }
});
void test('complete real driving poses keep car visible and braking-relevant road ahead', () => {
  for (const track of [createOvalTrack(), generateCircuit('showcase-3').track])
    for (const view of views) {
      const c = createRaceCamera(track);
      c.resize(view);
      let state = createSimulationState(),
        visible = 0,
        total = 0;
      c.update(pose(track, 0), { mode: 'chase', deltaSeconds: 0, reset: true });
      while (state.status === 'running' && state.tick < 14400) {
        state = stepSlotSimulation(track, state, true);
        c.update(
          {
            ...pose(track, state.distance, state.lateralOffset),
            speed: state.speed,
          },
          { mode: 'chase', deltaSeconds: 1 / 120 }
        );
        if (state.tick % 12 !== 0) continue;
        assertCar(track, c.camera, view, state.distance, state.lateralOffset);
        const next = sampleTrack(track, state.distance + 15);
        const p = screen(c.camera, view, next.x, 0, next.z);
        total++;
        if (
          p.x >= 0 &&
          p.x <= view.width &&
          p.y >= view.insets.top &&
          p.y <= view.height
        )
          visible++;
      }
      assert.ok(
        visible / total > 0.95,
        `${visible}/${total} braking points visible`
      );
    }
});
void test('jumps and large off-road poses remain visible on all supported layouts', () => {
  const track = createStuntCourse().track;
  for (const view of views) {
    const c = createRaceCamera(track);
    c.resize(view);
    for (const distance of [0, 45, 160, 460, track.totalLength + 2, -2])
      for (const lateralOffset of [-12, 0, 12]) {
        const p = { ...pose(track, distance, lateralOffset), elevation: 4 };
        c.update(p, { mode: 'chase', deltaSeconds: 0, reset: true });
        assertCar(track, c.camera, view, distance, lateralOffset, 4);
      }
  }
});
void test('reduced motion retains orientation and steady poses settle exactly', () => {
  const track = createOvalTrack(),
    view = views[1];
  assert.ok(view);
  const c = createRaceCamera(track);
  c.resize(view);
  c.update(pose(track, 0), {
    mode: 'chase',
    deltaSeconds: 0,
    reset: true,
    reducedMotion: true,
  });
  const direction = c.camera.getWorldDirection(new Vector3()).toArray();
  for (let i = 0; i < 600; i++)
    c.update(pose(track, 80), {
      mode: 'chase',
      deltaSeconds: 1 / 60,
      reducedMotion: true,
    });
  const after = c.camera.getWorldDirection(new Vector3()).toArray();
  assert.ok(after.every((n, i) => Math.abs(n - (direction[i] ?? 0)) < 1e-12));
  assert.equal(
    c.update(pose(track, 80), {
      mode: 'chase',
      deltaSeconds: 1 / 60,
      reducedMotion: true,
    }),
    false
  );
});
void test('the camera follows every bend and jump without rotating in either motion mode', () => {
  const track = createStuntCourse().track;
  for (const reducedMotion of [false, true]) {
    const c = createRaceCamera(track);
    const view = views[1];
    assert.ok(view);
    c.resize(view);
    const direction = c.camera.getWorldDirection(new Vector3());
    const startPosition = c.camera.position.clone();
    for (let i = 0; i < 200; i++) {
      const distance = (i / 200) * track.totalLength;
      c.update(
        { ...pose(track, distance), elevation: i % 6 },
        {
          mode: i < 10 ? 'overview' : 'chase',
          deltaSeconds: 1 / 60,
          reset: i % 30 === 0,
          reducedMotion,
        }
      );
      assert.ok(
        c.camera.getWorldDirection(new Vector3()).distanceTo(direction) < 1e-12
      );
    }
    assert.ok(c.camera.position.distanceTo(startPosition) > 10);
    // An oblique view exposes ramp/deck height rather than looking straight down.
    assert.ok(Math.abs(direction.y) < 0.7);
  }
});
void test('invalid camera updates do not mutate matrices or canonical geometry', () => {
  const track = createOvalTrack(),
    before = JSON.stringify(track),
    view = views[0];
  assert.ok(view);
  const c = createRaceCamera(track);
  c.resize(view);
  const matrix = c.camera.matrixWorld.toArray();
  for (const n of [NaN, Infinity, -1]) {
    assert.throws(() => c.resize({ ...view, width: n }));
    assert.throws(() =>
      c.update(pose(track, 0), { mode: 'chase', deltaSeconds: n })
    );
  }
  assert.deepEqual(c.camera.matrixWorld.toArray(), matrix);
  assert.equal(JSON.stringify(track), before);
});
