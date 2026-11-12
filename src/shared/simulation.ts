import { sampleTrack } from './track.ts';
import type { Track } from './track.ts';

export const SIMULATION_HZ = 120;
export const SIMULATION_VERSION = 'fixed-step-v2';
export const HANDLING_VERSION = 'arcade-v1';
export const MAX_SIMULATION_TICKS = SIMULATION_HZ * 120;

/** Ranked handling is versioned, immutable and identical for every racer. */
export const HANDLING = Object.freeze({
  acceleration: 6.8,
  braking: 9.5,
  maximumSpeed: 22,
  rollingDrag: 0.015,
  lateralGrip: 7.8,
  centering: 1,
  lateralDamping: 2.5,
  offRoadDrag: 3,
  recoveryDistanceBeyondEdge: 8,
  recoveryTicks: SIMULATION_HZ,
});

export type SimulationState = {
  /** Tick counts completed fixed updates. An input at tick 0 affects update 0→1. */
  tick: number;
  distance: number;
  speed: number;
  lateralOffset: number;
  lateralVelocity: number;
  /** Normalised excess traction demand, clamped to [0, 1], for presentation. */
  slip: number;
  offRoad: boolean;
  recovering: boolean;
  recoveryTicksRemaining: number;
  recoveryCount: number;
  finishedTick: number | null;
  status: 'running' | 'finished';
};

/** Round state to micrometre-scale units after every fixed update. */
export const quantizeSimulation = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

export function createSimulationState(): SimulationState {
  return {
    tick: 0,
    distance: 0,
    speed: 0,
    lateralOffset: 0,
    lateralVelocity: 0,
    slip: 0,
    offRoad: false,
    recovering: false,
    recoveryTicksRemaining: 0,
    recoveryCount: 0,
    finishedTick: null,
    status: 'running',
  };
}

/**
 * One authoritative 1/120-second update. Input is one Boolean; dt is never supplied.
 * State and track must originate from this module and validated canonical data.
 */
export function stepSimulation(
  track: Track,
  state: SimulationState,
  held: boolean
): SimulationState {
  if (typeof held !== 'boolean')
    throw new Error('Accelerator input must be Boolean');
  if (state.status === 'finished') return state;
  if (state.tick >= MAX_SIMULATION_TICKS)
    throw new Error('Simulation duration limit exceeded');
  const tick = state.tick + 1;
  const frame = sampleTrack(track, state.distance);
  const halfWidth = quantizeSimulation(frame.halfWidth);
  if (state.recoveryTicksRemaining > 0) {
    const remaining = state.recoveryTicksRemaining - 1;
    const proportion = remaining / state.recoveryTicksRemaining;
    const lateralOffset = quantizeSimulation(state.lateralOffset * proportion);
    return {
      ...state,
      tick,
      // A recovery consumes ticks without moving along the course.
      distance: state.distance,
      speed: quantizeSimulation(state.speed * proportion),
      lateralOffset,
      lateralVelocity: 0,
      slip: 0,
      offRoad: Math.abs(lateralOffset) > halfWidth,
      recovering: remaining > 0,
      recoveryTicksRemaining: remaining,
    };
  }

  const offRoad = Math.abs(state.lateralOffset) > halfWidth;
  const driveAcceleration = held ? HANDLING.acceleration : -HANDLING.braking;
  const surfaceDrag = offRoad ? HANDLING.offRoadDrag * state.speed : 0;
  const rollingDrag = HANDLING.rollingDrag * state.speed * state.speed;
  const speed = quantizeSimulation(
    Math.max(
      0,
      Math.min(
        HANDLING.maximumSpeed,
        state.speed +
          (driveAcceleration - rollingDrag - surfaceDrag) / SIMULATION_HZ
      )
    )
  );

  // Curvature is signed; insufficient grip accelerates the car toward the outside.
  const curvature = quantizeSimulation(frame.curvature);
  const excessDemand = Math.max(
    0,
    Math.abs(curvature) * speed * speed - HANDLING.lateralGrip
  );
  const outwardAcceleration = -Math.sign(curvature) * excessDemand;
  const lateralAcceleration =
    outwardAcceleration -
    HANDLING.centering * state.lateralOffset -
    HANDLING.lateralDamping * state.lateralVelocity;
  const lateralVelocity = quantizeSimulation(
    state.lateralVelocity + lateralAcceleration / SIMULATION_HZ
  );
  const lateralOffset = quantizeSimulation(
    state.lateralOffset + lateralVelocity / SIMULATION_HZ
  );
  const slip = quantizeSimulation(
    Math.min(1, excessDemand / HANDLING.lateralGrip)
  );

  if (
    Math.abs(lateralOffset) >
    halfWidth + HANDLING.recoveryDistanceBeyondEdge
  ) {
    // The triggering update is the first of exactly recoveryTicks stationary ticks.
    return {
      ...state,
      tick,
      distance: state.distance,
      speed,
      lateralOffset,
      lateralVelocity: 0,
      slip: 0,
      offRoad: true,
      recovering: true,
      recoveryTicksRemaining: HANDLING.recoveryTicks - 1,
      recoveryCount: state.recoveryCount + 1,
    };
  }

  const distance = Math.min(
    track.totalLength,
    quantizeSimulation(state.distance + speed / SIMULATION_HZ)
  );
  const finished = distance >= track.totalLength;
  const nextFrame = sampleTrack(track, distance);
  return {
    tick,
    distance,
    speed,
    lateralOffset,
    lateralVelocity,
    slip,
    offRoad: Math.abs(lateralOffset) > quantizeSimulation(nextFrame.halfWidth),
    recovering: false,
    recoveryTicksRemaining: 0,
    recoveryCount: state.recoveryCount,
    finishedTick: finished ? tick : null,
    status: finished ? 'finished' : 'running',
  };
}
