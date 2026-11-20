import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceLapProgress,
  createRacingState,
  stepRace,
  type RaceState,
} from '../../src/shared/race-rules';
import {
  stepSimulation,
  type SimulationState,
} from '../../src/shared/simulation';
import type { Track } from '../../src/shared/track';

const radius = 65;
const sampleCount = 128;
const segmentLength = 2 * radius * Math.sin(Math.PI / sampleCount);

const track: Track = {
  schemaVersion: 2,
  generatorVersion: 'linked-circuits-v2',
  seed: 'road-finish-regression',
  totalLength: sampleCount * segmentLength,
  startS: 0,
  samples: Array.from({ length: sampleCount }, (_, index) => {
    const angle = (2 * Math.PI * index) / sampleCount;
    return {
      x: radius * Math.cos(angle),
      z: radius * Math.sin(angle),
      s: index * segmentLength,
      tx: -Math.sin(angle),
      tz: Math.cos(angle),
      curvature: 1 / radius,
      width: 10,
      y: 0,
      grade: 0,
      verticalCurvature: 0,
    };
  }),
  checkpoints: [24, 64, 96].map((index) => ({
    id: `gate-${index}`,
    s: index * segmentLength,
  })),
};

function approachFinish(
  course: Track,
  state: Partial<SimulationState> = {}
): RaceState {
  const race = createRacingState(course);
  return {
    ...race,
    nextCheckpointIndex: course.checkpoints.length,
    checkpointTicks: [100, 200, 300],
    simulation: {
      ...race.simulation,
      tick: 480,
      distance: course.totalLength - 0.03,
      speed: 20,
      ...state,
    },
  };
}

const shoulder = { lateralOffset: 5.6, lateralVelocity: -4 };
const airborne = {
  vertical: {
    height: 0.08,
    velocity: -2,
    airborne: true,
    landings: 0,
    impact: 0,
  },
};

for (const version of [2, 3, 4, 5]) {
  const course = { ...track, generatorVersion: `linked-circuits-v${version}` };
  for (const [condition, state] of [
    ['off-road', shoulder],
    ['airborne', airborne],
  ] as const) {
    void test(`linked v${version} ${condition} race can finish`, () => {
      const before = approachFinish(course, state);
      let race = stepRace(course, before, true);

      assert.equal(race.phase, 'racing', race.abandonReason ?? undefined);
      assert.equal(race.simulation.distance, course.totalLength - 0.000001);
      assert.equal(race.simulation.finishedTick, null);

      for (let tick = 0; tick < 180 && race.phase === 'racing'; tick++) {
        race = stepRace(course, race, true);
      }

      assert.equal(race.phase, 'finished', race.abandonReason ?? undefined);
      assert.equal(race.simulation.distance, course.totalLength);
      assert.ok(race.simulation.finishedTick !== null);
      assert.ok(race.simulation.finishedTick > before.simulation.tick + 1);
      assert.deepEqual(race.checkpointTicks, before.checkpointTicks);
    });
  }
}

void test('clean and legacy shoulder finishes are unchanged', () => {
  const legacy = { ...track, generatorVersion: 'linked-circuits-v1' };
  const oldFinish = stepRace(legacy, approachFinish(legacy, shoulder), true);
  assert.equal(oldFinish.phase, 'finished');
  assert.equal(oldFinish.simulation.finishedTick, 481);

  const clean = stepRace(track, approachFinish(track), true);
  assert.equal(clean.phase, 'finished');
  assert.equal(clean.simulation.finishedTick, 481);
});

void test('arbitrary stalls and on-road finish caps remain invalid', () => {
  const before = approachFinish(track, shoulder);
  const capped = stepSimulation(track, before.simulation, true);
  assert.throws(
    () =>
      advanceLapProgress(track, before, before.simulation, {
        ...capped,
        distance: capped.distance - 0.005,
      }),
    /authoritative forward movement/
  );
  const onRoad = approachFinish(track);
  const clean = stepSimulation(track, onRoad.simulation, true);
  assert.throws(
    () =>
      advanceLapProgress(track, onRoad, onRoad.simulation, {
        ...clean,
        distance: capped.distance,
        finishedTick: null,
        status: 'running',
      }),
    /authoritative forward movement/
  );
});
