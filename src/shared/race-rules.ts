import { handlingForTrack, ROAD_FINISH_HANDLING } from './scored-runtime.ts';
import {
  countdownLaunchArmed,
  sampleCountdownLaunch,
  supportsCountdownLaunch,
  type CountdownLaunchInput,
} from './countdown-launch.ts';
import {
  createSimulationState,
  createVerticalState,
  MAX_SIMULATION_TICKS,
  quantizeSimulation,
  SIMULATION_HZ,
  stepSimulation,
} from './simulation.ts';
import type { SimulationState } from './simulation.ts';
import { validateTrack } from './track.ts';
import type { Track } from './track.ts';

export const COUNTDOWN_TICKS = SIMULATION_HZ * 3;
export type RacePhase =
  'loading' | 'ready' | 'countdown' | 'racing' | 'finished' | 'abandoned';
export type RaceAbandonReason =
  | 'focus'
  | 'frame-gap'
  | 'input-limit'
  | 'time-limit'
  | 'invalid-progress'
  | 'cancelled';
export type LapProgress = {
  nextCheckpointIndex: number;
  checkpointTicks: number[];
};
export type RaceState = LapProgress & {
  phase: RacePhase;
  simulation: SimulationState;
  countdownTicksRemaining: number;
  abandonReason: RaceAbandonReason | null;
  countdownLaunchInput?: CountdownLaunchInput;
};

/** Schema-2 input tapes include stationary countdown ticks -360 through -1. */
export const raceInputTick = (state: Readonly<RaceState>): number =>
  state.phase === 'countdown'
    ? -state.countdownTicksRemaining
    : state.simulation.tick;

const progressTolerance = 0.000000001;

export function createRaceState(): RaceState {
  return {
    phase: 'loading',
    simulation: createSimulationState(),
    countdownTicksRemaining: 0,
    nextCheckpointIndex: 0,
    checkpointTicks: [],
    abandonReason: null,
  };
}

/** Track acceptance is explicit; loading and ready states never run physics. */
export function prepareRace(
  track: Track,
  state: RaceState = createRaceState()
): RaceState {
  if (state.phase !== 'loading')
    throw new Error('Only a loading race can become ready');
  validateTrack(track);
  return {
    ...createRaceState(),
    simulation: createSimulationState(track),
    phase: 'ready',
  };
}

export function startRace(state: RaceState): RaceState {
  if (state.phase !== 'ready') throw new Error('Only a ready race can start');
  return {
    ...createRaceState(),
    phase: 'countdown',
    simulation: {
      ...createSimulationState(),
      ...(state.simulation.vertical ? { vertical: createVerticalState() } : {}),
    },
    countdownTicksRemaining: COUNTDOWN_TICKS,
  };
}

/** Verifiers create identical fresh scored conditions, excluding the UI-only countdown. */
export function createRacingState(track: Track): RaceState {
  return { ...prepareRace(track), phase: 'racing' };
}

export function abandonRace(
  state: RaceState,
  reason: RaceAbandonReason
): RaceState {
  if (state.phase === 'finished' || state.phase === 'abandoned') return state;
  return { ...state, phase: 'abandoned', abandonReason: reason };
}

function validateSimulationFields(track: Track, state: SimulationState): void {
  const HANDLING = handlingForTrack(track);
  if (track.schemaVersion === 2) {
    const v = state.vertical;
    if (
      !v ||
      ![v.height, v.velocity, v.landings, v.impact].every(Number.isFinite) ||
      v.height < -5 ||
      v.height > 30 ||
      Math.abs(v.velocity) > 40 ||
      typeof v.airborne !== 'boolean' ||
      !Number.isInteger(v.landings) ||
      v.landings < 0 ||
      v.impact < 0 ||
      v.impact > 1
    )
      throw new Error('Invalid vertical racing state');
  }
  for (const value of [
    state.tick,
    state.distance,
    state.speed,
    state.lateralOffset,
    state.lateralVelocity,
    state.slip,
    state.recoveryTicksRemaining,
    state.recoveryCount,
  ]) {
    if (!Number.isFinite(value))
      throw new Error('Race progress contains nonfinite state');
  }
  if (
    !Number.isInteger(state.tick) ||
    state.tick < 0 ||
    state.tick > MAX_SIMULATION_TICKS ||
    state.speed < 0 ||
    state.speed > HANDLING.maximumSpeed ||
    state.slip < 0 ||
    state.slip > 1
  ) {
    throw new Error('Race progress contains invalid state bounds');
  }
  if (
    typeof state.offRoad !== 'boolean' ||
    typeof state.recovering !== 'boolean' ||
    !Number.isInteger(state.recoveryTicksRemaining) ||
    state.recoveryTicksRemaining < 0 ||
    state.recoveryTicksRemaining >= HANDLING.recoveryTicks ||
    state.recovering !== state.recoveryTicksRemaining > 0 ||
    !Number.isInteger(state.recoveryCount) ||
    state.recoveryCount < 0
  ) {
    throw new Error('Race progress contains invalid recovery state');
  }
}

