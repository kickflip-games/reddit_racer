import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPracticeDriver,
  type PracticeDriver,
} from '../../src/client/practice-driver.ts';
import { createSimulationDriver } from '../../src/client/simulation-driver.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { sampleTrack, type Track } from '../../src/shared/track.ts';
import {
  createSimulationState,
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
  stepSimulation,
  type SimulationState,
} from '../../src/shared/simulation.ts';
import { COUNTDOWN_TICKS } from '../../src/shared/race-rules.ts';

const tickMilliseconds = 1000 / SIMULATION_HZ;
const countdownMilliseconds = COUNTDOWN_TICKS * tickMilliseconds;

function finishCountdown(driver: PracticeDriver, start = 0): number {
  for (let tick = 1; tick <= COUNTDOWN_TICKS; tick++)
    driver.advance(start + tick * tickMilliseconds);
  assert.equal(driver.raceState.phase, 'racing');
  assert.equal(driver.state.tick, 0);
  return start + countdownMilliseconds;
}

function physicalFields(state: Readonly<SimulationState>) {
  return {
    speed: state.speed,
    lateralOffset: state.lateralOffset,
    lateralVelocity: state.lateralVelocity,
    slip: state.slip,
    recovering: state.recovering,
    recoveryTicksRemaining: state.recoveryTicksRemaining,
    recoveryCount: state.recoveryCount,
  };
}

function driveFirstLap(track: Track): void {
  const practice = createPracticeDriver(track);
  const ranked = createSimulationDriver(track);
  practice.start(0);
  ranked.start(0);
  practice.setInput(true, 0);
  ranked.setInput(true, 0);
  let observedRecovery = false;
  for (let tick = 1; ranked.active && tick <= 15_000; tick++) {
    const timestamp = tick * tickMilliseconds;
    practice.advance(timestamp);
    ranked.advance(timestamp);
    observedRecovery ||= ranked.state.recovering;
    assert.deepEqual(
      physicalFields(practice.state),
      physicalFields(ranked.state)
    );
    assert.equal(practice.state.tick, ranked.state.tick);
    if (ranked.active) {
      assert.deepEqual(practice.state, ranked.state);
      assert.equal(practice.completedLaps, 0);
      assert.deepEqual(
        practice.raceState.checkpointTicks,
        ranked.raceState.checkpointTicks
      );
    }
  }
  assert.equal(ranked.raceState.phase, 'finished');
  assert.equal(practice.active, true);
  assert.equal(practice.raceState.phase, 'racing');
  assert.equal(practice.state.status, 'running');
  assert.equal(practice.state.finishedTick, null);
  assert.equal(practice.completedLaps, 1);
  assert.equal(practice.lastLapTicks, ranked.state.finishedTick);
  assert.equal(practice.lapTicks, 0);
  assert.equal(practice.raceState.nextCheckpointIndex, 0);
  assert.ok(practice.state.distance >= track.totalLength);
  assert.ok(practice.state.speed > 0);
  if (track.seed === 'practice-recovery') assert.equal(observedRecovery, true);
}

void test('the first standing-start lap matches ranked physics and checkpoints exactly, including recovery', () => {
  driveFirstLap(createOvalTrack());
  const recovery = createOvalTrack({ radiusX: 10, radiusZ: 80, width: 1 });
  driveFirstLap({ ...recovery, seed: 'practice-recovery' });
});

void test('30/60/120 Hz schedules retain fixed time and held input across multiple flying laps', () => {
  const track = createOvalTrack();
  let expected: unknown;
  for (const frameRate of [30, 60, 120]) {
    const driver = createPracticeDriver(track);
    driver.start(0);
    driver.setInput(true, 0); // One hold serves every subsequent lap.
    const goTime = finishCountdown(driver);
    const lapTimes: number[] = [];
    let seenLaps = 0;
    for (let frame = 1; frame <= frameRate * 75; frame++) {
      driver.advance(goTime + (frame * 1000) / frameRate);
      if (driver.completedLaps !== seenLaps) {
        assert.equal(driver.completedLaps, seenLaps + 1);
        assert.ok(driver.lastLapTicks !== null);
        lapTimes.push(driver.lastLapTicks);
        seenLaps++;
      }
    }
    assert.equal(driver.active, true);
    assert.equal(driver.state.tick, SIMULATION_HZ * 75);
    assert.ok(driver.completedLaps >= 3);
    assert.ok(driver.state.speed > 0);
    assert.equal(
      lapTimes.reduce((sum, ticks) => sum + ticks, 0) + driver.lapTicks,
      driver.state.tick
    );
    const result = {
      state: driver.state,
      previous: driver.previousState,
      race: driver.raceState,
      completedLaps: driver.completedLaps,
      lapTicks: driver.lapTicks,
      lastLapTicks: driver.lastLapTicks,
      lapTimes,
    };
    if (expected === undefined) expected = result;
    else assert.deepEqual(result, expected);
  }
});

