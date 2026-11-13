import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStuntCourse, jumpRoadHeight } from './stunt-course.ts';
import { createFlight, stepStuntSimulation } from './stunt-simulation.ts';
import { createSimulationState, SIMULATION_HZ } from './simulation.ts';
import { validateTrack, sampleTrack } from './track.ts';

void test('authored sections close cleanly, mirror and keep the road clear', () => {
  const normal = createStuntCourse();
  const mirror = createStuntCourse(true);
  validateTrack(normal.track);
  validateTrack(mirror.track);
  assert.deepEqual(createStuntCourse(), normal);
  assert.equal(normal.track.totalLength, mirror.track.totalLength);
  for (const sample of normal.track.samples) {
    const reflected = sampleTrack(mirror.track, sample.s);
    assert.ok(Math.abs(sample.x - reflected.x) < 0.001);
    assert.ok(Math.abs(sample.z + reflected.z) < 0.001);
    // Exclude neighbours along the curve; catch intersections/overlapping roads.
    for (const other of normal.track.samples.filter((_, i) => i % 8 === 0)) {
      const separation = Math.abs(other.s - sample.s);
      if (Math.min(separation, normal.track.totalLength - separation) > 20)
        assert.ok(Math.hypot(other.x - sample.x, other.z - sample.z) > 8.6);
    }
  }
  assert.equal(jumpRoadHeight(normal.jumps, 32), 0);
  assert.equal(jumpRoadHeight(normal.jumps, 42), 2);
  assert.equal(jumpRoadHeight(normal.jumps, 64), 0);
});

void test('fast launch clears gap ballistically, releasing in flight does not brake', () => {
  const { track, jumps } = createStuntCourse();
  let state = { ...createSimulationState(), distance: 41.95, speed: 19 };
  let flight = { ...createFlight(), height: 1.99 };
  let airborneTicks = 0;
  for (let i = 0; i < 2 * SIMULATION_HZ; i++) {
    const result = stepStuntSimulation(
      track,
      jumps,
      state,
      flight,
      flight.airborne ? false : true
    );
    if (flight.airborne && result.flight.airborne)
      assert.equal(result.simulation.speed, state.speed);
    state = result.simulation;
    flight = result.flight;
    if (flight.airborne) airborneTicks++;
    else if (airborneTicks) break;
  }
  assert.ok(airborneTicks > 30);
  assert.ok(state.distance >= 52);
  assert.equal(state.recoveryCount, 0);
  assert.equal(flight.airborne, false);
});

void test('slow launch misses and rescues to landing with a stationary penalty', () => {
  const { track, jumps } = createStuntCourse();
  let state = { ...createSimulationState(), distance: 41.99, speed: 3 };
  let flight = { ...createFlight(), height: 2 };
  for (let i = 0; i < 2 * SIMULATION_HZ && !state.recovering; i++) {
    const result = stepStuntSimulation(track, jumps, state, flight, true);
    state = result.simulation;
    flight = result.flight;
  }
  assert.equal(state.recoveryCount, 1);
  assert.equal(state.distance, 52);
  assert.equal(state.speed, 0);
  const result = stepStuntSimulation(track, jumps, state, flight, true);
  assert.equal(result.simulation.distance, 52);
  assert.equal(result.simulation.recoveryTicksRemaining, SIMULATION_HZ - 1);
});

void test('both stunt layouts complete a full held lap within the simulation limit', () => {
  for (const mirror of [false, true]) {
    const { track, jumps } = createStuntCourse(mirror);
    let state = createSimulationState();
    let flight = createFlight();
    while (state.status !== 'finished' && state.tick < 120 * SIMULATION_HZ) {
      const next = stepStuntSimulation(track, jumps, state, flight, true);
      state = next.simulation;
      flight = next.flight;
    }
    assert.equal(state.status, 'finished');
    assert.equal(flight.airborne, false);
  }
});
