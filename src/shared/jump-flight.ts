import { FLIGHT_GRAVITY } from './scored-runtime';
import type { SimulationState } from './simulation';
import { sampleTrack, type Track } from './track';

/** Per-gap evidence from the same authoritative steps used by bots and ranked replay. */
export type JumpFlight = {
  takeoff: number;
  launchS: number | null;
  launchSpeed: number | null;
  airborneTicks: number;
  peakClearance: number;
  landingEdgeClearance: number | null;
  landedS: number | null;
  recoveries: number;
};
export function createJumpFlights(track: Track): JumpFlight[] {
  return (track.jumps ?? []).map((j) => ({
    takeoff: j.takeoff,
    launchS: null,
    launchSpeed: null,
    airborneTicks: 0,
    peakClearance: 0,
    landingEdgeClearance: null,
    landedS: null,
    recoveries: 0,
  }));
}
export function observeJumpFlights(
  track: Track,
  flights: JumpFlight[],
  previous: SimulationState,
  next: SimulationState
): void {
  for (let i = 0; i < flights.length; i++) {
    const j = track.jumps?.[i],
      f = flights[i];
    if (
      !j ||
      !f ||
      next.distance < j.rampStart ||
      previous.distance > j.rampEnd + 35
    )
      continue;
    const vertical = next.vertical;
    if (
      !previous.vertical?.airborne &&
      vertical?.airborne &&
      previous.distance < j.landing &&
      f.launchS === null
    ) {
      f.launchS = previous.distance;
      f.launchSpeed = next.speed;
    }
    if (vertical?.airborne && f.launchS !== null) {
      f.airborneTicks++;
      f.peakClearance = Math.max(
        f.peakClearance,
        vertical.height - (sampleTrack(track, next.distance).y ?? 0)
      );
    }
    // Evaluate the ballistic height at the exact lip BEFORE the collision can snap
    // a below-deck car onto the landing mesh. Aggregate airborne ticks miss this.
    if (
      previous.distance < j.landing &&
      next.distance >= j.landing &&
      previous.vertical?.airborne
    ) {
      const dt = (j.landing - previous.distance) / Math.max(0.001, next.speed);
      f.landingEdgeClearance =
        previous.vertical.height +
        previous.vertical.velocity * dt -
        (FLIGHT_GRAVITY * dt * dt) / 2 -
        (sampleTrack(track, j.landing).y ?? 0);
    }
    if (
      previous.vertical?.airborne &&
      vertical &&
      !vertical.airborne &&
      next.distance >= j.landing &&
      !next.recovering &&
      f.landedS === null
    )
      f.landedS = next.distance;
    f.recoveries += next.recoveryCount - previous.recoveryCount;
  }
}
export function playableJumpFlight(f: JumpFlight): boolean {
  return (
    f.launchS !== null &&
    f.launchSpeed !== null &&
    f.launchSpeed >= 18 &&
    f.airborneTicks >= 12 &&
    f.peakClearance >= 0.2 &&
    f.landingEdgeClearance !== null &&
    f.landingEdgeClearance >= 0 &&
    f.landedS !== null &&
    f.recoveries === 0
  );
}