void test('the finish seam preserves overshoot, interpolation and unused fixed-step time', () => {
  const track = createOvalTrack();
  const driver = createPracticeDriver(track);
  driver.start(0);
  driver.setInput(true, 0);
  const goTime = finishCountdown(driver);
  let timestamp = goTime;
  for (let tick = 1; driver.completedLaps === 0 && tick < 6000; tick++) {
    timestamp = goTime + (tick + 0.5) * tickMilliseconds;
    driver.advance(timestamp);
  }
  assert.equal(driver.completedLaps, 1);
  assert.ok(driver.previousState.distance < track.totalLength);
  assert.ok(driver.state.distance > track.totalLength);
  const travelled = driver.state.distance - driver.previousState.distance;
  assert.ok(travelled > 0 && travelled <= 22 / SIMULATION_HZ + 0.000002);
  assert.ok(Math.abs(driver.alpha - 0.5) < 1e-8);
  const from = sampleTrack(track, driver.previousState.distance);
  const to = sampleTrack(track, driver.state.distance);
  const middle = sampleTrack(
    track,
    (driver.previousState.distance + driver.state.distance) / 2
  );
  assert.ok(Math.hypot(to.x - from.x, to.z - from.z) < 0.2);
  assert.ok(Math.hypot(middle.x - from.x, middle.z - from.z) < 0.2);
  const expectedPhysics = stepSimulation(track, driver.previousState, true);
  assert.deepEqual(
    physicalFields(driver.state),
    physicalFields(expectedPhysics)
  );
  const seamTick = driver.state.tick;
  driver.advance(timestamp + 2.75 * tickMilliseconds);
  assert.equal(driver.state.tick, seamTick + 3);
  assert.equal(driver.lapTicks, 3);
  assert.ok(Math.abs(driver.alpha - 0.25) < 1e-8);
  assert.equal(driver.raceState.phase, 'racing');
});

void test('releasing before the seam stays released after crossing and local gate clocks restart', () => {
  const track = createOvalTrack();
  track.checkpoints = [{ id: 'early', s: 0.001 }, ...track.checkpoints];
  const driver = createPracticeDriver(track);
  driver.start(0);
  driver.setInput(true, 0);
  const goTime = finishCountdown(driver);
  let tick = 0;
  while (driver.state.distance < track.totalLength - 1 && tick < 6000) {
    tick++;
    driver.advance(goTime + tick * tickMilliseconds);
  }
  driver.setInput(false, goTime + tick * tickMilliseconds);
  const speedBefore = driver.state.speed;
  while (driver.completedLaps === 0 && tick < 6500) {
    tick++;
    driver.advance(goTime + tick * tickMilliseconds);
  }
  assert.equal(driver.completedLaps, 1);
  assert.ok(driver.state.speed > 0 && driver.state.speed < speedBefore);
  assert.equal(driver.lapTicks, 0);
  assert.equal(driver.raceState.nextCheckpointIndex, 1);
  assert.deepEqual(driver.raceState.checkpointTicks, [0]);
  const crossedSpeed = driver.state.speed;
  driver.advance(goTime + ++tick * tickMilliseconds);
  assert.ok(driver.state.speed < crossedSpeed);
  assert.equal(driver.lapTicks, 1);
  assert.equal(driver.raceState.nextCheckpointIndex, 1);
});

void test('practice can stay stationary beyond two ranked duration limits, then accelerate normally', () => {
  const track = createOvalTrack();
  const driver = createPracticeDriver(track);
  driver.start(0);
  const goTime = finishCountdown(driver);
  const ticks = MAX_SIMULATION_TICKS * 2 + 12;
  for (let tick = 12; tick <= ticks; tick += 12)
    driver.advance(goTime + tick * tickMilliseconds);
  assert.equal(driver.active, true);
  assert.equal(driver.state.tick, ticks);
  assert.equal(driver.lapTicks, ticks);
  assert.equal(driver.completedLaps, 0);
  assert.equal(driver.lastLapTicks, null);
  assert.equal(driver.state.distance, 0);
  assert.equal(driver.state.speed, 0);
  driver.setInput(true, goTime + ticks * tickMilliseconds);
  driver.advance(goTime + (ticks + 1) * tickMilliseconds);
  const expected = stepSimulation(track, createSimulationState(), true);
  assert.deepEqual(physicalFields(driver.state), physicalFields(expected));
  assert.equal(driver.state.tick, ticks + 1);
  assert.equal(driver.state.distance, expected.distance);
});

