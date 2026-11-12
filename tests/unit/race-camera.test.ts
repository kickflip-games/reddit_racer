import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3, type OrthographicCamera } from 'three';
import {
  createRaceCamera,
  type RaceCameraPose,
  type RaceCameraViewport,
} from '../../src/client/race-camera.ts';
import { generateCircuit } from '../../src/shared/circuit-generator.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { sampleTrack, type Track } from '../../src/shared/track.ts';
import { createRacingState, stepRace } from '../../src/shared/race-rules.ts';

type Point = { x: number; y: number; z: number };
const views: RaceCameraViewport[] = [
  {
    width: 320,
    height: 568,
    insets: { top: 108, right: 12, bottom: 44, left: 12 },
  },
  {
    width: 393,
    height: 852,
    insets: { top: 108, right: 18, bottom: 44, left: 18 },
  },
  {
    width: 640,
    height: 360,
    insets: { top: 56, right: 24, bottom: 36, left: 24 },
  },
];
const oval = createOvalTrack();
// One structural fixture only: no controller search or quality-generation campaign.
const hairpin = generateCircuit('showcase-3').track;

function poseAt(
  track: Track,
  distance: number,
  lateralOffset = 0,
  yawOffset = 0
): RaceCameraPose {
  const frame = sampleTrack(track, distance);
  return {
    distance,
    lateralOffset,
    heading: Math.atan2(frame.tx, frame.tz) + yawOffset,
  };
}

function edges(track: Track, distance: number): Point[] {
  const s =
    ((distance % track.totalLength) + track.totalLength) % track.totalLength;
  let index = track.samples.findIndex((sample) => sample.s > s) - 1;
  if (index < 0) index = track.samples.length - 1;
  const current = track.samples[index];
  const next = track.samples[(index + 1) % track.samples.length];
  assert.ok(current && next);
  const end = index === track.samples.length - 1 ? track.totalLength : next.s;
  const blend = (s - current.s) / (end - current.s);
  return [-1, 1].map((side) => {
    const currentLateral = side * (current.width / 2 + 0.8);
    const nextLateral = side * (next.width / 2 + 0.8);
    const x0 = current.x - current.tz * currentLateral;
    const z0 = current.z + current.tx * currentLateral;
    const x1 = next.x - next.tz * nextLateral;
    const z1 = next.z + next.tx * nextLateral;
    return { x: x0 + (x1 - x0) * blend, y: 0.08, z: z0 + (z1 - z0) * blend };
  });
}

function carPoints(track: Track, pose: RaceCameraPose): Point[] {
  const frame = sampleTrack(track, pose.distance);
  const x = frame.x + frame.nx * pose.lateralOffset;
  const z = frame.z + frame.nz * pose.lateralOffset;
  const forwardX = Math.sin(pose.heading);
  const forwardZ = Math.cos(pose.heading);
  const points: Point[] = [];
  for (const fore of [-2, 2]) {
    for (const side of [-1.1, 1.1]) {
      for (const y of [0, 1.8]) {
        points.push({
          x: x + forwardX * fore - forwardZ * side,
          y,
          z: z + forwardZ * fore + forwardX * side,
        });
      }
    }
  }
  return points;
}

function requiredPoints(
  track: Track,
  pose: RaceCameraPose,
  mode: 'overview' | 'chase' = 'chase'
): Point[] {
  const points = carPoints(track, pose);
  const start =
    (((pose.distance - 5) % track.totalLength) + track.totalLength) %
    track.totalLength;
  for (const sample of track.samples) {
    const delta = (sample.s - start + track.totalLength) % track.totalLength;
    if (mode === 'overview' || track.totalLength <= 40 || delta <= 40) {
      for (const side of [-1, 1]) {
        const lateral = side * (sample.width / 2 + 0.8);
        points.push({
          x: sample.x - sample.tz * lateral,
          y: 0.08,
          z: sample.z + sample.tx * lateral,
        });
      }
    }
  }
  if (mode === 'chase')
    points.push(
      ...edges(track, pose.distance - 5),
      ...edges(track, pose.distance + 35)
    );
  return points;
}

