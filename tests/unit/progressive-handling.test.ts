import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import {
  createSimulationState,
  stepSimulation,
} from '../../src/shared/simulation.ts';
import { type Track } from '../../src/shared/track.ts';

const base = createOvalTrack({ radiusX: 30, radiusZ: 30 });
const track: Track = {
  ...base,
  schemaVersion: 2,
  generatorVersion: 'countryside-circuits-v2',
  samples: base.samples.map((p) => ({
    ...p,
    y: 0,
    grade: 0,
    verticalCurvature: 0,
  })),
};
const initial = (speed: number) => ({ ...createSimulationState(track), speed });

test('mild overspeed gives a visible drift warning without a speed cut or throttle lockout', () => {
  let state = initial(19);
  for (let i = 0; i < 60; i++) {
    const next = stepSimulation(track, state, true);
    assert.ok(next.speed >= state.speed, 'no punitive step in speed');
    assert.equal(next.cornerPenaltyTicks, 0);
    assert.equal(next.recovering, false);
    state = next;
  }
  assert.ok(Math.abs(state.lateralOffset) > 0.05);
  assert.ok(state.slip > 0);
  assert.equal(state.offRoad, false);
});
test('lifting early limits outward travel and grass bleeds speed progressively', () => {
  let held = initial(24),
    lifted = initial(24);
  for (let i = 0; i < 120; i++) {
    held = stepSimulation(track, held, true);
    lifted = stepSimulation(track, lifted, false);
  }
  assert.ok(Math.abs(lifted.lateralOffset) < Math.abs(held.lateralOffset));
  assert.ok(lifted.speed < held.speed);
  const start = { ...initial(20), lateralOffset: 5.5 };
  const grass = stepSimulation(track, start, true);
  const road = stepSimulation(track, initial(20), true);
  assert.ok(grass.speed < road.speed);
  assert.ok(grass.speed > 19.7, 'grass slows gradually, never snaps to a stop');
  assert.equal(grass.recovering, false);
});
test('parked cars do not drift, extreme departures retain bounded recovery', () => {
  const parked = { ...initial(0), lateralOffset: 2 };
  const still = stepSimulation(track, parked, false);
  assert.equal(still.lateralOffset, 2);
  assert.equal(still.distance, 0);
  let state = stepSimulation(
    track,
    { ...initial(20), lateralOffset: 20 },
    true
  );
  assert.equal(state.recovering, true);
  for (let i = 0; i < 119; i++) state = stepSimulation(track, state, true);
  assert.equal(state.recovering, false);
  assert.equal(state.lateralOffset, 0);
});
