import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drivingCue } from '../../src/client/driving-cue.ts';
import { createSimulationState } from '../../src/shared/simulation.ts';
const state = { ...createSimulationState(), speed: 15 };
test('quiet feedback explains braking and traction without adding an acceleration HUD', () => {
  assert.equal(drivingCue(state, true, true, false), '');
  assert.equal(drivingCue(state, false, true, false), 'Braking');
  assert.equal(
    drivingCue({ ...state, slip: 0.6 }, true, true, false),
    'Sliding'
  );
  assert.equal(
    drivingCue({ ...state, offRoad: true }, true, true, false),
    'Grass slows you'
  );
  assert.equal(drivingCue(state, false, false, false), '');
  assert.equal(drivingCue(state, false, true, true), '');
  assert.equal(drivingCue({ ...state, speed: 0 }, false, true, false), '');
});