void test('continuous driving passes the private clock bound without resetting physical or presentation history', () => {
  const track = createOvalTrack({ radiusX: 10, radiusZ: 80, width: 1 });
  const driver = createPracticeDriver(track);
  driver.start(0);
  driver.setInput(true, 0);
  const goTime = finishCountdown(driver);
  let previousRecoveries = 0;
  for (let tick = 1; tick <= MAX_SIMULATION_TICKS + 600; tick++) {
    driver.advance(goTime + tick * tickMilliseconds);
    assert.equal(driver.state.tick, tick);
    assert.ok(driver.state.distance >= driver.previousState.distance);
    assert.ok(driver.state.recoveryCount >= previousRecoveries);
    previousRecoveries = driver.state.recoveryCount;
    if (tick === MAX_SIMULATION_TICKS + 1) {
      const previous = driver.previousState;
      const expected = stepSimulation(
        track,
        {
          ...previous,
          tick: 0,
          distance:
            previous.distance - driver.completedLaps * track.totalLength,
        },
        true
      );
      assert.deepEqual(physicalFields(driver.state), physicalFields(expected));
    }
  }
  assert.equal(driver.active, true);
  assert.ok(driver.completedLaps >= 3);
  assert.ok(driver.state.recoveryCount >= 2);
});

void test('focus, frame gaps and retry safely stop old input without an automatic restart', () => {
  const driver = createPracticeDriver(createOvalTrack());
  driver.start(0);
  driver.setInput(true, 0);
  const goTime = finishCountdown(driver);
  driver.advance(goTime + 100);
  driver.abandon('focus');
  const stopped = { ...driver.state };
  driver.setInput(true, goTime + 200);
  driver.advance(50_000);
  assert.equal(driver.interruptionReason, 'focus');
  assert.deepEqual(driver.state, stopped);
  driver.start(50_000);
  assert.equal(driver.interrupted, false);
  assert.equal(driver.state.tick, 0);
  assert.equal(driver.state.speed, 0);
  assert.equal(driver.completedLaps, 0);
  assert.equal(driver.lapTicks, 0);
  assert.equal(driver.lastLapTicks, null);
  assert.deepEqual(driver.raceState.checkpointTicks, []);
  const secondGo = finishCountdown(driver, 50_000);
  driver.advance(secondGo + tickMilliseconds);
  assert.equal(driver.state.speed, 0);
  driver.setInput(true, secondGo + tickMilliseconds);
  driver.advance(secondGo + 2 * tickMilliseconds);
  const beforeGap = { ...driver.state };
  driver.advance(secondGo + 2 * tickMilliseconds + 250);
  assert.equal(driver.active, false);
  assert.equal(driver.interruptionReason, 'frame-gap');
  assert.deepEqual(driver.state, beforeGap);
});

void test('input timestamps use old input before transitions and reads never advance practice', () => {
  const driver = createPracticeDriver(createOvalTrack());
  assert.equal(driver.raceState.phase, 'ready');
  assert.equal(driver.active, false);
  assert.throws(() => driver.start(NaN), /Invalid start/);
  driver.start(0);
  const goTime = finishCountdown(driver);
  driver.setInput(true, goTime + 100);
  assert.equal(driver.state.tick, 12);
  assert.equal(driver.state.speed, 0);
  driver.advance(goTime + 112.5);
  assert.equal(driver.previousState.tick, 12);
  assert.equal(driver.state.tick, 13);
  assert.ok(Math.abs(driver.alpha - 0.5) < 1e-9);
  assert.ok(driver.state.speed > 0);
  const state = { ...driver.state };
  void driver.lapTicks;
  void driver.lastLapTicks;
  void driver.completedLaps;
  void driver.alpha;
  driver.advance(goTime + 110);
  assert.deepEqual(driver.state, state);
  assert.throws(() => driver.advance(Infinity), /Invalid frame/);
});
