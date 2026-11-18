import { stepElevatedSimulationV7 } from './elevated-simulation-v7.ts';
import type { SimulationState } from './simulation.ts';
import type { Track } from './track.ts';

/** A forgiving reaction window after GO, expressed only in authoritative ticks. */
export const START_BOOST_WINDOW_TICKS = 36;
export const START_BOOST_SPEED = 4;
export const supportsStartBoost = (track: Track): boolean =>
  track.schemaVersion === 2 && track.generatorVersion === 'linked-circuits-v3';

/**
 * V8 keeps v7 handling immutable. The first scored press earns one small launch
 * impulse only on ticks 1–36. Held at GO, late, and repeated presses are ordinary
 * throttle: no penalty, no stacked boosts, no countdown/client timing claims.
 */
export function stepStartBoostSimulation(
  track: Track,
  state: SimulationState,
  held: boolean,
  practiceDriftSeconds?: number
): SimulationState {
  const firstThrottleTick = state.firstThrottleTick ?? null;
  const award =
    firstThrottleTick === null &&
    held &&
    state.tick >= 1 &&
    state.tick <= START_BOOST_WINDOW_TICKS;
  const next = stepElevatedSimulationV7(
    track,
    award ? { ...state, speed: state.speed + START_BOOST_SPEED } : state,
    held,
    practiceDriftSeconds
  );
  return {
    ...next,
    firstThrottleTick: firstThrottleTick ?? (held ? state.tick : null),
    startBoostTick: state.startBoostTick ?? (award ? state.tick : null),
  };
}
