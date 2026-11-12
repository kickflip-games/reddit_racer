import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSimulationState,
  HANDLING,
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
  stepSimulation,
} from './simulation.ts';
import {
  EXPECTED_HOLD_STATE,
  EXPECTED_LIFT_STATE,
  HOLD_REPLAY,
  LIFT_REPLAY,
} from './fixtures/reference-replays.ts';
import { runReplay } from './replay.ts';
import { createOvalTrack } from './track-authoring.ts';

void test('one Boolean produces gradual acceleration and braking at a fixed tick', () => {
  const track = createOvalTrack();
  const initial = createSimulationState();
  const snapshot = { ...initial };
  const accelerating = stepSimulation(track, initial, true);
  assert.equal(accelerating.tick, 1);
  assert.ok(
    accelerating.speed > 0 && accelerating.speed < HANDLING.acceleration / 60
  );
  let moving = accelerating;
  for (let tick = 0; tick < SIMULATION_HZ; tick++)
    moving = stepSimulation(track, moving, true);
  const braking = stepSimulation(track, moving, false);
  assert.ok(braking.speed > 0 && braking.speed < moving.speed);
  assert.ok(braking.distance > moving.distance);
  assert.deepEqual(initial, snapshot, 'updates do not mutate prior frames');
  assert.deepEqual(
    createSimulationState(),
    snapshot,
    'retries have independent initial state'
  );
});

void test('released car rests at the start and never acquires free progress', () => {
  const track = createOvalTrack();
  let state = createSimulationState();
  for (let tick = 0; tick < 240; tick++)
    state = stepSimulation(track, state, false);
  assert.equal(state.tick, 240);
  assert.equal(state.speed, 0);
  assert.equal(state.distance, 0);
  assert.equal(state.lateralOffset, 0);
  assert.equal(state.status, 'running');
});

void test('excess corner traction creates outward slip without a magic speed clamp', () => {
  const track = createOvalTrack();
  const state = { ...createSimulationState(), speed: 22 };
  const next = stepSimulation(track, state, true);
  assert.ok(next.slip > 0);
  assert.ok(
    next.lateralOffset > 0,
    'reference negative-curvature corner slides toward positive normal'
  );
  assert.ok(next.lateralVelocity > 0);
  assert.ok(
    next.speed > 21,
    'grip loss does not instantly clamp to the corner safe speed'
  );
  const wideTrack = createOvalTrack({ width: 9 });
  const edgeState = {
    ...createSimulationState(),
    speed: 10,
    lateralOffset: 3.6,
  };
  const narrow = stepSimulation(track, edgeState, true);
  const wide = stepSimulation(wideTrack, edgeState, true);
  assert.equal(narrow.offRoad, true);
  assert.equal(wide.offRoad, false);
  assert.ok(
    narrow.speed < wide.speed,
    'canonical width controls physical off-road drag'
  );
});

void test('frozen single-lift replay beats hold-only and reproduces exact versioned states', () => {
  const track = createOvalTrack();
  const hold = runReplay(track, HOLD_REPLAY);
  const lift = runReplay(track, LIFT_REPLAY);
  assert.deepEqual(hold.state, EXPECTED_HOLD_STATE);
  assert.deepEqual(lift.state, EXPECTED_LIFT_STATE);
  assert.ok(
    lift.finishTicks < hold.finishTicks - SIMULATION_HZ,
    'one deliberate lift saves more than one second'
  );
  let state = createSimulationState();
  let outsideTicks = 0;
  while (state.status === 'running') {
    state = stepSimulation(track, state, true);
    if (state.offRoad) outsideTicks++;
  }
  assert.ok(
    outsideTicks > 0,
    'off-road is recoverable and does not end the attempt'
  );
  assert.equal(state.finishedTick, hold.finishTicks);
  assert.equal(
    stepSimulation(track, state, false),
    state,
    'finished races are terminal'
  );
});

void test('automatic recovery costs explicit ticks, returns safely and never advances along the course', () => {
  const track = createOvalTrack();
  const initial = {
    ...createSimulationState(),
    distance: 40,
    speed: 4,
    lateralOffset: 13,
  };
  let state = stepSimulation(track, initial, true);
  assert.equal(state.recovering, true);
  assert.equal(state.recoveryCount, 1);
  assert.equal(state.distance, initial.distance);
  while (state.recovering) {
    const priorDistance = state.distance;
    state = stepSimulation(track, state, true);
    assert.equal(state.distance, priorDistance);
  }
  assert.equal(state.tick, HANDLING.recoveryTicks);
  assert.equal(state.lateralOffset, 0);
  assert.equal(state.lateralVelocity, 0);
  assert.equal(state.speed, 0);
  assert.equal(state.offRoad, false);
  const resumed = stepSimulation(track, state, true);
  assert.ok(resumed.distance > state.distance);
  assert.equal(resumed.recoveryCount, 1);
});

void test('simulation work is bounded independently of render duration', () => {
  const track = createOvalTrack();
  assert.throws(
    () =>
      stepSimulation(
        track,
        { ...createSimulationState(), tick: MAX_SIMULATION_TICKS },
        true
      ),
    /duration limit/
  );
});
