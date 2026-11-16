import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateBrakeRhythmCandidate } from '../../src/shared/brake-rhythm-generator';
import {
  createSimulationState,
  stepSimulation,
  type SimulationState,
} from '../../src/shared/simulation';
import { sampleTrack } from '../../src/shared/track';
import { runtimeForTrack } from '../../src/shared/scored-runtime';
const track = generateBrakeRhythmCandidate('contact-ridge').track;
const distance = track.totalLength * 0.55;
const road = sampleTrack(track, distance);
function offDeck(): SimulationState {
  return {
    ...createSimulationState(track),
    distance,
    lateralOffset: road.halfWidth + 0.4,
    vertical: {
      height: road.y ?? 0,
      velocity: 0,
      airborne: false,
      landings: 0,
      impact: 0,
    },
  };
}
test('a car outside a raised road falls to visible grass instead of riding an invisible deck', () => {
  let state = offDeck();
  state = stepSimulation(track, state, false);
  assert.equal(state.vertical?.airborne, true);
  assert.ok((state.vertical?.height ?? 0) < (road.y ?? 0));
  for (let i = 0; i < 240; i++) state = stepSimulation(track, state, false);
  assert.equal(state.vertical?.height, 0);
  assert.equal(state.vertical?.velocity, 0);
  assert.equal(state.vertical?.airborne, false);
  assert.equal(state.recoveryCount, 0);
  assert.equal(state.vertical?.landings, 1);
});
test('returning below the deck recovers gradually without an upward teleport or fake landing', () => {
  let state = offDeck();
  state = {
    ...state,
    speed: 12,
    lateralOffset: road.halfWidth + 0.001,
    lateralVelocity: -2,
    vertical: {
      height: 0,
      velocity: 0,
      airborne: false,
      landings: 0,
      impact: 0,
    },
  };
  state = stepSimulation(track, state, false);
  assert.equal(state.recovering, true);
  assert.equal(state.vertical?.height, 0);
  const next = stepSimulation(track, state, false);
  assert.ok(
    (next.vertical?.height ?? 0) > 0 && (next.vertical?.height ?? 0) < 0.1
  );
  assert.equal(next.vertical?.landings, 0);
});
test('new courses have higher ridges, flat seams and explicitly versioned contact physics', () => {
  assert.equal(runtimeForTrack(track).simulationVersion, 'fixed-step-v6');
  assert.ok(Math.max(...track.samples.map((s) => s.y ?? 0)) > 7.3);
  assert.ok(
    Math.max(...track.samples.map((s) => Math.abs(s.grade ?? 0))) < 0.5
  );
  for (const s of [0, track.totalLength])
    assert.equal(sampleTrack(track, s).y, 0);
  const old = { ...track, generatorVersion: 'other-tracks-v2' };
  assert.equal(runtimeForTrack(old).simulationVersion, 'fixed-step-v5');
});
