import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countInputLifts,
  MAX_BRAKING_PEAKS,
  MAX_CONTROLLER_RUNS,
  searchDrivingInputs,
} from './driving-bots.ts';
import { generateCircuit, FALLBACK_CIRCUIT_SEED } from './circuit-generator.ts';
import { runReplay } from './replay.ts';
import { MAX_SIMULATION_TICKS } from './simulation.ts';

void test('meaningful input intervals exclude micro-taps and include the twelve-tick boundary', () => {
  const count = countInputLifts(
    [
      { tick: 0, held: true },
      { tick: 10, held: false },
      { tick: 11, held: true },
      { tick: 20, held: false },
      { tick: 31, held: true },
      { tick: 40, held: false },
      { tick: 52, held: true },
      { tick: 60, held: false },
    ],
    80
  );
  assert.deepEqual(count, { lifts: 4, meaningfulLifts: 2 });
});

void test('bots improve real race-model inputs within a fixed search budget and replay exactly', () => {
  const track = generateCircuit(FALLBACK_CIRCUIT_SEED).track;
  const search = searchDrivingInputs(track);
  assert.ok(search.hold.summary.finished);
  assert.ok(search.cautious.summary.finished);
  assert.ok(search.fast.summary.finished);
  assert.equal(search.hold.summary.finishTicks, 3318);
  assert.equal(search.fast.summary.finishTicks, 2848);
  assert.equal(search.fast.summary.meaningfulLifts, 3);
  assert.ok(search.peaks.length <= MAX_BRAKING_PEAKS);
  assert.ok(search.work.controllerRuns <= MAX_CONTROLLER_RUNS);
  assert.ok(
    search.work.simulatedTicks <= MAX_CONTROLLER_RUNS * MAX_SIMULATION_TICKS
  );
  for (const run of [search.hold, search.cautious, search.fast])
    assert.equal(
      runReplay(track, run.replay).finishTicks,
      run.summary.finishTicks
    );
  assert.deepEqual(
    searchDrivingInputs(track),
    search,
    'policy/search order is deterministic'
  );
});
