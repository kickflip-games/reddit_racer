import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOvalTrack } from './track-authoring.ts';
import { sampleTrack, serializeTrack, type Track } from './track.ts';
import {
  createSimulationState,
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
  type SimulationState,
} from './simulation.ts';
import {
  gripSurfaceAt,
  SLOT_GRIP,
  slotGripTelemetry,
  slotBrakingMarkers,
  stepSlotSimulation,
  validateGripZones,
  type GripZone,
} from './slot-grip.ts';
import { generateCircuit } from './circuit-generator.ts';
import { createStuntCourse } from './stunt-course.ts';
import { createFlight, stepStuntSimulation } from './stunt-simulation.ts';

const circle = createOvalTrack({ radiusX: 30, radiusZ: 30 });
function updates(
  state: SimulationState,
  held: boolean,
  ticks: number
): SimulationState {
  for (let i = 0; i < ticks; i++)
    state = stepSlotSimulation(circle, state, held);
  return state;
}

void test('longitudinal effort and cornering share a bounded traction circle', () => {
  const state = { ...createSimulationState(), speed: 16 };
  const gas = slotGripTelemetry(circle, state, true),
    lift = slotGripTelemetry(circle, state, false);
  for (const grip of [gas, lift])
    assert.ok(
      Math.abs(
        Math.hypot(grip.lateralBudget, grip.longitudinalDemand) -
          SLOT_GRIP.totalGrip
      ) < 1e-9
    );
  assert.ok(lift.lateralBudget > gas.lateralBudget);
  assert.ok(lift.longitudinalDemand > 0, 'release braking still consumes grip');
  assert.ok(lift.usage < gas.usage);
});

void test('slow driving hugs the inside; release tightens the line; overspeed runs wide', () => {
  const state = { ...createSimulationState(), speed: 16 };
  const gas = updates(state, true, 60),
    lift = updates(state, false, 60);
  assert.ok(sampleTrack(circle, 0).curvature < 0);
  assert.ok(
    gas.lateralOffset > 0,
    'gas pushes out of the negative-curvature bend'
  );
  assert.ok(lift.lateralOffset < 0, 'lifting bites toward its inside');
  assert.ok(lift.speed < gas.speed);
  const slow = updates({ ...state, speed: 6 }, true, 60);
  assert.ok(slow.lateralOffset < 0);
  assert.equal(slow.offRoad, false);
});

void test('inside distance is genuinely shorter and parked cars do not gain free progress', () => {
  const state = { ...createSimulationState(), speed: 5 };
  const inner = stepSlotSimulation(
    circle,
    { ...state, lateralOffset: -2 },
    true
  );
  const outer = stepSlotSimulation(
    circle,
    { ...state, lateralOffset: 2 },
    true
  );
  assert.equal(inner.speed, outer.speed);
  assert.ok(inner.distance > outer.distance);
  assert.deepEqual(updates(createSimulationState(), false, 120), {
    ...createSimulationState(),
    tick: 120,
  });
});

void test('scrub warns while still on the road; overspeed has bounded recovery', () => {
  const warning = stepSlotSimulation(
    circle,
    { ...createSimulationState(), speed: 14 },
    true
  );
  assert.ok(warning.slip > 0.2);
  assert.equal(warning.offRoad, false);
  let state = updates({ ...createSimulationState(), speed: 22 }, true, 120);
  assert.ok(state.lateralOffset > 1);
  for (let i = 0; i < 600 && !state.recovering; i++)
    state = stepSlotSimulation(circle, state, true);
  assert.ok(state.recovering);
  const recoveryS = state.distance;
  for (let i = 0; i < 119; i++) {
    state = stepSlotSimulation(circle, state, true);
    assert.equal(state.distance, recoveryS);
  }
  assert.equal(state.recovering, false);
  assert.equal(state.lateralOffset, 0);
});

