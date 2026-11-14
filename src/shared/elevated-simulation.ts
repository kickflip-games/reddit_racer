import {
  ELEVATED_HANDLING as handling,
  FLIGHT_GRAVITY,
} from './scored-runtime.ts';
import { sampleTrack, type Track } from './track.ts';
import type { SimulationState } from './simulation.ts';

const hz = 120;
const q = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

/** Progressive lateral slip gives drivers time to lift; grass costs speed continuously. */
export function stepElevatedSimulation(
  track: Track,
  state: SimulationState,
  held: boolean
): SimulationState {
  const vertical = state.vertical;
  if (!vertical)
    throw new Error('An elevated race requires vertical initial conditions');
  const tick = state.tick + 1;
  const frame = sampleTrack(track, state.distance);
  if (state.recoveryTicksRemaining > 0) {
    const remaining = state.recoveryTicksRemaining - 1;
    return {
      ...state,
      tick,
      speed: q((state.speed * remaining) / state.recoveryTicksRemaining),
      lateralOffset: q(
        (state.lateralOffset * remaining) / state.recoveryTicksRemaining
      ),
      lateralVelocity: 0,
      offRoad: false,
      recovering: remaining > 0,
      recoveryTicksRemaining: remaining,
      cornerStress: 0,
      cornerPenaltyTicks: 0,
      slip: 0,
      vertical: {
        ...vertical,
        height: q(frame.y ?? 0),
        velocity: 0,
        airborne: false,
        impact: 0,
      },
    };
  }
  const grounded = !vertical.airborne;
  const runoff = Math.max(0, Math.abs(state.lateralOffset) - frame.halfWidth);
  // Blend the first metre of shoulder: no discontinuous penalty at the paint.
  const grass = Math.min(1, runoff);
  const drive = grounded
    ? held
      ? handling.acceleration
      : -handling.braking
    : 0;
  const drag = grounded
    ? handling.rollingDrag * state.speed * state.speed +
      grass * handling.offRoadDrag * state.speed
    : state.speed * 0.035;
  const speed = q(
    Math.max(
      0,
      Math.min(
        handling.maximumSpeed,
        state.speed +
          (drive -
            drag -
            (grounded ? FLIGHT_GRAVITY * (frame.grade ?? 0) : 0)) /
            hz
      )
    )
  );
  const demand =
    (Math.abs(frame.curvature) * speed * speed) / handling.lateralGrip;
  const excess = Math.max(0, demand - 1) * handling.lateralGrip;
  const mobility = Math.min(1, speed / 3);
  const sideways = grounded
    ? (-Math.sign(frame.curvature) * excess -
        handling.centering * state.lateralOffset -
        handling.lateralDamping * state.lateralVelocity) *
      mobility
    : 0;
  const lateralVelocity = q(
    Math.max(
      -speed * 0.7,
      Math.min(speed * 0.7, state.lateralVelocity + sideways / hz)
    )
  );
  const lateralOffset = q(state.lateralOffset + lateralVelocity / hz);
  // Only extreme departures need rescue. A tyre over the edge is not a crash.
  if (
    Math.abs(lateralOffset) >
    frame.halfWidth + handling.recoveryDistanceBeyondEdge
  ) {
    return {
      ...state,
      tick,
      speed,
      lateralOffset,
      lateralVelocity: 0,
      slip: 1,
      offRoad: true,
      recovering: true,
      recoveryTicksRemaining: handling.recoveryTicks - 1,
      recoveryCount: state.recoveryCount + 1,
    };
  }
  let distance = Math.min(track.totalLength, q(state.distance + speed / hz));
  let next = sampleTrack(track, distance);
  let height = vertical.height,
    velocity = vertical.velocity,
    airborne = vertical.airborne;
  let landings = vertical.landings;
  let impact = q(vertical.impact * 0.92);
  const jump = track.jumps?.find(
    (j) => state.distance < j.landing && distance >= j.takeoff
  );
  const launch =
    grounded &&
    (jump !== undefined ||
      ((frame.verticalCurvature ?? 0) * speed * speed < -FLIGHT_GRAVITY &&
        height +
          ((frame.grade ?? 0) * speed) / hz -
          FLIGHT_GRAVITY / (2 * hz * hz) >
          (next.y ?? 0) + 0.00001));
  if (launch) {
    airborne = true;
    velocity = q((frame.grade ?? 0) * speed);
  }
  if (airborne) {
    height = q(height + velocity / hz - FLIGHT_GRAVITY / (2 * hz * hz));
    velocity = q(velocity - FLIGHT_GRAVITY / hz);
    const inGap = track.jumps?.find(
      (j) => distance >= j.takeoff && distance < j.landing
    );
    if (inGap && height <= 0.05) {
      distance = inGap.landing;
      next = sampleTrack(track, distance);
      return {
        ...state,
        tick,
        distance,
        speed: 0,
        lateralOffset: 0,
        lateralVelocity: 0,
        slip: 0,
        offRoad: false,
        recovering: true,
        recoveryTicksRemaining: 89,
        recoveryCount: state.recoveryCount + 1,
        cornerStress: 0,
        cornerPenaltyTicks: 0,
        vertical: {
          height: q(next.y ?? 0),
          velocity: 0,
          airborne: false,
          landings,
          impact: 0,
        },
      };
    }
    const relativeVelocity = velocity - (next.grade ?? 0) * speed;
    if (!inGap && height <= (next.y ?? 0) && relativeVelocity <= 0) {
      height = q(next.y ?? 0);
      airborne = false;
      velocity = q((next.grade ?? 0) * speed);
      landings++;
      impact = q(Math.min(1, Math.max(0, -relativeVelocity / 12)));
    }
  } else {
    height = q(next.y ?? 0);
    velocity = q((next.grade ?? 0) * speed);
  }
  const finished = distance >= track.totalLength;
  return {
    tick,
    distance,
    speed,
    lateralOffset,
    lateralVelocity,
    slip: grounded
      ? q(
          Math.max(
            (state.slip ?? 0) * 0.96,
            Math.min(1, Math.max(0, demand - 0.8))
          )
        )
      : 0,
    offRoad: Math.abs(lateralOffset) > next.halfWidth,
    recovering: false,
    recoveryTicksRemaining: 0,
    recoveryCount: state.recoveryCount,
    cornerStress: 0,
    cornerPenaltyTicks: 0,
    finishedTick: finished ? tick : null,
    status: finished ? 'finished' : 'running',
    vertical: { height, velocity, airborne, landings, impact },
  };
}
