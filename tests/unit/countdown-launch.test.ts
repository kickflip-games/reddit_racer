import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSimulationDriver } from '../../src/client/simulation-driver.ts';
import {
  createPracticeDriver,
  stepPracticeDrift,
} from '../../src/client/practice-driver.ts';
import { generateLinkedCourseCandidate } from '../../src/shared/linked-course-generator.ts';
import { COUNTDOWN_TICKS } from '../../src/shared/race-rules.ts';
import {
  SIMULATION_HZ,
  createSimulationState,
  stepSimulation,
} from '../../src/shared/simulation.ts';
import {
  COUNTDOWN_LAUNCH_WINDOW_TICKS,
  COUNTDOWN_LAUNCH_SPEED,
} from '../../src/shared/countdown-launch.ts';
import { runReplay, validateReplay } from '../../src/shared/replay.ts';
import { runtimeForTrack } from '../../src/shared/scored-runtime.ts';

const generated = generateLinkedCourseCandidate('grass-regression').track;
assert.ok(generated);
const track = generated;
const dt = 1000 / SIMULATION_HZ;
type Input = { tick: number; held: boolean };

const cases: { name: string; inputs: Input[]; boost: boolean }[] = [
  {
    name: 'early held start',
    inputs: [{ tick: -360, held: true }],
    boost: false,
  },
  {
    name: 'just before the window',
    inputs: [{ tick: -145, held: true }],
    boost: false,
  },
  { name: 'tail end of 2', inputs: [{ tick: -144, held: true }], boost: true },
  { name: 'during 1', inputs: [{ tick: -90, held: true }], boost: true },
  {
    name: 'last countdown tick',
    inputs: [{ tick: -1, held: true }],
    boost: true,
  },
  { name: 'at GO', inputs: [{ tick: 0, held: true }], boost: false },
  { name: 'after GO', inputs: [{ tick: 12, held: true }], boost: false },
  {
    name: 'early hold and repeated key/touch input',
    inputs: [
      { tick: -360, held: true },
      { tick: -90, held: true },
    ],
    boost: false,
  },
  {
    name: 'release and fresh press in window',
    inputs: [
      { tick: -360, held: true },
      { tick: -100, held: false },
      { tick: -80, held: true },
    ],
    boost: true,
  },
  {
    name: 'release before green',
    inputs: [
      { tick: -90, held: true },
      { tick: -1, held: false },
      { tick: 12, held: true },
    ],
    boost: false,
  },
  {
    name: 'release exactly at green',
    inputs: [
      { tick: -90, held: true },
      { tick: 0, held: false },
      { tick: 12, held: true },
    ],
    boost: false,
  },
  {
    name: 'release and repress after green',
    inputs: [
      { tick: -360, held: true },
      { tick: -1, held: false },
      { tick: 0, held: true },
    ],
    boost: false,
  },
];

for (const scenario of cases) {
  test(`ranked, practice and replay agree: ${scenario.name}`, () => {
    const ranked = createSimulationDriver(track),
      practice = createPracticeDriver(track);
    for (const driver of [ranked, practice]) driver.start(0);
    for (let tick = -COUNTDOWN_TICKS; tick < 80; tick++) {
      const time = (tick + COUNTDOWN_TICKS) * dt;
      for (const input of scenario.inputs.filter(
        (input) => input.tick === tick
      ))
        for (const driver of [ranked, practice])
          driver.setInput(input.held, time);
      for (const driver of [ranked, practice]) driver.advance(time + dt);
      assert.deepEqual(practice.state, ranked.state);
      if (tick < 0) {
        assert.equal(ranked.state.tick, 0);
        assert.equal(ranked.state.speed, 0);
        assert.equal(ranked.state.distance, 0);
      }
      if (tick === 0) {
        assert.equal(ranked.state.startBoostTick, scenario.boost ? 0 : null);
        if (scenario.boost)
          assert.ok(ranked.state.speed >= COUNTDOWN_LAUNCH_SPEED);
      }
    }
    assert.ok(ranked.state.speed > 0, 'all starts accelerate without a stall');
    assert.equal(ranked.replay.schemaVersion, 2);
    assert.deepEqual(validateReplay(ranked.replay), ranked.replay);
    // Drive a full run without altering the recorded input history.
    for (let tick = COUNTDOWN_TICKS + 81; ranked.active; tick++)
      ranked.advance(tick * dt);
    assert.equal(ranked.raceState.phase, 'finished');
    assert.deepEqual(runReplay(track, ranked.replay).state, ranked.state);
    assert.equal(ranked.state.startBoostTick, scenario.boost ? 0 : null);
    for (const driver of [ranked, practice]) {
      driver.start(100000);
      assert.equal(driver.state.startBoostTick, undefined);
      assert.equal(driver.state.launchArmed, undefined);
      assert.equal(driver.state.speed, 0);
    }
  });
}

