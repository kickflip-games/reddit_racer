import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  createRecoveryFeedback,
  type RecoveryVisualFrame,
} from '../../src/client/recovery-feedback';
import {
  createCarVisual,
  type CarVisualFrame,
} from '../../src/client/car-visual';
import { createSimulationState } from '../../src/shared/simulation';
import { createRacingState, stepRace } from '../../src/shared/race-rules';
import { generateCurrentDailyCircuit } from '../../src/shared/braking-course-generator';

const recoveryFrame = (tick = 100, count = 1): RecoveryVisualFrame => ({
  attemptId: 1,
  phase: 'racing',
  state: {
    tick,
    recovering: true,
    recoveryCount: count,
    recoveryTicksRemaining: 119,
  },
});
const carFrame: CarVisualFrame = {
  x: 0,
  z: 0,
  heading: 0,
  distance: 0,
  speed: 0,
  acceleration: 0,
  lateralAcceleration: 0,
  curvature: 0,
  slip: 0,
  held: true,
  racing: true,
  reducedMotion: false,
  deltaSeconds: 1 / 60,
};

void test('automatic recovery blinks at 1.5Hz on simulation ticks; redraws and delta time do not advance it', () => {
  const effect = createRecoveryFeedback();
  assert.deepEqual(effect.update(recoveryFrame(), false), {
    active: true,
    visible: true,
  });
  assert.equal(effect.update(recoveryFrame(139), false).visible, true);
  assert.equal(effect.update(recoveryFrame(140), false).visible, false);
  assert.equal(effect.update(recoveryFrame(140), false).visible, false);
  assert.equal(effect.update(recoveryFrame(180), false).visible, true);
  assert.equal(effect.update(recoveryFrame(181, 2), false).visible, true);
  assert.equal(effect.update(recoveryFrame(221, 2), false).visible, false);
  assert.deepEqual(effect.update(undefined, false), {
    active: false,
    visible: true,
  });
});

void test('ready, countdown, finished, interrupted, expired recovery, grass and flight never start flashing', () => {
  const effect = createRecoveryFeedback();
  for (const phase of [
    'ready',
    'countdown',
    'abandoned',
    'finished',
  ] as const) {
    effect.update(recoveryFrame(), false);
    effect.update(recoveryFrame(140), false);
    assert.deepEqual(effect.update({ ...recoveryFrame(150), phase }, false), {
      active: false,
      visible: true,
    });
  }
  for (const state of [
    { ...createSimulationState(), tick: 150, offRoad: true },
    {
      ...createSimulationState(),
      tick: 150,
      vertical: {
        height: 3,
        velocity: 1,
        airborne: true,
        landings: 0,
        impact: 0,
      },
    },
    { ...recoveryFrame(150).state, recoveryTicksRemaining: 0 },
  ])
    assert.deepEqual(effect.update({ ...recoveryFrame(150), state }, false), {
      active: false,
      visible: true,
    });
});

void test('reduced motion is steady, and retry/model reset restores the owned rig without touching materials or root visibility', () => {
  const car = createCarVisual();
  const rig = car.object.getObjectByName('car-model');
  const halo = car.object.getObjectByName('car-recovery-halo');
  assert(rig && halo);
  const materials = new Map<
    THREE.Material,
    { opacity: number; transparent: boolean }
  >();
  rig.traverse((node) => {
    if (node instanceof THREE.Mesh)
      for (const material of Array.isArray(node.material)
        ? node.material
        : [node.material])
        materials.set(material, {
          opacity: material.opacity,
          transparent: material.transparent,
        });
  });
  car.update({ ...carFrame, recovery: recoveryFrame() });
  car.update({ ...carFrame, recovery: recoveryFrame(140) });
  assert.equal(rig.visible, false);
  assert.equal(halo.visible, true);
  for (const tick of [141, 180, 220]) {
    car.update({
      ...carFrame,
      recovery: recoveryFrame(tick),
      reducedMotion: true,
    });
    assert.equal(rig.visible, true);
    assert.equal(halo.visible, true);
  }
  car.object.visible = false; // Required-art/loading ownership must stay independent.
  car.reset();
  assert.equal(rig.visible, true);
  assert.equal(halo.visible, false);
  assert.equal(car.object.visible, false);
  for (const [material, original] of materials)
    assert.deepEqual(
      { opacity: material.opacity, transparent: material.transparent },
      original
    );
  car.dispose();
});

void test('repeated actual physics recoveries flash and restore exactly at recovery boundaries without altering the scored state', () => {
  const track = generateCurrentDailyCircuit('daily:t5_kyc33w:2026-11-27').track;
  const car = createCarVisual();
  const rig = car.object.getObjectByName('car-model');
  const halo = car.object.getObjectByName('car-recovery-halo');
  assert(rig && halo);
  let race = createRacingState(track),
    resets = 0,
    completed = 0,
    hidden = 0;
  while (race.phase === 'racing' && race.simulation.tick < 14400) {
    const previous = race.simulation;
    race = stepRace(track, race, true);
    const state = race.simulation;
    if (state.recoveryCount > previous.recoveryCount) resets++;
    if (previous.recovering && !state.recovering) completed++;
    const before = JSON.stringify(state);
    car.update({
      ...carFrame,
      recovery: { attemptId: 1, phase: race.phase, state },
    });
    assert.equal(JSON.stringify(state), before);
    assert.equal(halo.visible, race.phase === 'racing' && state.recovering);
    if (!state.recovering) assert.equal(rig.visible, true);
    if (!rig.visible) hidden++;
  }
  assert(resets >= 2, `Expected repeated real recoveries, got ${resets}`);
  assert.equal(completed, resets);
  assert(hidden > 0);
  assert.equal(rig.visible, true);
  assert.equal(halo.visible, false);
  car.dispose();
});
