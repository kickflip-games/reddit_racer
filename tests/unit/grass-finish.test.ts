import {
  stepPracticeDrift,
  createPracticeDriver,
} from '../../src/client/practice-driver';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateLinkedCourseCandidate } from '../../src/shared/linked-course-generator';
import {
  createSimulationState,
  stepSimulation,
} from '../../src/shared/simulation';
import { sampleTrack } from '../../src/shared/track';
import {
  runtimeForTrack,
  scoredRuntime,
} from '../../src/shared/scored-runtime';
import { qualityVersionForTrack } from '../../src/shared/circuit-quality';
import { stepElevatedSimulationV7 } from '../../src/shared/elevated-simulation-v7';

function fixture() {
  const track = generateLinkedCourseCandidate(
    'grass-regression',
    1,
    'linked-circuits-v5'
  ).track;
  assert.ok(track);
  return { ...track, generatorVersion: 'linked-circuits-v2' };
}
const track = fixture();
function crossing(offset: number) {
  const s = createSimulationState(track);
  return {
    ...s,
    distance: track.totalLength - 0.03,
    speed: 20,
    lateralOffset: offset,
  };
}
test('regression: old grass finish is preserved for historical replay, new finish requires road', () => {
  const off = sampleTrack(track, 0).halfWidth + 0.6;
  const state = crossing(off);
  const old = { ...track, generatorVersion: 'linked-circuits-v1' };
  assert.equal(stepSimulation(old, state, true).status, 'finished');
  const fixed = stepSimulation(track, state, true);
  assert.equal(fixed.status, 'running');
  assert.equal(fixed.finishedTick, null);
  assert.ok(fixed.distance < track.totalLength);
  assert.equal(fixed.offRoad, true);
  // Reentry must not leave a player stranded beyond an already missed finish.
  const returned = stepSimulation(
    track,
    { ...fixed, lateralOffset: 0, lateralVelocity: 0 },
    true
  );
  assert.equal(returned.status, 'finished');
  assert.ok(returned.tick > fixed.tick);
});
test('clean finish and small shoulder mistakes are not invalidated for the rest of a lap', () => {
  assert.equal(stepSimulation(track, crossing(0), true).status, 'finished');
  let state = {
    ...crossing(sampleTrack(track, 0).halfWidth + 0.1),
    distance: 20,
  };
  state = stepSimulation(track, state, true);
  assert.equal(state.recovering, false);
  assert.equal(
    stepSimulation(
      track,
      { ...state, distance: track.totalLength - 0.03, lateralOffset: 0 },
      true
    ).status,
    'finished'
  );
});
test('full grass loses speed even at held throttle; practice drift cannot bypass road finish', () => {
  const off = sampleTrack(track, 0).halfWidth + 1.5;
  const state = crossing(off);
  const fixed = stepSimulation(track, state, true);
  assert.ok(fixed.speed < state.speed);
  assert.equal(
    stepElevatedSimulationV7(track, state, true, 0.2).status,
    'running'
  );
});
test('new runtime and quality identities do not reinterpret frozen linked-v1 tracks', () => {
  assert.equal(runtimeForTrack(track).simulationVersion, 'fixed-step-v7');
  assert.equal(
    scoredRuntime('fixed-step-v7', 'road-finish-v1').simulationVersion,
    'fixed-step-v7'
  );
  const old = { ...track, generatorVersion: 'linked-circuits-v1' };
  assert.equal(runtimeForTrack(old).simulationVersion, 'fixed-step-v6');
  assert.equal(qualityVersionForTrack(old), 'linked-quality-v1');
  assert.equal(qualityVersionForTrack(track), 'linked-quality-v2');
});

test('practice drift selects v7 road finish while frozen v6 remains unchanged', () => {
  const state = crossing(sampleTrack(track, 0).halfWidth + 0.6);
  const old = { ...track, generatorVersion: 'linked-circuits-v1' };
  assert.equal(stepPracticeDrift(old, state, true, 0.2).status, 'finished');
  const fixed = stepPracticeDrift(track, state, true, 0.2);
  assert.equal(fixed.status, 'running');
  assert.deepEqual(fixed, stepElevatedSimulationV7(track, state, true, 0.2));
  assert.equal(
    stepPracticeDrift(track, crossing(0), true, 0.2).status,
    'finished'
  );
});
test('v7 practice drift is deterministic across rendering schedules', () => {
  const a = createPracticeDriver(track),
    b = createPracticeDriver(track);
  for (const driver of [a, b]) {
    driver.start(0);
    driver.setInput(true, 0);
    driver.setDrift(true, 0);
  }
  for (let t = 10; t <= 10000; t += 10) a.advance(t);
  for (let t = 20; t <= 10000; t += 20) b.advance(t);
  assert.equal(a.interrupted, false);
  assert.deepEqual(a.state, b.state);
});
