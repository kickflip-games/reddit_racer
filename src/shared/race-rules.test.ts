import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abandonRace,
  advanceLapProgress,
  COUNTDOWN_TICKS,
  createRaceState,
  createRacingState,
  prepareRace,
  startRace,
  stepRace,
} from './race-rules.ts';
import type { RaceState } from './race-rules.ts';
import { createOvalTrack } from './track-authoring.ts';
import {
  createSimulationState,
  MAX_SIMULATION_TICKS,
  stepSimulation,
} from './simulation.ts';
import {
  EXPECTED_HOLD_STATE,
  EXPECTED_LIFT_STATE,
} from './fixtures/reference-replays.ts';

const track = createOvalTrack();
function raceAt(tick: number): RaceState {
  let race = createRacingState(track);
  while (race.simulation.tick < tick) race = stepRace(track, race, true);
  return race;
}

void test('loading and ready cannot move; all countdown ticks are stationary and unscored', () => {
  const loading = createRaceState();
  assert.equal(loading.phase, 'loading');
  assert.equal(stepRace(track, loading, true), loading);
  const ready = prepareRace(track, loading);
  assert.equal(ready.phase, 'ready');
  assert.equal(stepRace(track, ready, true), ready);
  let race = startRace(ready);
  assert.equal(race.phase, 'countdown');
  assert.equal(race.countdownTicksRemaining, COUNTDOWN_TICKS);
  for (let tick = 1; tick <= COUNTDOWN_TICKS; tick++) {
    race = stepRace(track, race, tick % 2 === 0);
    assert.equal(race.simulation.tick, 0);
    assert.deepEqual(race.simulation, createSimulationState());
    assert.equal(race.countdownTicksRemaining, COUNTDOWN_TICKS - tick);
    assert.equal(race.phase, tick === COUNTDOWN_TICKS ? 'racing' : 'countdown');
  }
  const scored = stepRace(track, race, true);
  assert.equal(scored.simulation.tick, 1);
  assert.ok(scored.simulation.distance > 0);
  assert.throws(() => startRace(loading), /ready/);
  assert.throws(() => prepareRace(track, ready), /loading/);
  assert.equal(
    stepRace(track, { ...startRace(ready), countdownTicksRemaining: 0 }, true)
      .phase,
    'abandoned'
  );
});

void test('hold-only completes all ordered gates, including runoff, exactly once with unchanged physics', () => {
  let race = createRacingState(track);
  let crossedOffRoad = false;
  let finishCount = 0;
  while (race.phase === 'racing') {
    const previous = race;
    race = stepRace(track, race, true);
    if (
      race.nextCheckpointIndex > previous.nextCheckpointIndex &&
      race.simulation.offRoad
    )
      crossedOffRoad = true;
    if (race.phase === 'finished') finishCount++;
  }
  assert.equal(race.phase, 'finished');
  assert.deepEqual(race.simulation, EXPECTED_HOLD_STATE);
  assert.equal(race.nextCheckpointIndex, track.checkpoints.length);
  assert.deepEqual(
    race.checkpointTicks,
    [343, 515, 667, 812, 1048, 1397, 1570, 1722]
  );
  assert.equal(
    crossedOffRoad,
    true,
    'runoff gates preserve recoverable mistakes'
  );
  assert.equal(finishCount, 1);
  assert.equal(stepRace(track, race, true), race);
  assert.equal(
    abandonRace(race, 'focus'),
    race,
    'a completed result is terminal'
  );
});

void test('single-lift fixture keeps its existing numerical score under lap validation', () => {
  let race = createRacingState(track);
  while (race.phase === 'racing') {
    const tick = race.simulation.tick;
    race = stepRace(track, race, tick < 800 || tick >= 860);
  }
  assert.equal(race.phase, 'finished');
  assert.deepEqual(race.simulation, EXPECTED_LIFT_STATE);
  assert.equal(race.checkpointTicks.length, track.checkpoints.length);
});

