import type { SimulationState } from '../shared/simulation';

/** Explain visible losses of speed or grip, never predict a corner or alter input. */
export function drivingCue(
  state: SimulationState,
  held: boolean,
  racing: boolean,
  drifting: boolean
): string {
  if (!racing || drifting || state.speed < 3 || state.vertical?.airborne)
    return '';
  if (state.recovering) return 'Returning to track';
  if (state.offRoad) return 'Grass slows you';
  if (state.slip > 0.35) return 'Sliding';
  return held ? '' : 'Braking';
}
