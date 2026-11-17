import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDriftSparks,
  driftStage,
} from '../../src/client/drift-feedback.ts';
import { createSimulationState } from '../../src/shared/simulation.ts';
import type { DrivingVfxFrame } from '../../src/client/driving-vfx.ts';

test('drift presentation follows the 0.65 second physics heat threshold', () => {
  for (const value of [undefined, 0, -1, NaN, Infinity])
    assert.equal(driftStage(value), 'off');
  assert.equal(driftStage(0.1), 'drift');
  assert.equal(driftStage(0.65), 'drift');
  assert.equal(driftStage(0.66), 'release');
});
test('sparks are bounded, practice-only, grounded, moving, and immediately reset', () => {
  const sparks = createDriftSparks();
  const state = {
    ...createSimulationState(),
    speed: 12,
    status: 'running' as const,
  };
  const frame: DrivingVfxFrame = {
    state,
    phase: 'racing',
    held: true,
    acceleration: 1,
    rearLeft: { x: 1, y: 0, z: 0 },
    rearRight: { x: -1, y: 0, z: 0 },
    deltaSeconds: 1 / 60,
    cssPixelsPerMetre: 10,
    reducedMotion: false,
    practiceDriftSeconds: 0.4,
  };
  sparks.update(frame);
  assert.equal(sparks.object.visible, true);
  assert.ok(sparks.object.geometry.drawRange.count <= 16 * 6);
  for (const blocked of [
    { ...frame, practiceDriftSeconds: undefined },
    { ...frame, reducedMotion: true },
    { ...frame, phase: 'ready' as const },
    { ...frame, state: { ...state, speed: 0 } },
    { ...frame, state: { ...state, offRoad: true } },
    { ...frame, state: { ...state, recovering: true } },
  ]) {
    sparks.update(frame);
    sparks.update(blocked);
    assert.equal(sparks.object.visible, false);
  }
  sparks.update(frame);
  sparks.reset();
  assert.equal(sparks.object.visible, false);
  sparks.dispose();
});
