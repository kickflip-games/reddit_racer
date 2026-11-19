import {
  runtimeForTrack,
  scoredRuntime,
  type ScoredRuntime,
} from './scored-runtime.ts';
import { MAX_SIMULATION_TICKS } from './simulation.ts';
import type { SimulationState } from './simulation.ts';
import {
  COUNTDOWN_TICKS,
  createRacingState,
  prepareRace,
  raceInputTick,
  startRace,
  stepRace,
} from './race-rules.ts';
import type { Track } from './track.ts';

export const MAX_REPLAY_TRANSITIONS = 2400;

export type ReplayTransition = { tick: number; held: boolean };
export type Replay = {
  /** V2 includes negative countdown ticks; V1 remains unchanged for saved runs. */
  schemaVersion: 1 | 2;
  simulationVersion: ScoredRuntime['simulationVersion'];
  handlingVersion: ScoredRuntime['handlingVersion'];
  transitions: ReplayTransition[];
  /** Exact number of updates recorded, never an authoritative submitted lap time. */
  endTick: number;
};
export type ReplayResult = { state: SimulationState; finishTicks: number };

export const replaySchemaForTrack = (track: Track): Replay['schemaVersion'] =>
  runtimeForTrack(track).simulationVersion === 'fixed-step-v9' ? 2 : 1;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Parse bounded, strictly ordered input data; no supplied time/user/track is accepted. */
export function validateReplay(value: unknown): Replay {
  if (
    !record(value) ||
    !exactKeys(value, [
      'schemaVersion',
      'simulationVersion',
      'handlingVersion',
      'transitions',
      'endTick',
    ])
  ) {
    throw new Error('Replay has missing or unknown fields');
  }
  const runtime = scoredRuntime(value.simulationVersion, value.handlingVersion);
  const expectedSchema = runtime.simulationVersion === 'fixed-step-v9' ? 2 : 1;
  if (
    (value.schemaVersion !== 1 && value.schemaVersion !== 2) ||
    value.schemaVersion !== expectedSchema
  )
    throw new Error('Replay version mismatch');
  const endTick = value.endTick;
  if (
    typeof endTick !== 'number' ||
    !Number.isInteger(endTick) ||
    endTick < 1 ||
    endTick > MAX_SIMULATION_TICKS
  ) {
    throw new Error('Replay duration must be 1–14400 integer ticks');
  }
  if (
    !Array.isArray(value.transitions) ||
    value.transitions.length > MAX_REPLAY_TRANSITIONS
  ) {
    throw new Error('Replay transition limit exceeded');
  }
  const firstTick = value.schemaVersion === 2 ? -COUNTDOWN_TICKS : 0;
  let previousTick = firstTick - 1;
  let previousHeld = false;
  const transitions = value.transitions.map(
    (transition: unknown): ReplayTransition => {
      if (!record(transition) || !exactKeys(transition, ['tick', 'held'])) {
        throw new Error('Replay transition has missing or unknown fields');
      }
      const { tick, held } = transition;
      if (
        typeof tick !== 'number' ||
        !Number.isInteger(tick) ||
        tick < firstTick ||
        tick <= previousTick ||
        tick >= endTick ||
        typeof held !== 'boolean'
      ) {
        throw new Error(
          'Replay transitions must be ordered integer ticks with Boolean input'
        );
      }
      if (held === previousHeld)
        throw new Error('Replay contains redundant input transitions');
      previousTick = tick;
      previousHeld = held;
      return { tick, held };
    }
  );
  return {
    schemaVersion: value.schemaVersion,
    simulationVersion: runtime.simulationVersion,
    handlingVersion: runtime.handlingVersion,
    transitions,
    endTick,
  };
}

/** The shared simulator, never the client endTick, calculates the ranked result. */
export function runReplay(track: Track, value: unknown): ReplayResult {
  const replay = validateReplay(value);
  const expected = runtimeForTrack(track);
  if (
    replay.simulationVersion !== expected.simulationVersion ||
    replay.handlingVersion !== expected.handlingVersion
  )
    throw new Error('Replay does not match the track runtime');
  let race =
    replay.schemaVersion === 2
      ? startRace(prepareRace(track))
      : createRacingState(track);
  let held = false;
  let transitionIndex = 0;
  while (
    race.simulation.tick < replay.endTick &&
    (race.phase === 'countdown' || race.phase === 'racing')
  ) {
    const next = replay.transitions[transitionIndex];
    if (next && next.tick === raceInputTick(race)) {
      held = next.held;
      transitionIndex++;
    }
    race = stepRace(track, race, held);
  }
  if (race.phase === 'abandoned')
    throw new Error('Replay violated race progress rules');
  const state = race.simulation;
  if (race.phase !== 'finished' || state.finishedTick === null)
    throw new Error('Replay did not complete the circuit');
  if (
    state.finishedTick !== replay.endTick ||
    transitionIndex !== replay.transitions.length
  ) {
    throw new Error('Replay contains data after the authoritative finish');
  }
  return { state, finishTicks: state.finishedTick };
}