test('missed launches have exactly the ordinary v7 acceleration and no drift-release boost', () => {
  const old = { ...track, generatorVersion: 'linked-circuits-v2' };
  let modern = createSimulationState(track),
    legacy = createSimulationState(old);
  for (let tick = 0; tick < 180; tick++) {
    const held = tick < 30 || tick >= 34;
    modern = stepSimulation(track, modern, held);
    legacy = stepSimulation(old, legacy, held);
    const { launchArmed, firstThrottleTick, startBoostTick, ...physics } =
      modern;
    assert.equal(launchArmed, false);
    assert.equal(startBoostTick, null);
    assert.equal(firstThrottleTick, 0);
    assert.deepEqual(physics, legacy);
  }
});

test('launch is consumed once across flying laps and after release/repress', () => {
  const driver = createPracticeDriver(track);
  driver.start(0);
  for (let tick = 0; tick < 40000 && driver.completedLaps < 2; tick++) {
    if (tick === COUNTDOWN_TICKS - 90) driver.setInput(true, tick * dt);
    if (tick === COUNTDOWN_TICKS + 30) driver.setInput(false, tick * dt);
    if (tick === COUNTDOWN_TICKS + 35) driver.setInput(true, tick * dt);
    driver.advance((tick + 1) * dt);
  }
  assert.equal(driver.completedLaps, 2);
  assert.equal(driver.state.startBoostTick, 0);
  assert.equal(driver.state.launchArmed, false);
});

test('v9 drift adds drag and releasing drift never creates another launch impulse', () => {
  const state = {
    ...createSimulationState(track),
    tick: 300,
    speed: 22,
    startBoostTick: 0,
    launchArmed: false,
  };
  const ordinary = stepSimulation(track, state, true);
  const drift = stepPracticeDrift(track, state, true, 0.3);
  assert.ok(drift.speed < ordinary.speed);
  const released = stepSimulation(track, drift, true);
  assert.ok(released.speed - drift.speed < 0.1);
  assert.equal(released.startBoostTick, 0);
  assert.equal(released.launchArmed, false);
});

test('schema 2 binds countdown history to v9 and rejects forged launch claims', () => {
  assert.equal(COUNTDOWN_LAUNCH_WINDOW_TICKS, 144);
  assert.equal(runtimeForTrack(track).simulationVersion, 'fixed-step-v9');
  const tape = {
    schemaVersion: 2,
    simulationVersion: 'fixed-step-v9',
    handlingVersion: 'countdown-start-v1',
    transitions: [{ tick: -120, held: true }],
    endTick: 100,
  };
  assert.deepEqual(validateReplay(tape), tape);
  for (const malformed of [
    { ...tape, schemaVersion: 1 },
    {
      ...tape,
      simulationVersion: 'fixed-step-v8',
      handlingVersion: 'timed-start-v1',
    },
    { ...tape, launchArmed: true },
    { ...tape, transitions: [{ tick: -361, held: true }] },
    { ...tape, transitions: [{ tick: -1.5, held: true }] },
    {
      ...tape,
      transitions: [
        { tick: -120, held: true },
        { tick: 0, held: true },
      ],
    },
  ])
    assert.throws(() => validateReplay(malformed));
});