/**
 * Guard the scored trajectory, then cross ordered arc-distance sector gates.
 * Gates span runoff: a mild off-road mistake must not strand a one-button car.
 */
export function advanceLapProgress(
  track: Track,
  progress: LapProgress,
  previous: SimulationState,
  next: SimulationState,
  allowRoadFinishRecovery = true
): LapProgress {
  const HANDLING = handlingForTrack(track);
  validateSimulationFields(track, previous);
  validateSimulationFields(track, next);
  if (
    previous.status !== 'running' ||
    previous.finishedTick !== null ||
    next.tick !== previous.tick + 1
  ) {
    throw new Error(
      'Race ticks must advance exactly once from a running state'
    );
  }
  if (
    previous.distance < 0 ||
    previous.distance >= track.totalLength ||
    next.distance < 0 ||
    next.distance > track.totalLength
  ) {
    throw new Error('Race distance is outside the complete circuit');
  }
  const delta = next.distance - previous.distance;
  // A missed canonical gap has one legitimate forward rescue. Recompute the
  // entire authoritative snapshot, so declaring a recovery cannot admit a
  // forged teleport, skipped penalty, fabricated height or momentum change.
  const gapRecovery =
    track.schemaVersion === 2 &&
    !previous.recovering &&
    previous.vertical?.airborne === true &&
    next.recovering &&
    next.recoveryCount === previous.recoveryCount + 1 &&
    track.jumps?.some(
      (jump) =>
        previous.distance >= jump.takeoff &&
        previous.distance < jump.landing &&
        next.distance === jump.landing
    ) === true &&
    [false, true].some(
      (held) =>
        JSON.stringify(stepSimulation(track, previous, held)) ===
        JSON.stringify(next)
    );
  if (delta < -progressTolerance)
    throw new Error('Reverse race progress is invalid');
  if (
    !gapRecovery &&
    delta > HANDLING.maximumSpeed / SIMULATION_HZ + 0.000002
  ) {
    throw new Error('Race progress jump exceeds one legal tick');
  }
  const stationaryRecovery = previous.recovering || next.recovering;
  const expectedDistance = gapRecovery
    ? next.distance
    : stationaryRecovery
      ? previous.distance
      : Math.min(
          track.totalLength,
          quantizeSimulation(previous.distance + next.speed / SIMULATION_HZ)
        );
  // Road-finish runtimes keep an off-road or airborne car just short of the
  // line so it can rejoin the road and finish without losing the attempt.
  const cappedRoadFinish =
    allowRoadFinishRecovery &&
    !stationaryRecovery &&
    HANDLING === ROAD_FINISH_HANDLING &&
    expectedDistance === track.totalLength &&
    next.distance === track.totalLength - 0.000001 &&
    (next.offRoad || next.vertical?.airborne === true) &&
    next.status === 'running' &&
    next.finishedTick === null;
  if (
    !cappedRoadFinish &&
    Math.abs(next.distance - expectedDistance) > progressTolerance
  ) {
    throw new Error(
      'Race progress does not match authoritative forward movement'
    );
  }
  if (
    previous.tick === 0 &&
    (previous.distance !== 0 ||
      previous.speed !== 0 ||
      previous.lateralOffset !== 0 ||
      previous.lateralVelocity !== 0 ||
      previous.recoveryCount !== 0)
  ) {
    throw new Error('Race did not begin from identical initial conditions');
  }

  let nextCheckpointIndex = progress.nextCheckpointIndex;
  if (
    !Number.isInteger(nextCheckpointIndex) ||
    nextCheckpointIndex < 0 ||
    nextCheckpointIndex > track.checkpoints.length ||
    progress.checkpointTicks.length !== nextCheckpointIndex
  ) {
    throw new Error('Invalid checkpoint progress');
  }
  let previousSplitTick = 0;
  for (const split of progress.checkpointTicks) {
    if (
      !Number.isInteger(split) ||
      split < 1 ||
      split < previousSplitTick ||
      split > previous.tick
    ) {
      throw new Error('Invalid checkpoint split ticks');
    }
    previousSplitTick = split;
  }
  const lastGate = track.checkpoints[nextCheckpointIndex - 1];
  const nextGate = track.checkpoints[nextCheckpointIndex];
  if (
    (lastGate && lastGate.s > previous.distance) ||
    (nextGate && nextGate.s <= previous.distance)
  ) {
    throw new Error('Skipped or fabricated checkpoint progress');
  }
  let checkpointTicks = progress.checkpointTicks;
  while (nextCheckpointIndex < track.checkpoints.length) {
    const checkpoint = track.checkpoints[nextCheckpointIndex];
    if (!checkpoint || checkpoint.s > next.distance) break;
    checkpointTicks = [...checkpointTicks, next.tick];
    nextCheckpointIndex++;
  }
  if (next.distance === track.totalLength) {
    if (
      nextCheckpointIndex !== track.checkpoints.length ||
      next.status !== 'finished' ||
      next.finishedTick !== next.tick
    ) {
      throw new Error(
        'Finish requires every checkpoint and a complete authoritative lap'
      );
    }
  } else if (next.status !== 'running' || next.finishedTick !== null) {
    throw new Error('Partial circuit cannot finish');
  }
  return { nextCheckpointIndex, checkpointTicks };
}

