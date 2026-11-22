import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateCurrentDailyCircuit,
  assessBrakingTrack,
} from '../../src/shared/braking-course-generator';
import { courseFamilyForSeed } from '../../src/shared/course-families';
import {
  sampleTrack,
  validateTrack,
  serializeTrack,
} from '../../src/shared/track';
import {
  type SimulationState,
  createSimulationState,
  stepSimulation,
} from '../../src/shared/simulation';
import { runReplay } from '../../src/shared/replay';
import { playableJumpFlight } from '../../src/shared/jump-flight';
import { FLIGHT_GRAVITY } from '../../src/shared/scored-runtime';

const jumpCourse = generateCurrentDailyCircuit('daily:t5_kyc33w:2026-11-25');
void test('each declared gap clears its physical landing lip in both fast and cautious driving', () => {
  const { track, quality } = jumpCourse;
  assert.equal(track.jumps?.length, 1);
  assert(quality.metrics && quality.fastReplay);
  for (const run of [quality.metrics.fast, quality.metrics.cautious]) {
    assert.equal(run.jumpFlights?.length, track.jumps.length);
    for (const f of run.jumpFlights ?? []) {
      assert(playableJumpFlight(f));
      assert((f.landingEdgeClearance ?? 0) > 1);
      assert((f.peakClearance ?? 0) > 2);
      assert((f.landedS ?? Infinity) < 105);
    }
  }
  assert.equal(
    runReplay(track, quality.fastReplay).finishTicks,
    quality.metrics.fast.finishTicks
  );
});
void test('deliberately missed gap recovers beyond the gap and can continue without corrupt progress', () => {
  const track = jumpCourse.track,
    j = track.jumps?.[0];
  assert(j);
  const s = j.takeoff - 0.01,
    frame = sampleTrack(track, s);
  let state: SimulationState = {
    ...createSimulationState(track),
    distance: s,
    speed: 1,
    vertical: {
      height: frame.y ?? 0,
      velocity: frame.grade ?? 0,
      airborne: false,
      landings: 0,
      impact: 0,
    },
  };
  for (let i = 0; i < 800 && !state.recovering; i++)
    state = stepSimulation(track, state, false);
  assert.equal(state.recoveryCount, 1);
  assert.equal(state.distance, j.landing);
  assert.equal(state.vertical?.airborne, false);
  const stop = state.tick + 4000;
  while (state.tick < stop && state.distance < j.rampEnd + 35)
    state = stepSimulation(track, state, true);
  assert(state.distance > j.rampEnd + 30);
  assert.equal(state.recovering, false);
  assert.equal(state.recoveryCount, 1);
});
void test('steep ridge has readable loopbacks, two hills and ordinary crests stay grounded at maximum speed', () => {
  const seed = 'daily:t5_kyc33w:2026-11-23',
    r = generateCurrentDailyCircuit(seed);
  assert.equal(courseFamilyForSeed(seed), 'ridge');
  assert(r.quality.metrics);
  assert.equal(r.track.jumps?.length, 0);
  assert.equal(r.quality.metrics.fast.airborneTicks, 0);
  assert.equal(r.quality.metrics.cautious.airborneTicks, 0);
  assert(Math.max(...r.track.samples.map((p) => p.y ?? 0)) > 17);
  assert(
    Math.max(...r.track.samples.map((p) => Math.abs(p.grade ?? 0))) > 0.18
  );
  assert(
    r.track.samples.every(
      (p) => (p.verticalCurvature ?? 0) * 30 * 30 >= -FLIGHT_GRAVITY
    )
  );
  assert(r.quality.structure.metrics.minClearance >= 2);
  assert.doesNotThrow(() => validateTrack(r.track));
  const flat = {
    ...r.track,
    samples: r.track.samples.map((p) => ({
      ...p,
      y: 0,
      grade: 0,
      verticalCurvature: 0,
    })),
  };
  assert(assessBrakingTrack(flat).codes.includes('missing-elevation'));
  const old = { ...r.track, generatorVersion: 'linked-circuits-v5' };
  assert.throws(() => validateTrack(old), /safe bounds/);
  assert.equal(
    serializeTrack(r.track),
    serializeTrack(generateCurrentDailyCircuit(seed).track)
  );
});
