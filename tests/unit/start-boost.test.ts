import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateLinkedCourseCandidate } from '../../src/shared/linked-course-generator';
import {
  createRacingState,
  prepareRace,
  startRace,
  stepRace,
  COUNTDOWN_TICKS,
} from '../../src/shared/race-rules';
import {
  createSimulationState,
  stepSimulation,
} from '../../src/shared/simulation';
import { runtimeForTrack } from '../../src/shared/scored-runtime';
import {
  START_BOOST_WINDOW_TICKS,
  START_BOOST_SPEED,
} from '../../src/shared/start-boost';
import { runReplay } from '../../src/shared/replay';
import { qualityVersionForTrack } from '../../src/shared/circuit-quality';

const generated = generateLinkedCourseCandidate('grass-regression', 1).track;
assert.ok(generated);
const track = generated;
const old = { ...track, generatorVersion: 'linked-circuits-v2' };
function atPress(tick: number) {
  let race = createRacingState(track);
  for (let i = 0; i < tick; i++) race = stepRace(track, race, false);
  return stepRace(track, race, true);
}

test('v8 timed launch awards first presses across the inclusive forgiving window', () => {
  for (const tick of [1, 12, START_BOOST_WINDOW_TICKS]) {
    const race = atPress(tick);
    assert.equal(race.phase, 'racing');
    assert.equal(race.simulation.startBoostTick, tick);
    assert.equal(race.simulation.firstThrottleTick, tick);
    assert.ok(race.simulation.speed >= START_BOOST_SPEED);
  }
});
test('early and late starts have no penalty relative to retained v7; repeat presses cannot farm boosts', () => {
  for (const tick of [0, START_BOOST_WINDOW_TICKS + 1, 120]) {
    let modern = createSimulationState(track),
      legacy = createSimulationState(old);
    for (let i = 0; i < 180; i++) {
      const held = i >= tick && (i < tick + 4 || i >= tick + 6);
      modern = stepSimulation(track, modern, held);
      legacy = stepSimulation(old, legacy, held);
      const { firstThrottleTick, startBoostTick, ...physics } = modern;
      assert.equal(startBoostTick, null);
      assert.equal(firstThrottleTick, i >= tick ? tick : null);
      assert.deepEqual(physics, legacy);
    }
  }
  let race = atPress(12);
  const speed = race.simulation.speed;
  race = stepRace(track, race, false);
  race = stepRace(track, race, true);
  assert.equal(race.simulation.startBoostTick, 12);
  assert.ok(race.simulation.speed < speed + 1);
});
test('countdown is stationary, early hold launches normally and retry clears earned boost', () => {
  let race = startRace(prepareRace(track));
  for (let i = 0; i < COUNTDOWN_TICKS; i++) {
    race = stepRace(track, race, true);
    assert.equal(race.simulation.tick, 0);
    assert.equal(race.simulation.speed, 0);
    assert.equal(race.simulation.distance, 0);
  }
  race = stepRace(track, race, true);
  assert.equal(race.simulation.startBoostTick, null);
  assert.equal(atPress(12).simulation.startBoostTick, 12);
  const retry = startRace(prepareRace(track));
  assert.equal(retry.simulation.startBoostTick, undefined);
  assert.equal(retry.simulation.firstThrottleTick, undefined);
});
test('runtime identity preserves historical v7 tracks and disallows cross-version replay substitution', () => {
  assert.equal(runtimeForTrack(track).simulationVersion, 'fixed-step-v8');
  assert.equal(runtimeForTrack(old).simulationVersion, 'fixed-step-v7');
  assert.equal(qualityVersionForTrack(old), 'linked-quality-v2');
  assert.throws(
    () =>
      runReplay(old, {
        schemaVersion: 1,
        simulationVersion: 'fixed-step-v8',
        handlingVersion: 'timed-start-v1',
        transitions: [{ tick: 12, held: true }],
        endTick: 100,
      }),
    /does not match/
  );
});

test('complete retained v7 replay verifies identically without launch metadata', () => {
  let race = createRacingState(old);
  while (race.phase === 'racing') race = stepRace(old, race, true);
  assert.equal(race.phase, 'finished');
  const verified = runReplay(old, {
    schemaVersion: 1,
    simulationVersion: 'fixed-step-v7',
    handlingVersion: 'road-finish-v1',
    transitions: [{ tick: 0, held: true }],
    endTick: race.simulation.tick,
  });
  assert.deepEqual(verified.state, race.simulation);
  assert.equal(verified.state.startBoostTick, undefined);
});
