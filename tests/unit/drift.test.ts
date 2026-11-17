import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { createSimulationState } from '../../src/shared/simulation.ts';
import { stepElevatedSimulation } from '../../src/shared/elevated-simulation.ts';
import { sampleTrack } from '../../src/shared/track.ts';
import { createPracticeDriver } from '../../src/client/practice-driver.ts';

const track = generateElevatedCircuit('showcase-3').track;
test('drift is deterministic, corner grip helps briefly and sustained hold loses grip', () => {
  let distance = 0;
  for (; distance < track.totalLength; distance += 0.5) {
    if (Math.abs(sampleTrack(track, distance).curvature) > 0.045) break;
  }
  assert.ok(distance < track.totalLength);
  const state = { ...createSimulationState(track), distance, speed: 22 };
  const normal = stepElevatedSimulation(track, state, true);
  const short = stepElevatedSimulation(track, state, true, 0.3);
  const long = stepElevatedSimulation(track, state, true, 3);
  assert.deepEqual(short, stepElevatedSimulation(track, state, true, 0.3));
  assert.ok(Math.abs(short.lateralVelocity) < Math.abs(normal.lateralVelocity));
  assert.ok(Math.abs(long.lateralVelocity) > Math.abs(normal.lateralVelocity));
  assert.ok(short.speed < normal.speed);
  assert.deepEqual(
    stepElevatedSimulation(track, state, false, 1),
    stepElevatedSimulation(track, state, false)
  );
});
test('practice drift fixed ticks are frame-schedule independent and reset on interruption', () => {
  const a = createPracticeDriver(track),
    b = createPracticeDriver(track);
  for (const driver of [a, b]) {
    driver.start(0);
    driver.setInput(true, 0);
    driver.setDrift(true, 0);
  }
  for (let t = 10; t <= 5000; t += 10) a.advance(t);
  for (let t = 20; t <= 5000; t += 20) b.advance(t);
  assert.deepEqual(a.state, b.state);
  a.abandon();
  assert.equal(a.drifting, false);
  a.start(5000);
  assert.equal(a.drifting, false);
});