void test('teleports, reverse progress, duplicated ticks and partial finishes cannot pass lap guards', () => {
  const race = raceAt(600);
  const previous = race.simulation;
  const next = stepSimulation(track, previous, true);
  for (const invalid of [
    { ...next, distance: next.distance + 10 },
    { ...next, distance: previous.distance - 0.001 },
    { ...next, distance: next.distance + 0.01 },
    { ...next, tick: previous.tick },
    { ...next, distance: NaN },
    { ...next, distance: track.totalLength + 1 },
  ])
    assert.throws(() => advanceLapProgress(track, race, previous, invalid));
  assert.throws(
    () =>
      advanceLapProgress(track, race, previous, {
        ...next,
        status: 'finished',
        finishedTick: next.tick,
      }),
    /Partial circuit/
  );
  assert.throws(
    () =>
      advanceLapProgress(
        track,
        race,
        { ...previous, recovering: true, recoveryTicksRemaining: 1 },
        next
      ),
    /forward movement/
  );
  const fabricatedStart = { ...createSimulationState(), distance: 1 };
  const fabricatedNext = stepSimulation(track, fabricatedStart, true);
  assert.throws(
    () =>
      advanceLapProgress(
        track,
        { nextCheckpointIndex: 0, checkpointTicks: [] },
        fabricatedStart,
        fabricatedNext
      ),
    /initial conditions/
  );
});

void test('skipped, fabricated or malformed checkpoint claims cannot finish', () => {
  const race = raceAt(600);
  const next = stepSimulation(track, race.simulation, true);
  assert.ok(race.nextCheckpointIndex > 0);
  assert.throws(
    () =>
      advanceLapProgress(
        track,
        { nextCheckpointIndex: 0, checkpointTicks: [] },
        race.simulation,
        next
      ),
    /Skipped/
  );
  assert.throws(
    () =>
      advanceLapProgress(
        track,
        {
          nextCheckpointIndex: track.checkpoints.length,
          checkpointTicks: track.checkpoints.map(() => 1),
        },
        race.simulation,
        next
      ),
    /fabricated/
  );
  assert.throws(
    () =>
      advanceLapProgress(
        track,
        { ...race, checkpointTicks: [] },
        race.simulation,
        next
      ),
    /checkpoint progress/
  );
  assert.throws(
    () =>
      advanceLapProgress(
        track,
        {
          ...race,
          checkpointTicks: race.checkpointTicks.map(
            () => race.simulation.tick + 1
          ),
        },
        race.simulation,
        next
      ),
    /split ticks/
  );
  const abandoned = stepRace(
    track,
    { ...race, nextCheckpointIndex: 0, checkpointTicks: [] },
    true
  );
  assert.equal(abandoned.phase, 'abandoned');
  assert.equal(abandoned.abandonReason, 'invalid-progress');
  assert.equal(
    abandoned.simulation,
    race.simulation,
    'invalid progress is never committed'
  );
});

void test('recovery consumes time without advancing gates or course distance', () => {
  const race = raceAt(600);
  const displaced = {
    ...race,
    simulation: { ...race.simulation, lateralOffset: 13, lateralVelocity: 0 },
  };
  let recovering = stepRace(track, displaced, true);
  assert.equal(recovering.simulation.recovering, true);
  const stoppedDistance = displaced.simulation.distance;
  const initialTick = displaced.simulation.tick;
  while (recovering.simulation.recovering) {
    assert.equal(recovering.phase, 'racing');
    assert.equal(recovering.simulation.distance, stoppedDistance);
    assert.equal(recovering.nextCheckpointIndex, displaced.nextCheckpointIndex);
    recovering = stepRace(track, recovering, true);
  }
  assert.equal(recovering.simulation.tick - initialTick, 120);
  assert.equal(recovering.simulation.distance, stoppedDistance);
  assert.equal(recovering.simulation.lateralOffset, 0);
  assert.equal(recovering.phase, 'racing');
});

void test('interruptions abandon safely and retries have fresh timing, gates and simulation', () => {
  for (const phase of [
    prepareRace(track),
    startRace(prepareRace(track)),
    raceAt(600),
  ]) {
    const abandoned = abandonRace(phase, 'focus');
    assert.equal(abandoned.phase, 'abandoned');
    assert.equal(abandoned.abandonReason, 'focus');
    assert.equal(stepRace(track, abandoned, true), abandoned);
    assert.equal(abandonRace(abandoned, 'frame-gap'), abandoned);
    assert.throws(() => startRace(abandoned), /ready/);
  }
  const retry = startRace(prepareRace(track));
  assert.deepEqual(retry.simulation, createSimulationState());
  assert.deepEqual(retry.checkpointTicks, []);
  assert.equal(retry.nextCheckpointIndex, 0);
  assert.equal(retry.countdownTicksRemaining, COUNTDOWN_TICKS);
  const timedOut = stepRace(
    track,
    {
      ...raceAt(600),
      simulation: { ...raceAt(600).simulation, tick: MAX_SIMULATION_TICKS },
    },
    false
  );
  assert.equal(timedOut.phase, 'abandoned');
  assert.equal(timedOut.abandonReason, 'time-limit');
});
