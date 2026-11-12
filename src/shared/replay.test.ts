import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPLAY_TRANSITIONS, runReplay, validateReplay } from './replay.ts';
import { MAX_SIMULATION_TICKS } from './simulation.ts';
import { HOLD_REPLAY, LIFT_REPLAY } from './fixtures/reference-replays.ts';
import { createOvalTrack } from './track-authoring.ts';

void test('replay decoding returns independent canonical events', () => {
  const decoded = validateReplay(JSON.parse(JSON.stringify(LIFT_REPLAY)));
  assert.deepEqual(decoded, LIFT_REPLAY);
  assert.notEqual(decoded.transitions, LIFT_REPLAY.transitions);
  const first = decoded.transitions[0];
  if (!first) throw new Error('Missing fixture input');
  first.tick = 1;
  assert.equal(LIFT_REPLAY.transitions[0]?.tick, 0);
});

void test('malformed fields, versions and forged result metadata are rejected', () => {
  for (const malformed of [
    null,
    [],
    {},
    { ...HOLD_REPLAY, schemaVersion: 2 },
    { ...HOLD_REPLAY, simulationVersion: 'future' },
    { ...HOLD_REPLAY, handlingVersion: 'faster-car' },
    { ...HOLD_REPLAY, time: 1 },
    { ...HOLD_REPLAY, userId: 'forged' },
    { ...HOLD_REPLAY, track: createOvalTrack() },
    { ...HOLD_REPLAY, endTick: NaN },
    { ...HOLD_REPLAY, endTick: Infinity },
    { ...HOLD_REPLAY, endTick: 0 },
    { ...HOLD_REPLAY, endTick: 10.5 },
    { ...HOLD_REPLAY, endTick: MAX_SIMULATION_TICKS + 1 },
  ])
    assert.throws(() => validateReplay(malformed));
});

void test('input transitions must be bounded, ordered, changing Boolean inputs', () => {
  for (const transitions of [
    null,
    [{ tick: -1, held: true }],
    [{ tick: 0.1, held: true }],
    [{ tick: 0, held: 1 }],
    [{ tick: 0, held: true, steering: 1 }],
    [{ tick: 0, held: false }],
    [
      { tick: 0, held: true },
      { tick: 0, held: false },
    ],
    [
      { tick: 1, held: true },
      { tick: 0, held: false },
    ],
    [
      { tick: 0, held: true },
      { tick: 1, held: true },
    ],
    [{ tick: HOLD_REPLAY.endTick, held: true }],
    Array.from({ length: MAX_REPLAY_TRANSITIONS + 1 }, (_, tick) => ({
      tick,
      held: tick % 2 === 0,
    })),
  ])
    assert.throws(() => validateReplay({ ...HOLD_REPLAY, transitions }));
});

void test('authoritative replay rejects incomplete and unused trailing data', () => {
  const track = createOvalTrack();
  assert.throws(
    () => runReplay(track, { ...HOLD_REPLAY, transitions: [] }),
    /did not complete/
  );
  assert.throws(
    () => runReplay(track, { ...HOLD_REPLAY, endTick: 100 }),
    /did not complete/
  );
  assert.throws(
    () =>
      runReplay(track, { ...HOLD_REPLAY, endTick: HOLD_REPLAY.endTick + 1 }),
    /after the authoritative finish/
  );
  assert.throws(
    () =>
      runReplay(track, {
        ...HOLD_REPLAY,
        endTick: HOLD_REPLAY.endTick + 2,
        transitions: [
          ...HOLD_REPLAY.transitions,
          { tick: HOLD_REPLAY.endTick + 1, held: false },
        ],
      }),
    /after the authoritative finish/
  );
});
