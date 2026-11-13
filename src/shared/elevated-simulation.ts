import {
  ELEVATED_HANDLING as handling,
  FLIGHT_GRAVITY,
} from './scored-runtime.ts';
import { sampleTrack, type Track } from './track.ts';
import type { SimulationState } from './simulation.ts';

const hz = 120;
const q = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

/** Authoritative ballistic flight on a stored height profile, using only fixed ticks. */
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
  const roadY = frame.y ?? 0;
  const halfWidth = q(frame.halfWidth);
  if (state.recoveryTicksRemaining > 0) {
    const remaining = state.recoveryTicksRemaining - 1;
    const proportion = remaining / state.recoveryTicksRemaining;
    const lateralOffset = q(state.lateralOffset * proportion);
    return {
      ...state,
      tick,
      speed: q(state.speed * proportion),
      lateralOffset,
      lateralVelocity: 0,
      slip: 0,
      offRoad: Math.abs(lateralOffset) > halfWidth,
      recovering: remaining > 0,
      recoveryTicksRemaining: remaining,
      vertical: {
        ...vertical,
        height: q(roadY + (vertical.height - roadY) * proportion),
        velocity: 0,
        airborne: false,
        impact: 0,
      },
    };
  }
  const offRoad = Math.abs(state.lateralOffset) > halfWidth;
  const grounded = !vertical.airborne;
  const drive = grounded
    ? held
      ? handling.acceleration
      : -handling.braking
    : 0;
  const slopeGravity =
    grounded && !offRoad ? -FLIGHT_GRAVITY * (frame.grade ?? 0) : 0;
  const drag = grounded
    ? handling.rollingDrag * state.speed * state.speed +
      (offRoad ? handling.offRoadDrag * state.speed : 0)
    : state.speed * 0.035;
  const speed = q(
    Math.max(
      0,
      Math.min(
        handling.maximumSpeed,
        state.speed + (drive + slopeGravity - drag) / hz
      )
    )
  );
  const excessDemand = Math.max(
    0,
    Math.abs(q(frame.curvature)) * speed * speed - handling.lateralGrip
  );
  const sideways =
    (grounded ? -Math.sign(frame.curvature) * excessDemand : 0) -
    handling.centering * state.lateralOffset -
    handling.lateralDamping * state.lateralVelocity;
  const lateralVelocity = q(state.lateralVelocity + sideways / hz);
  const lateralOffset = q(state.lateralOffset + lateralVelocity / hz);
  const distance = Math.min(track.totalLength, q(state.distance + speed / hz));
  const next = sampleTrack(track, distance);
  const nextOffRoad = Math.abs(lateralOffset) > q(next.halfWidth);
  const surfaceY = nextOffRoad ? 0 : (next.y ?? 0);
  let height = vertical.height;
  let velocity = vertical.velocity;
  let airborne = vertical.airborne;
  let landings = vertical.landings;
  let impact = q(vertical.impact * 0.92);
  // A fast convex crest loses contact naturally; a slow car follows the same ramp.
  const launch =
    grounded &&
    !offRoad &&
    (frame.verticalCurvature ?? 0) * speed * speed < -FLIGHT_GRAVITY &&
    height +
      ((frame.grade ?? 0) * speed) / hz -
      FLIGHT_GRAVITY / (2 * hz * hz) >
      surfaceY + 0.00001;
  const leaveEdge = grounded && nextOffRoad && height > surfaceY + 0.08;
  if (launch || leaveEdge) {
    airborne = true;
    velocity = q((frame.grade ?? 0) * speed);
  }
  if (airborne) {
    height = q(height + velocity / hz - FLIGHT_GRAVITY / (2 * hz * hz));
    velocity = q(velocity - FLIGHT_GRAVITY / hz);
    const relativeVelocity =
      velocity - (nextOffRoad ? 0 : (next.grade ?? 0) * speed);
    if (height <= surfaceY && relativeVelocity <= 0) {
      height = q(surfaceY);
      airborne = false;
      velocity = q((next.grade ?? 0) * speed);
      landings++;
      impact = q(Math.min(1, Math.max(0, -relativeVelocity / 12)));
    }
  } else {
    height = q(surfaceY);
    velocity = q((next.grade ?? 0) * speed);
  }
  const recover =
    Math.abs(lateralOffset) > halfWidth + handling.recoveryDistanceBeyondEdge ||
    (nextOffRoad && (next.y ?? 0) - height > 2);
  if (recover)
    return {
      ...state,
      tick,
      speed,
      lateralOffset,
      lateralVelocity: 0,
      slip: 0,
      offRoad: true,
      recovering: true,
      recoveryTicksRemaining: handling.recoveryTicks - 1,
      recoveryCount: state.recoveryCount + 1,
      vertical: { height, velocity: 0, airborne: false, landings, impact: 0 },
    };
  const finished = distance >= track.totalLength;
  return {
    tick,
    distance,
    speed,
    lateralOffset,
    lateralVelocity,
    slip: grounded ? q(Math.min(1, excessDemand / handling.lateralGrip)) : 0,
    offRoad: nextOffRoad,
    recovering: false,
    recoveryTicksRemaining: 0,
    recoveryCount: state.recoveryCount,
    finishedTick: finished ? tick : null,
    status: finished ? 'finished' : 'running',
    vertical: { height, velocity, airborne, landings, impact },
  };
}
