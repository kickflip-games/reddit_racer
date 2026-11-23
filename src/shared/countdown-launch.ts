import { stepElevatedSimulationV7 } from './elevated-simulation-v7.ts';
import type { SimulationState } from './simulation.ts';
import type { Track } from './track.ts';

/** Last 0.2 seconds of 2, then all of 1, at the shared 120 Hz countdown clock. */
export const COUNTDOWN_LAUNCH_WINDOW_TICKS = 144;
export const COUNTDOWN_LAUNCH_SPEED = 4;
export const supportsCountdownLaunch = (track: Track): boolean =>
  track.schemaVersion === 2 &&
  (track.generatorVersion === 'linked-circuits-v4' ||
    track.generatorVersion === 'linked-circuits-v5' ||
    track.generatorVersion === 'linked-circuits-v6');

export type CountdownLaunchInput = {
  held: boolean;
  /** Negative countdown tick of the most recent sampled rising edge. */
  pressTick: number | null;
};

export function sampleCountdownLaunch(
  previous: CountdownLaunchInput | undefined,
  held: boolean,
  tick: number
): CountdownLaunchInput {
  return {
    held,
    pressTick: held ? (previous?.held ? previous.pressTick : tick) : null,
  };
}

export function countdownLaunchArmed(input: CountdownLaunchInput): boolean {
  return (
    input.held &&
    input.pressTick !== null &&
    input.pressTick >= -COUNTDOWN_LAUNCH_WINDOW_TICKS &&
    input.pressTick < 0
  );
}

/** V9 adds one small impulse at green. Every missed window is ordinary throttle. */
export function stepCountdownLaunchSimulation(
  track: Track,
  state: SimulationState,
  held: boolean,
  practiceDriftSeconds?: number
): SimulationState {
  const award = state.tick === 0 && state.launchArmed === true && held;
  const next = stepElevatedSimulationV7(
    track,
    award ? { ...state, speed: state.speed + COUNTDOWN_LAUNCH_SPEED } : state,
    held,
    practiceDriftSeconds
  );
  return {
    ...next,
    launchArmed: false,
    firstThrottleTick: state.firstThrottleTick ?? (held ? state.tick : null),
    startBoostTick: state.startBoostTick ?? (award ? 0 : null),
  };
}
