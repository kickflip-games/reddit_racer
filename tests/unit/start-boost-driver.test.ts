import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSimulationDriver } from '../../src/client/simulation-driver.ts';
import { createPracticeDriver } from '../../src/client/practice-driver.ts';
import { generateBrakingCircuit } from '../../src/shared/braking-course-generator.ts';
import { COUNTDOWN_TICKS } from '../../src/shared/race-rules.ts';
import { SIMULATION_HZ } from '../../src/shared/simulation.ts';
import { runReplay } from '../../src/shared/replay.ts';

const dt = 1000 / SIMULATION_HZ;
const track = {
  ...generateBrakingCircuit('practice-1').track,
  generatorVersion: 'linked-circuits-v3',
};

for (const pressTick of [0, 1, 12, 36, 37]) {
  void test(`ranked and practice launch agree at tick ${pressTick}, and restart clears bonus`, () => {
    const ranked = createSimulationDriver(track);
    const practice = createPracticeDriver(track);
    for (const driver of [ranked, practice]) driver.start(0);
    for (let tick = 1; tick <= COUNTDOWN_TICKS + 100; tick++) {
      if (tick === COUNTDOWN_TICKS + pressTick + 1) {
        for (const driver of [ranked, practice])
          driver.setInput(true, (tick - 1) * dt);
      }
      for (const driver of [ranked, practice]) driver.advance(tick * dt);
      assert.deepEqual(practice.state, ranked.state);
    }
    const awarded = pressTick >= 1 && pressTick <= 36;
    assert.equal(ranked.state.startBoostTick, awarded ? pressTick : null);
    assert.ok(ranked.state.speed > 0);
    for (const driver of [ranked, practice]) {
      driver.start(10000);
      assert.equal(driver.state.startBoostTick ?? null, null);
      assert.equal(driver.state.firstThrottleTick ?? null, null);
      assert.equal(driver.state.speed, 0);
    }
  });
}

void test('timely start replay reproduces the full ranked run and practice never re-awards on later laps', () => {
  const ranked = createSimulationDriver(track);
  const practice = createPracticeDriver(track);
  ranked.start(0);
  practice.start(0);
  for (let tick = 1; tick <= 40000 && practice.completedLaps < 2; tick++) {
    if (tick === COUNTDOWN_TICKS + 13) {
      ranked.setInput(true, (tick - 1) * dt);
      practice.setInput(true, (tick - 1) * dt);
    }
    if (ranked.active) ranked.advance(tick * dt);
    practice.advance(tick * dt);
    if (practice.state.tick > 13)
      assert.equal(practice.state.startBoostTick, 12);
  }
  assert.equal(ranked.raceState.phase, 'finished');
  assert.deepEqual(runReplay(track, ranked.replay).state, ranked.state);
  assert.equal(practice.completedLaps, 2);
  assert.equal(practice.state.startBoostTick, 12);
  assert.equal(practice.state.firstThrottleTick, 12);
});
