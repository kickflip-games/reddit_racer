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
export const CENTRELINE_HANDLING: Handling = Object.freeze({
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
export const ELEVATED_HANDLING: Handling = Object.freeze({
  ...CENTRELINE_HANDLING,
  offRoadDrag: 1.25,
});
export const ROAD_FINISH_HANDLING: Handling = Object.freeze({
  ...ELEVATED_HANDLING,
  offRoadDrag: 3,
});
export const ELEVATED_SIMULATION_VERSION = 'fixed-step-v6';
export const ELEVATED_HANDLING_VERSION = 'progressive-slip-v1';
export const FLIGHT_GRAVITY = 11.5;

const flatRuntime = Object.freeze({
  simulationVersion: 'fixed-step-v2',
  handlingVersion: 'arcade-v1',
  simulationHz: 120,
  handling: LEGACY_HANDLING,
});
const centrelineRuntime = Object.freeze({
  simulationVersion: 'fixed-step-v4',
  handlingVersion: 'centreline-v1',
  simulationHz: 120,
  handling: CENTRELINE_HANDLING,
});
const priorElevatedRuntime = Object.freeze({
  simulationVersion: 'fixed-step-v5',
  handlingVersion: ELEVATED_HANDLING_VERSION,
  simulationHz: 120,
  handling: ELEVATED_HANDLING,
});
const elevatedRuntime = Object.freeze({
  simulationVersion: ELEVATED_SIMULATION_VERSION,
  handlingVersion: ELEVATED_HANDLING_VERSION,
  simulationHz: 120,
  handling: ELEVATED_HANDLING,
});
const roadFinishRuntime = Object.freeze({
  ...elevatedRuntime,
  simulationVersion: 'fixed-step-v7',
  handlingVersion: 'road-finish-v1',
  handling: ROAD_FINISH_HANDLING,
});
const startBoostRuntime = Object.freeze({
  ...roadFinishRuntime,
  simulationVersion: 'fixed-step-v8',
  handlingVersion: 'timed-start-v1',
});
const countdownLaunchRuntime = Object.freeze({
  ...roadFinishRuntime,
  simulationVersion: 'fixed-step-v9',
  handlingVersion: 'countdown-start-v1',
});
export type ScoredRuntime =
  | typeof flatRuntime
  | typeof elevatedRuntime
  | typeof centrelineRuntime
  | typeof priorElevatedRuntime
  | typeof roadFinishRuntime
  | typeof startBoostRuntime
  | typeof countdownLaunchRuntime;

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
    simulationVersion === centrelineRuntime.simulationVersion &&
    handlingVersion === centrelineRuntime.handlingVersion
  )
    return centrelineRuntime;
  if (
    simulationVersion === elevatedRuntime.simulationVersion &&
    handlingVersion === elevatedRuntime.handlingVersion
  )
    return elevatedRuntime;
  if (
    simulationVersion === priorElevatedRuntime.simulationVersion &&
    handlingVersion === priorElevatedRuntime.handlingVersion
  )
    return priorElevatedRuntime;
  if (
    simulationVersion === roadFinishRuntime.simulationVersion &&
    handlingVersion === roadFinishRuntime.handlingVersion
  )
    return roadFinishRuntime;
  if (
    simulationVersion === startBoostRuntime.simulationVersion &&
    handlingVersion === startBoostRuntime.handlingVersion
  )
    return startBoostRuntime;
  if (
    simulationVersion === countdownLaunchRuntime.simulationVersion &&
    handlingVersion === countdownLaunchRuntime.handlingVersion
  )
    return countdownLaunchRuntime;
  throw new Error('Unsupported scored runtime');
}
export function runtimeForTrack(track: Track): ScoredRuntime {
  if (
    track.schemaVersion === 2 &&
    (track.generatorVersion === 'linked-circuits-v4' ||
      track.generatorVersion === 'linked-circuits-v5')
  )
    return countdownLaunchRuntime;
  if (
    track.schemaVersion === 2 &&
    track.generatorVersion === 'linked-circuits-v3'
  )
    return startBoostRuntime;
  if (
    track.schemaVersion === 2 &&
    track.generatorVersion === 'linked-circuits-v2'
  )
    return roadFinishRuntime;
  if (track.schemaVersion === 1) return flatRuntime;
  if (track.schemaVersion === 2)
    return track.generatorVersion === 'countryside-circuits-v1'
      ? centrelineRuntime
      : track.generatorVersion === 'other-tracks-v3' ||
          track.generatorVersion === 'linked-circuits-v1'
        ? elevatedRuntime
        : priorElevatedRuntime;
  throw new Error('Unsupported track runtime');
}
export const handlingForTrack = (track: Track): Handling =>
  runtimeForTrack(track).handling;
