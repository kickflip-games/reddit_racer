import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import {
  createRacingState,
  stepRace,
  advanceLapProgress,
} from '../../src/shared/race-rules.ts';
import {
  createSimulationState,
  stepSimulation,
} from '../../src/shared/simulation.ts';
import { runReplay, type ReplayTransition } from '../../src/shared/replay.ts';
import { runtimeForTrack } from '../../src/shared/scored-runtime.ts';

void test('a real slow approach can miss a gap, recover, finish and verify without an invalid-progress interruption', () => {
  const track = generateElevatedCircuit('country-1').track;
  let race = createRacingState(track),
    held = false,
    input = false,
    rescues = 0;
  const transitions: ReplayTransition[] = [];
  while (race.phase === 'racing' && race.simulation.tick < 14000) {
    const s = race.simulation;
    if (s.distance < 18 || s.recoveryCount > 0) input = true;
    else if (s.vertical?.airborne) input = false;
    else input = input ? s.speed < 4 : s.speed < 2;
    if (input !== held) {
      held = input;
      transitions.push({ tick: s.tick, held });
    }
    race = stepRace(track, race, held);
    assert.notEqual(
      race.phase,
      'abandoned',
      `run interrupted: ${race.abandonReason}`
    );
    if (race.simulation.recoveryCount > s.recoveryCount) rescues++;
  }
  assert.equal(rescues, 1);
  assert.equal(race.phase, 'finished');
  const runtime = runtimeForTrack(track);
  const result = runReplay(track, {
    schemaVersion: 1,
    simulationVersion: runtime.simulationVersion,
    handlingVersion: runtime.handlingVersion,
    transitions,
    endTick: race.simulation.tick,
  });
  assert.equal(result.finishTicks, race.simulation.finishedTick);
});
void test('a forged rescue cannot use a canonical gap to bypass authoritative progress checks', () => {
  const track = generateElevatedCircuit('country-1').track;
  const gap = track.jumps?.[0];
  assert.ok(gap);
  const previous = {
    ...createSimulationState(track),
    tick: 500,
    distance: gap.takeoff + 1,
    speed: 2,
    vertical: {
      height: 0.01,
      velocity: -4,
      airborne: true,
      landings: 0,
      impact: 0,
    },
  };
  const next = stepSimulation(track, previous, true);
  assert.equal(next.recovering, true);
  const progress = { nextCheckpointIndex: 0, checkpointTicks: [] };
  assert.doesNotThrow(() =>
    advanceLapProgress(track, progress, previous, next)
  );
  assert.throws(() =>
    advanceLapProgress(track, progress, previous, {
      ...next,
      distance: gap.landing + 1,
    })
  );
  assert.throws(() =>
    advanceLapProgress(track, progress, previous, {
      ...next,
      recoveryTicksRemaining: 1,
    })
  );
});