export function stepRace(
  track: Track,
  state: RaceState,
  held: boolean
): RaceState {
  return stepRaceWithProgressRules(track, state, held, true);
}

/** Preserve first-finisher candidate selection for every authored course version. */
export function stepCourseQualityRace(
  track: Track,
  state: RaceState,
  held: boolean
): RaceState {
  return stepRaceWithProgressRules(track, state, held, false);
}

function stepRaceWithProgressRules(
  track: Track,
  state: RaceState,
  held: boolean,
  allowRoadFinishRecovery: boolean
): RaceState {
  if (typeof held !== 'boolean')
    throw new Error('Accelerator input must be Boolean');
  if (
    state.phase === 'finished' ||
    state.phase === 'abandoned' ||
    state.phase === 'loading' ||
    state.phase === 'ready'
  )
    return state;
  if (state.phase === 'countdown') {
    if (
      !Number.isInteger(state.countdownTicksRemaining) ||
      state.countdownTicksRemaining < 1 ||
      state.countdownTicksRemaining > COUNTDOWN_TICKS ||
      state.simulation.tick !== 0 ||
      state.simulation.distance !== 0
    )
      return abandonRace(state, 'invalid-progress');
    const countdownTicksRemaining = state.countdownTicksRemaining - 1;
    const launchInput = supportsCountdownLaunch(track)
      ? sampleCountdownLaunch(
          state.countdownLaunchInput,
          held,
          raceInputTick(state)
        )
      : undefined;
    return {
      ...state,
      ...(launchInput
        ? {
            countdownLaunchInput: launchInput,
            simulation:
              countdownTicksRemaining === 0
                ? {
                    ...state.simulation,
                    launchArmed: countdownLaunchArmed(launchInput),
                  }
                : state.simulation,
          }
        : {}),
      countdownTicksRemaining,
      phase: countdownTicksRemaining === 0 ? 'racing' : 'countdown',
    };
  }
  if (state.simulation.tick >= MAX_SIMULATION_TICKS)
    return abandonRace(state, 'time-limit');
  let simulation: SimulationState;
  let progress: LapProgress;
  try {
    simulation = stepSimulation(track, state.simulation, held);
    progress = advanceLapProgress(
      track,
      state,
      state.simulation,
      simulation,
      allowRoadFinishRecovery
    );
  } catch {
    return abandonRace(state, 'invalid-progress');
  }
  return {
    ...state,
    ...progress,
    simulation,
    phase: simulation.status === 'finished' ? 'finished' : 'racing',
  };
}