function assertFits(
  camera: OrthographicCamera,
  viewport: RaceCameraViewport,
  points: Point[]
): void {
  for (const point of points) {
    const projected = new Vector3(point.x, point.y, point.z).project(camera);
    const x = ((projected.x + 1) * viewport.width) / 2;
    const y = ((1 - projected.y) * viewport.height) / 2;
    const tolerance = 1e-6;
    assert.ok(
      x >= viewport.insets.left - tolerance &&
        x <= viewport.width - viewport.insets.right + tolerance,
      `x=${x} outside safe area`
    );
    assert.ok(
      y >= viewport.insets.top - tolerance &&
        y <= viewport.height - viewport.insets.bottom + tolerance,
      `y=${y} outside safe area`
    );
    assert.ok(
      projected.z >= -1 - tolerance && projected.z <= 1 + tolerance,
      `depth=${projected.z} outside camera planes`
    );
  }
}

function matrices(camera: OrthographicCamera): number[] {
  return [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
}

void test('overview fits the whole canonical shoulder mesh and car with asymmetric HUD reserves', () => {
  for (const track of [oval, hairpin]) {
    for (const view of views) {
      const raceCamera = createRaceCamera(track);
      assert.equal(raceCamera.renderable, false);
      assert.equal(raceCamera.resize(view), true);
      assert.equal(raceCamera.renderable, true);
      const pose = poseAt(track, 0);
      assertFits(
        raceCamera.camera,
        view,
        requiredPoints(track, pose, 'overview')
      );
      assert.equal(
        raceCamera.update(pose, { mode: 'overview', deltaSeconds: 0 }),
        false
      );
      assert.equal(raceCamera.resize(view), false);
    }
  }
});

void test('chase sweep fits every intervening shoulder and current off-road car against the lagged anchor', () => {
  for (const track of [oval, hairpin]) {
    for (const view of views) {
      const raceCamera = createRaceCamera(track);
      raceCamera.resize(view);
      for (
        let distance = -6;
        distance < track.totalLength + 40;
        distance += 1.7
      ) {
        const pose = poseAt(
          track,
          distance,
          11.5 * Math.sin(distance / 17),
          0.6 * Math.sin(distance / 11)
        );
        raceCamera.update(pose, { mode: 'chase', deltaSeconds: 1 / 60 });
        assertFits(raceCamera.camera, view, requiredPoints(track, pose));
      }
      const direction = raceCamera.camera.getWorldDirection(new Vector3());
      assert.ok(Math.abs(direction.x) < 1e-10);
      assert.ok(Math.abs(direction.y + Math.cos(Math.PI / 12)) < 1e-10);
      assert.ok(Math.abs(direction.z + Math.sin(Math.PI / 12)) < 1e-10);
    }
  }
});

void test('a genuine interior hairpin bulge is visible beyond an endpoint-only horizon', () => {
  const pitch = Math.PI / 12;
  const projection = (point: Point): number[] => [
    point.x,
    -point.z * Math.cos(pitch) + point.y * Math.sin(pitch),
  ];
  let largestBulge = 0;
  let selected = poseAt(hairpin, 0);
  for (let distance = 0; distance < hairpin.totalLength; distance += 1) {
    const pose = poseAt(hairpin, distance);
    const endpoints = [
      ...edges(hairpin, distance - 5),
      ...edges(hairpin, distance + 35),
      ...carPoints(hairpin, pose),
    ].map(projection);
    const all = requiredPoints(hairpin, pose).map(projection);
    for (const axis of [0, 1]) {
      const lower = Math.min(...endpoints.map((point) => point[axis] ?? 0));
      const upper = Math.max(...endpoints.map((point) => point[axis] ?? 0));
      const bulge = Math.max(
        lower - Math.min(...all.map((point) => point[axis] ?? 0)),
        Math.max(...all.map((point) => point[axis] ?? 0)) - upper
      );
      if (bulge > largestBulge) {
        largestBulge = bulge;
        selected = pose;
      }
    }
  }
  assert.ok(
    largestBulge > 2,
    `fixture must expose endpoint omission; got ${largestBulge} m`
  );
  for (const view of views) {
    const raceCamera = createRaceCamera(hairpin);
    raceCamera.resize(view);
    raceCamera.update(selected, {
      mode: 'chase',
      deltaSeconds: 0,
      reset: true,
    });
    assertFits(raceCamera.camera, view, requiredPoints(hairpin, selected));
  }
});

void test('real shared hold poses retain the braking horizon while the car slides off road', () => {
  const raceCamera = createRaceCamera(hairpin);
  const view = views[2];
  assert.ok(view);
  raceCamera.resize(view);
  let race = createRacingState(hairpin);
  let offRoadPoses = 0;
  while (race.phase === 'racing' && race.simulation.tick < 6000) {
    race = stepRace(hairpin, race, true);
    const state = race.simulation;
    if (state.tick % 12 !== 0 && race.phase === 'racing') continue;
    const frame = sampleTrack(hairpin, state.distance);
    const vx = frame.tx * state.speed + frame.nx * state.lateralVelocity;
    const vz = frame.tz * state.speed + frame.nz * state.lateralVelocity;
    const pose = {
      distance: state.distance,
      lateralOffset: state.lateralOffset,
      heading: Math.atan2(vx, vz),
    };
    raceCamera.update(pose, { mode: 'chase', deltaSeconds: 0.1 });
    assertFits(raceCamera.camera, view, requiredPoints(hairpin, pose));
    if (state.offRoad) offRoadPoses++;
  }
  assert.equal(race.phase, 'finished');
  assert.ok(offRoadPoses > 0);
});

void test('loop boundaries, negative distances and tiny circuits have bounded complete framing', () => {
  const view = views[0];
  assert.ok(view);
  for (const track of [
    oval,
    createOvalTrack({ radiusX: 5, radiusZ: 5, width: 2 }),
  ]) {
    const raceCamera = createRaceCamera(track);
    raceCamera.resize(view);
    for (const distance of [
      -5,
      -0.1,
      0,
      track.totalLength - 2,
      track.totalLength + 3,
      100 * track.totalLength + 3,
    ]) {
      const pose = poseAt(track, distance, -11.5, Math.PI / 2);
      raceCamera.update(pose, { mode: 'chase', deltaSeconds: 0, reset: true });
      assertFits(raceCamera.camera, view, requiredPoints(track, pose));
    }
    const pose = poseAt(track, 3);
    raceCamera.update(pose, { mode: 'chase', deltaSeconds: 0, reset: true });
    const singleLap = matrices(raceCamera.camera);
    raceCamera.update(
      { ...pose, distance: 3 + track.totalLength * 100 },
      { mode: 'chase', deltaSeconds: 0, reset: true }
    );
    for (const [index, value] of matrices(raceCamera.camera).entries()) {
      assert.ok(Math.abs(value - (singleLap[index] ?? Infinity)) < 1e-8);
    }
  }
});

void test('resize synchronously refits a paused chase pose and copies viewport/pose inputs', () => {
  const first = views[1];
  const landscape = views[2];
  assert.ok(first && landscape);
  const raceCamera = createRaceCamera(hairpin);
  const viewport = { ...first, insets: { ...first.insets } };
  const pose = poseAt(hairpin, 118.25, 12, 0.7);
  const originalPose = { ...pose };
  raceCamera.resize(viewport);
  raceCamera.update(pose, { mode: 'chase', deltaSeconds: 0, reset: true });
  viewport.insets.top = 800;
  pose.distance = 250;
  assert.equal(
    raceCamera.update(originalPose, { mode: 'chase', deltaSeconds: 0 }),
    false
  );
  assert.equal(raceCamera.resize(landscape), true);
  assertFits(
    raceCamera.camera,
    landscape,
    requiredPoints(hairpin, originalPose)
  );
  assert.equal(
    raceCamera.update(originalPose, { mode: 'chase', deltaSeconds: 0 }),
    false
  );
  const results = {
    ...landscape,
    insets: { top: 80, left: 30, right: 30, bottom: 120 },
  };
  assert.equal(raceCamera.resize(results), true);
  assertFits(raceCamera.camera, results, requiredPoints(hairpin, originalPose));
});

void test('zero/exhausted viewports preserve finite matrices, and positive tiny viewports preserve coverage', () => {
  const raceCamera = createRaceCamera(oval);
  const view = views[0];
  assert.ok(view);
  raceCamera.resize(view);
  const before = matrices(raceCamera.camera);
  assert.equal(
    raceCamera.resize({
      width: 0,
      height: 0,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    }),
    true
  );
  assert.equal(raceCamera.renderable, false);
  assert.deepEqual(matrices(raceCamera.camera), before);
  assert.equal(
    raceCamera.resize({
      width: 320,
      height: 200,
      insets: { top: 300, right: 0, bottom: 0, left: 0 },
    }),
    false
  );
  const pose = poseAt(oval, 100, 12);
  assert.equal(
    raceCamera.update(pose, { mode: 'chase', deltaSeconds: 1000, reset: true }),
    false
  );
  for (const size of [0.01, 1, 2]) {
    const tiny = {
      width: size,
      height: size,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    raceCamera.resize(tiny);
    assert.equal(raceCamera.renderable, true);
    assert.ok(matrices(raceCamera.camera).every(Number.isFinite));
    assertFits(raceCamera.camera, tiny, requiredPoints(oval, pose));
  }
  raceCamera.resize(view);
  assertFits(raceCamera.camera, view, requiredPoints(oval, pose));
});

void test('retry reset discards preceding lap history and countdown does not animate a fixed pose', () => {
  const view = views[0];
  assert.ok(view);
  const raceCamera = createRaceCamera(hairpin);
  const fresh = createRaceCamera(hairpin);
  raceCamera.resize(view);
  fresh.resize(view);
  raceCamera.update(poseAt(hairpin, 230, -12, 1), {
    mode: 'chase',
    deltaSeconds: 1 / 60,
  });
  const start = poseAt(hairpin, 0);
  raceCamera.update(start, { mode: 'chase', deltaSeconds: 0, reset: true });
  fresh.update(start, { mode: 'chase', deltaSeconds: 0, reset: true });
  assert.deepEqual(matrices(raceCamera.camera), matrices(fresh.camera));
  for (let frame = 0; frame < 180; frame++) {
    assert.equal(
      raceCamera.update(start, { mode: 'chase', deltaSeconds: 1 / 60 }),
      false
    );
  }
});

void test('safety zoom-out is immediate at zero elapsed time and easing eventually returns unchanged', () => {
  const view = views[1];
  assert.ok(view);
  const raceCamera = createRaceCamera(hairpin);
  raceCamera.resize(view);
  raceCamera.update(poseAt(hairpin, 0), {
    mode: 'chase',
    deltaSeconds: 0,
    reset: true,
  });
  const far = poseAt(hairpin, 190, 30, Math.PI / 2);
  assert.equal(
    raceCamera.update(far, { mode: 'chase', deltaSeconds: 0 }),
    true
  );
  assertFits(raceCamera.camera, view, requiredPoints(hairpin, far));
  let settledAt = 0;
  for (let frame = 1; frame <= 1200; frame++) {
    const changed = raceCamera.update(far, {
      mode: 'chase',
      deltaSeconds: 1 / 60,
    });
    assertFits(raceCamera.camera, view, requiredPoints(hairpin, far));
    if (!changed) {
      settledAt = frame;
      break;
    }
  }
  assert.ok(
    settledAt > 1 && settledAt < 1200,
    `settled after ${settledAt} frames`
  );
  for (let frame = 0; frame < 20; frame++)
    assert.equal(
      raceCamera.update(far, { mode: 'chase', deltaSeconds: 1 / 60 }),
      false
    );
});

void test('large overview adjusts depth as well as the orthographic rectangle', () => {
  const track = createOvalTrack({ radiusX: 1000, radiusZ: 1000 });
  const raceCamera = createRaceCamera(track);
  const view = views[2];
  assert.ok(view);
  raceCamera.resize(view);
  assertFits(
    raceCamera.camera,
    view,
    requiredPoints(track, poseAt(track, 0), 'overview')
  );
});

void test('invalid inputs leave camera matrices untouched and canonical data is never mutated', () => {
  const track = createOvalTrack();
  const beforeTrack = JSON.stringify(track);
  for (const sample of track.samples) Object.freeze(sample);
  Object.freeze(track.samples);
  Object.freeze(track);
  const raceCamera = createRaceCamera(track);
  const view = views[0];
  assert.ok(view);
  raceCamera.resize(view);
  const before = matrices(raceCamera.camera);
  for (const bad of [NaN, Infinity, -1]) {
    assert.throws(() => raceCamera.resize({ ...view, width: bad }));
    assert.throws(() =>
      raceCamera.resize({ ...view, insets: { ...view.insets, top: bad } })
    );
    assert.throws(() =>
      raceCamera.update(poseAt(track, 10), { mode: 'chase', deltaSeconds: bad })
    );
  }
  assert.throws(() =>
    raceCamera.update(
      { ...poseAt(track, 10), heading: NaN },
      { mode: 'chase', deltaSeconds: 0 }
    )
  );
  assert.throws(() =>
    raceCamera.update(
      { ...poseAt(track, 10), lateralOffset: Infinity },
      { mode: 'chase', deltaSeconds: 0 }
    )
  );
  assert.deepEqual(matrices(raceCamera.camera), before);
  assert.equal(JSON.stringify(track), beforeTrack);
});