void test('wet and dust reduce grip; signed camber helps the matching turn', () => {
  const state = { ...createSimulationState(), distance: 20, speed: 12 };
  const telemetry = (surface: GripZone['surface'], bank = 0) =>
    slotGripTelemetry(circle, state, false, [
      { startS: 5, endS: 50, surface, bank },
    ]);
  assert.ok(telemetry('wet').lateralBudget < telemetry('dry').lateralBudget);
  assert.ok(telemetry('dust').lateralBudget < telemetry('wet').lateralBudget);
  assert.ok(telemetry('dry', -0.15).usage < telemetry('dry').usage);
  assert.ok(telemetry('dry', 0.15).usage > telemetry('dry').usage);
  assert.equal(
    gripSurfaceAt(
      circle,
      [{ startS: 5, endS: 50, surface: 'wet', bank: 0.15 }],
      5
    ).coefficient,
    1
  );
  assert.throws(() =>
    validateGripZones(circle, [
      { startS: 0, endS: Infinity, surface: 'wet', bank: 0 },
    ])
  );
  assert.throws(() =>
    validateGripZones(circle, [
      { startS: 0, endS: 20, surface: 'wet', bank: 0 },
      { startS: 10, endS: 30, surface: 'dry', bank: 0 },
    ])
  );
});

export function gripController(
  track: Track,
  state: SimulationState,
  zones: readonly GripZone[] = []
): boolean {
  let safe = 22;
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const s = state.distance + Math.max(8, state.speed * 1.3) * fraction;
    const budget = slotGripTelemetry(
      track,
      { ...state, distance: s },
      false,
      zones
    ).lateralBudget;
    safe = Math.min(
      safe,
      Math.sqrt(
        (budget * 0.8) /
          Math.max(0.001, Math.abs(sampleTrack(track, s).curvature))
      )
    );
  }
  return state.speed < safe;
}
function drive(
  track: Track,
  controlled: boolean,
  zones: readonly GripZone[] = []
) {
  let state = createSimulationState();
  let offRoad = 0;
  while (state.status === 'running' && state.tick < MAX_SIMULATION_TICKS) {
    state = stepSlotSimulation(
      track,
      state,
      !controlled || gripController(track, state, zones),
      zones
    );
    if (state.offRoad) offRoad++;
  }
  return { state, offRoad };
}

void test('twenty deterministic circuits finish with controls and hold; braking avoids derailment', () => {
  const snapshot = serializeTrack(circle);
  let faster = 0;
  for (let i = 0; i < 20; i++) {
    const track = generateCircuit(`regression-${i}`).track;
    const held = drive(track, false),
      controlled = drive(track, true);
    assert.equal(held.state.status, 'finished');
    assert.equal(controlled.state.status, 'finished');
    assert.equal(controlled.state.recoveryCount, 0);
    assert.equal(controlled.offRoad, 0);
    if (controlled.state.tick < held.state.tick) faster++;
    if (i === 0) assert.deepEqual(drive(track, true), controlled);
  }
  assert.ok(
    faster >= 15,
    `${faster}/20 cautious controls beat hold; this is not an optimal controller`
  );
  assert.equal(serializeTrack(circle), snapshot);
  assert.ok(
    drive(circle, true).state.tick <
      drive(circle, false).state.tick - SIMULATION_HZ
  );
});

void test('banked and wet stunt layouts still support complete airborne laps', () => {
  const results = [];
  for (const mirrored of [false, true]) {
    const { track, jumps, gripZones } = createStuntCourse(mirrored);
    let state = createSimulationState(),
      flight = createFlight(),
      airborneTicks = 0;
    while (state.status === 'running' && state.tick < MAX_SIMULATION_TICKS) {
      const result = stepStuntSimulation(
        track,
        jumps,
        state,
        flight,
        gripController(track, state, gripZones),
        (track, state, held) =>
          stepSlotSimulation(track, state, held, gripZones)
      );
      state = result.simulation;
      flight = result.flight;
      if (flight.airborne) airborneTicks++;
    }
    assert.equal(state.status, 'finished');
    assert.equal(state.recoveryCount, 0);
    assert.ok(airborneTicks > 30);
    results.push(state.tick);
  }
  assert.equal(results[0], results[1]);
});

void test('braking cues are deterministic, bounded and precede actual corners', () => {
  const track = generateCircuit('regression-0').track;
  const markers = slotBrakingMarkers(track);
  assert.deepEqual(slotBrakingMarkers(track), markers);
  assert.ok(markers.length > 1 && markers.length <= 10);
  for (const marker of markers) {
    const approach =
      (marker.cornerS - marker.s + track.totalLength) % track.totalLength;
    assert.ok(approach >= 5 && approach < 60);
    assert.ok(Math.abs(sampleTrack(track, marker.cornerS).curvature) > 0.025);
  }
});
