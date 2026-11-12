import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import {
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
} from '../../src/shared/simulation.ts';
import { MAX_REPLAY_TRANSITIONS, runReplay } from '../../src/shared/replay.ts';
import { LIFT_REPLAY } from '../../src/shared/fixtures/reference-replays.ts';
import {
  createSimulationDriver,
  type SimulationDriver,
} from '../../src/client/simulation-driver.ts';
import { COUNTDOWN_TICKS } from '../../src/shared/race-rules.ts';

const tickMilliseconds = 1000 / SIMULATION_HZ;
const countdownMilliseconds = COUNTDOWN_TICKS * tickMilliseconds;

function finishCountdown(driver: SimulationDriver, start = 0): number {
  for (let tick = 1; tick <= COUNTDOWN_TICKS; tick++) {
    driver.advance(start + tick * tickMilliseconds);
  }
  assert.equal(driver.raceState.phase, 'racing');
  assert.equal(driver.state.tick, 0);
  return start + countdownMilliseconds;
}

void test('30, 60 and 120 Hz render schedules produce the same input tape and replay result', () => {
  const track = createOvalTrack();
  const expected = runReplay(track, LIFT_REPLAY);
  for (const frameRate of [30, 60, 120]) {
    const driver = createSimulationDriver(track);
    driver.start(0);
    let transitionIndex = 0;
    for (let frame = 0; driver.active && frame < frameRate * 35; frame++) {
      const timestamp = (frame * 1000) / frameRate;
      let transition = LIFT_REPLAY.transitions[transitionIndex];
      while (
        transition &&
        countdownMilliseconds + transition.tick * tickMilliseconds <= timestamp
      ) {
        driver.setInput(
          transition.held,
          countdownMilliseconds + transition.tick * tickMilliseconds
        );
        transitionIndex++;
        transition = LIFT_REPLAY.transitions[transitionIndex];
      }
      driver.advance(timestamp);
    }
    assert.equal(driver.interrupted, false);
    assert.equal(driver.active, false);
    assert.deepEqual(driver.replay, LIFT_REPLAY);
    assert.deepEqual(driver.state, expected.state);
    assert.equal(driver.raceState.phase, 'finished');
    assert.equal(
      driver.raceState.nextCheckpointIndex,
      track.checkpoints.length
    );
    assert.equal(
      driver.raceState.checkpointTicks.length,
      track.checkpoints.length
    );
    const finishedTape = driver.replay;
    driver.abandon();
    driver.setInput(false, 50_000);
    driver.advance(50_000);
    assert.deepEqual(driver.replay, finishedTape);
  }
});

void test('start advances released ticks and synchronizes old input before an event', () => {
  const driver = createSimulationDriver(createOvalTrack());
  driver.start(1000);
  const goTime = finishCountdown(driver, 1000);
  driver.setInput(true, goTime + 100);
  assert.equal(driver.state.tick, 12);
  assert.equal(driver.state.speed, 0);
  assert.deepEqual(driver.replay.transitions, []);
  driver.advance(goTime + 100 + tickMilliseconds);
  assert.equal(driver.state.tick, 13);
  assert.ok(driver.state.speed > 0);
  assert.deepEqual(driver.replay.transitions, [{ tick: 12, held: true }]);
});

void test('same-tick toggles collapse to the sampled input without redundant events', () => {
  const driver = createSimulationDriver(createOvalTrack());
  driver.start(0);
  const goTime = finishCountdown(driver);
  driver.setInput(true, goTime);
  driver.setInput(true, goTime);
  driver.setInput(false, goTime);
  driver.setInput(true, goTime);
  driver.setInput(false, goTime + 20);
  driver.setInput(true, goTime + 20);
  driver.setInput(false, goTime + 20);
  driver.advance(goTime + 30);
  assert.deepEqual(driver.replay.transitions, [
    { tick: 0, held: true },
    { tick: 2, held: false },
  ]);
  const exported = driver.replay;
  exported.transitions.splice(0);
  assert.equal(driver.replay.transitions.length, 2);
});

void test('interpolation has separate previous/current snapshots and never advances ticks', () => {
  const driver = createSimulationDriver(createOvalTrack());
  driver.start(0);
  const goTime = finishCountdown(driver);
  driver.setInput(true, goTime);
  driver.advance(goTime + 12.5);
  assert.equal(driver.previousState.tick, 0);
  assert.equal(driver.state.tick, 1);
  assert.ok(Math.abs(driver.alpha - 0.5) < 1e-9);
  const state = { ...driver.state };
  void driver.alpha;
  void driver.previousState;
  assert.deepEqual(driver.state, state);
  // An earlier RAF timestamp must not move an event-synchronized clock backwards.
  driver.advance(goTime + 12);
  assert.deepEqual(driver.state, state);
});

