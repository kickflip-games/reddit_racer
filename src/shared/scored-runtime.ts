import type { Track } from './track.ts';

export type Handling = Readonly<{
  acceleration: number;
  braking: number;
  maximumSpeed: number;
  rollingDrag: number;
  lateralGrip: number;
  centering: number;
  lateralDamping: number;
  offRoadDrag: number;
  recoveryDistanceBeyondEdge: number;
  recoveryTicks: number;
}>;

// Retained forever for already accepted flat circuits and their recorded replays.
export const LEGACY_HANDLING: Handling = Object.freeze({
  acceleration: 6.8,
  braking: 9.5,
  maximumSpeed: 22,
  rollingDrag: 0.015,
  lateralGrip: 7.8,
  centering: 1,
  lateralDamping: 2.5,
  offRoadDrag: 3,
  recoveryDistanceBeyondEdge: 8,
  recoveryTicks: 120,
});
export const ELEVATED_HANDLING: Handling = Object.freeze({
  acceleration: 11.5,
  braking: 13.5,
  maximumSpeed: 30,
  rollingDrag: 0.008,
  lateralGrip: 10.2,
  centering: 1.4,
  lateralDamping: 2.8,
  offRoadDrag: 2.6,
  recoveryDistanceBeyondEdge: 8,
  recoveryTicks: 120,
});
export const ELEVATED_SIMULATION_VERSION = 'fixed-step-v4';
export const ELEVATED_HANDLING_VERSION = 'centreline-v1';
export const FLIGHT_GRAVITY = 11.5;

const flatRuntime = Object.freeze({
  simulationVersion: 'fixed-step-v2',
  handlingVersion: 'arcade-v1',
  simulationHz: 120,
  handling: LEGACY_HANDLING,
});
const elevatedRuntime = Object.freeze({
  simulationVersion: ELEVATED_SIMULATION_VERSION,
  handlingVersion: ELEVATED_HANDLING_VERSION,
  simulationHz: 120,
  handling: ELEVATED_HANDLING,
});
export type ScoredRuntime = typeof flatRuntime | typeof elevatedRuntime;

export function scoredRuntime(
  simulationVersion: unknown,
  handlingVersion: unknown,
  hz: unknown = 120
): ScoredRuntime {
  if (hz !== 120) throw new Error('Unsupported simulation frequency');
  if (
    simulationVersion === flatRuntime.simulationVersion &&
    handlingVersion === flatRuntime.handlingVersion
  )
    return flatRuntime;
  if (
    simulationVersion === elevatedRuntime.simulationVersion &&
    handlingVersion === elevatedRuntime.handlingVersion
  )
    return elevatedRuntime;
  throw new Error('Unsupported scored runtime');
}
export function runtimeForTrack(track: Track): ScoredRuntime {
  if (track.schemaVersion === 1) return flatRuntime;
  if (track.schemaVersion === 2) return elevatedRuntime;
  throw new Error('Unsupported track runtime');
}
export const handlingForTrack = (track: Track): Handling =>
  runtimeForTrack(track).handling;
