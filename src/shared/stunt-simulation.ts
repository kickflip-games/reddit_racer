import {
  stepSimulation,
  SIMULATION_HZ,
  HANDLING,
  quantizeSimulation,
  type SimulationState,
} from './simulation.ts';
import { sampleTrack, type Track } from './track.ts';
import { jumpRoadHeight, type GapJump } from './stunt-course.ts';

export type Flight = { height: number; velocity: number; airborne: boolean };
export const createFlight = (): Flight => ({
  height: 0,
  velocity: 0,
  airborne: false,
});

/** Unranked stunt extension; existing ranked simulation and replay contract stay intact. */
export function stepStuntSimulation(
  track: Track,
  jumps: readonly GapJump[],
  state: SimulationState,
  flight: Flight,
  held: boolean,
  groundStep: typeof stepSimulation = stepSimulation
): { simulation: SimulationState; flight: Flight } {
  let next = groundStep(
    track,
    flight.airborne
      ? { ...state, lateralOffset: 0, lateralVelocity: 0 }
      : state,
    held
  );
  if (state.recovering)
    return {
      simulation: next,
      flight: {
        ...createFlight(),
        height: jumpRoadHeight(jumps, next.distance),
      },
    };
  const jump = jumps.find(
    (jump) =>
      (flight.airborne || state.distance <= jump.rampEnd) &&
      next.distance >= jump.takeoff
  );
  let flying = flight.airborne;
  let velocity = flight.velocity;
  let height = flight.height;
  if (
    jump &&
    !flying &&
    state.distance < jump.takeoff &&
    next.distance >= jump.takeoff
  ) {
    flying = true;
    height = jump.height;
    velocity = (next.speed * jump.height) / (jump.takeoff - jump.rampStart);
  }
  if (flying && jump) {
    // Ballistic flight: releasing the throttle in mid-air cannot brake the car.
    const speed = state.speed;
    next = {
      ...next,
      speed,
      distance: quantizeSimulation(state.distance + speed / SIMULATION_HZ),
      lateralOffset: quantizeSimulation(
        state.lateralOffset + state.lateralVelocity / SIMULATION_HZ
      ),
      lateralVelocity: state.lateralVelocity,
      slip: 0,
    };
    height = quantizeSimulation(
      height + velocity / SIMULATION_HZ - 9.81 / (2 * SIMULATION_HZ ** 2)
    );
    velocity = quantizeSimulation(velocity - 9.81 / SIMULATION_HZ);
    const surface = jumpRoadHeight(jumps, next.distance);
    const inGap = next.distance < jump.landing;
    const outside =
      Math.abs(next.lateralOffset) >
      sampleTrack(track, next.distance).halfWidth;
    if ((inGap && height <= 0) || (!inGap && height <= surface && outside)) {
      // Rescue to the landing after a miss, with a full stationary penalty.
      next = {
        ...next,
        distance: jump.landing,
        speed: 0,
        lateralOffset: 0,
        lateralVelocity: 0,
        slip: 0,
        offRoad: false,
        recovering: true,
        recoveryTicksRemaining: HANDLING.recoveryTicks,
        recoveryCount: state.recoveryCount + 1,
      };
      return {
        simulation: next,
        flight: { ...createFlight(), height: jump.height },
      };
    }
    if (!inGap && height <= surface)
      return {
        simulation: next,
        flight: { ...createFlight(), height: surface },
      };
    return {
      simulation: { ...next, offRoad: outside },
      flight: { height, velocity, airborne: true },
    };
  }
  return {
    simulation: next,
    flight: { ...createFlight(), height: jumpRoadHeight(jumps, next.distance) },
  };
}