void test('a 250 ms gap interrupts without skipping authoritative ticks; retry resets cleanly', () => {
  const driver = createSimulationDriver(createOvalTrack());
  driver.start(0);
  driver.setInput(true, 0);
  driver.advance(100);
  const state = { ...driver.state };
  driver.advance(350);
  assert.equal(driver.active, false);
  assert.equal(driver.interruptionReason, 'frame-gap');
  assert.equal(driver.raceState.phase, 'abandoned');
  assert.deepEqual(driver.state, state);
  driver.advance(10_000);
  assert.deepEqual(driver.state, state);
  driver.start(10_000);
  assert.equal(driver.interrupted, false);
  assert.equal(driver.state.tick, 0);
  assert.equal(driver.state.speed, 0);
  assert.equal(driver.raceState.phase, 'countdown');
  assert.equal(driver.raceState.countdownTicksRemaining, COUNTDOWN_TICKS);
  assert.equal(driver.raceState.nextCheckpointIndex, 0);
  assert.deepEqual(driver.raceState.checkpointTicks, []);
  assert.deepEqual(driver.replay.transitions, []);
});

void test('focus loss freezes the attempt and bounded input/duration limits interrupt', () => {
  const track = createOvalTrack();
  const focus = createSimulationDriver(track);
  focus.start(0);
  const focusGoTime = finishCountdown(focus);
  focus.advance(focusGoTime + 100);
  focus.abandon();
  focus.setInput(true, focusGoTime + 101);
  assert.equal(focus.interruptionReason, 'focus');
  assert.equal(focus.state.tick, 12);

  const inputs = createSimulationDriver(track);
  inputs.start(0);
  const inputGoTime = finishCountdown(inputs);
  for (let tick = 0; tick <= MAX_REPLAY_TRANSITIONS; tick++) {
    inputs.setInput(tick % 2 === 0, inputGoTime + tick * tickMilliseconds);
  }
  inputs.advance(inputGoTime + (MAX_REPLAY_TRANSITIONS + 1) * tickMilliseconds);
  assert.equal(inputs.interruptionReason, 'input-limit');
  assert.ok(inputs.replay.transitions.length <= MAX_REPLAY_TRANSITIONS);

  const duration = createSimulationDriver(track);
  duration.start(0);
  const durationGoTime = finishCountdown(duration);
  for (let tick = 1; tick <= MAX_SIMULATION_TICKS; tick++) {
    duration.advance(durationGoTime + tick * tickMilliseconds);
  }
  assert.equal(duration.interruptionReason, 'time-limit');
  assert.equal(duration.state.tick, MAX_SIMULATION_TICKS);
  assert.equal(duration.active, false);
});

void test('countdown is stationary and unscored, and a pre-GO hold records only tick zero', () => {
  const driver = createSimulationDriver(createOvalTrack());
  assert.equal(driver.raceState.phase, 'ready');
  assert.equal(driver.active, false);
  driver.start(0);
  driver.setInput(true, 0);
  driver.setInput(false, 0);
  driver.setInput(true, 0);
  for (let tick = 1; tick < COUNTDOWN_TICKS; tick++) {
    driver.advance(tick * tickMilliseconds);
  }
  assert.equal(driver.raceState.phase, 'countdown');
  assert.equal(driver.raceState.countdownTicksRemaining, 1);
  assert.equal(driver.state.tick, 0);
  assert.equal(driver.state.distance, 0);
  assert.equal(driver.state.speed, 0);
  assert.deepEqual(driver.replay.transitions, []);
  driver.advance(countdownMilliseconds);
  assert.equal(driver.raceState.phase, 'racing');
  assert.equal(driver.state.tick, 0);
  driver.advance(countdownMilliseconds + tickMilliseconds);
  assert.equal(driver.state.tick, 1);
  assert.ok(driver.state.speed > 0);
  assert.deepEqual(driver.replay.transitions, [{ tick: 0, held: true }]);
});

void test('retry clears completed checkpoints, timing, tape and countdown input', () => {
  const track = createOvalTrack();
  const driver = createSimulationDriver(track);
  driver.start(0);
  driver.setInput(true, 0);
  for (let tick = 1; driver.active && tick < 5000; tick++) {
    driver.advance(tick * tickMilliseconds);
  }
  assert.equal(driver.raceState.phase, 'finished');
  assert.equal(driver.raceState.nextCheckpointIndex, track.checkpoints.length);
  driver.start(50_000);
  assert.equal(driver.raceState.phase, 'countdown');
  assert.equal(driver.raceState.countdownTicksRemaining, COUNTDOWN_TICKS);
  assert.equal(driver.raceState.nextCheckpointIndex, 0);
  assert.deepEqual(driver.raceState.checkpointTicks, []);
  assert.equal(driver.state.tick, 0);
  assert.equal(driver.state.distance, 0);
  assert.equal(driver.previousState.tick, 0);
  assert.deepEqual(driver.replay.transitions, []);
  const goTime = finishCountdown(driver, 50_000);
  driver.advance(goTime + tickMilliseconds);
  assert.equal(driver.state.speed, 0);
});
