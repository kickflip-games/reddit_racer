import { sampleTrack, type Track } from './track.ts';
import {
  HANDLING,
  MAX_SIMULATION_TICKS,
  quantizeSimulation as q,
  SIMULATION_HZ,
  stepSimulation,
  type SimulationState,
} from './simulation.ts';

/** Practice-only rules. Never attach this model to an old ranked replay tuple. */
export const SLOT_HANDLING_VERSION = 'dynamic-grip-v1';
export const SLOT_GRIP = Object.freeze({
  totalGrip: 10,
  acceleration: 6.8,
  braking: 4.2,
  lookaheadSeconds: 0.7,
  response: 3.5,
  damping: 3,
  insideFraction: 0.72,
  recoveryRunoff: 2,
});
export type GripZone = {
  startS: number;
  endS: number;
  surface: 'dry' | 'wet' | 'dust';
  /** Signed bank toward the +normal, radians. */ bank: number;
};
export type GripTelemetry = {
  usage: number;
  lateralBudget: number;
  longitudinalDemand: number;
  targetOffset: number;
  curvature: number;
  bank: number;
  surface: GripZone['surface'];
};
const clamp = (n: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, n));
const friction = { dry: 1, wet: 0.72, dust: 0.62 };

export function validateGripZones(
  track: Track,
  zones: readonly GripZone[]
): void {
  let end = 0;
  if (zones.length > 128) throw new Error('Too many grip zones');
  for (const zone of zones) {
    if (
      !Number.isFinite(zone.startS + zone.endS + zone.bank) ||
      zone.startS < end ||
      zone.endS <= zone.startS ||
      zone.endS > track.totalLength ||
      Math.abs(zone.bank) > 0.3 ||
      !Object.hasOwn(friction, zone.surface)
    )
      throw new Error('Invalid or overlapping grip zone');
    end = zone.endS;
  }
}

/** Short eased transitions avoid an invisible step in banking or friction. */
export function gripSurfaceAt(
  track: Track,
  zones: readonly GripZone[],
  distance: number
): { bank: number; coefficient: number; surface: GripZone['surface'] } {
  const s =
    ((distance % track.totalLength) + track.totalLength) % track.totalLength;
  const zone = zones.find((zone) => s >= zone.startS && s <= zone.endS);
  if (!zone) return { bank: 0, coefficient: 1, surface: 'dry' };
  const blend = clamp(Math.min(s - zone.startS, zone.endS - s) / 4, 0, 1);
  const smooth = blend * blend * (3 - 2 * blend);
  return {
    bank: zone.bank * smooth,
    coefficient: 1 + (friction[zone.surface] - 1) * smooth,
    surface: zone.surface,
  };
}

export function slotGripTelemetry(
  track: Track,
  state: Readonly<SimulationState>,
  held: boolean,
  zones: readonly GripZone[] = []
): GripTelemetry {
  const frame = sampleTrack(track, state.distance);
  const surface = gripSurfaceAt(track, zones, state.distance);
  const total =
    SLOT_GRIP.totalGrip * surface.coefficient * Math.cos(surface.bank);
  const longitudinalDemand = Math.min(
    total * 0.95,
    state.speed === 0 && !held
      ? 0
      : held
        ? SLOT_GRIP.acceleration
        : SLOT_GRIP.braking
  );
  const lateralBudget = Math.sqrt(
    Math.max(0, total * total - longitudinalDemand * longitudinalDemand)
  );
  const metric = Math.max(0.35, 1 - frame.curvature * state.lateralOffset);
  const forwardSquared = Math.max(
    0,
    state.speed ** 2 - state.lateralVelocity ** 2
  );
  const demand =
    (forwardSquared * frame.curvature) / metric - 9.81 * Math.sin(surface.bank);
  const usage = Math.abs(demand) / Math.max(0.1, lateralBudget);
  const lookahead = Math.max(4, state.speed * SLOT_GRIP.lookaheadSeconds);
  let anticipated = frame.curvature;
  // Prefer the first strong bend; signed averaging across an S would hide it.
  for (const fraction of [0.33, 0.66, 1]) {
    const k = sampleTrack(
      track,
      state.distance + lookahead * fraction
    ).curvature;
    if (Math.abs(k) * (1 - fraction * 0.45) > Math.abs(anticipated))
      anticipated = k;
  }
  const corner = clamp(Math.abs(anticipated) * 35, 0, 1);
  // A fast car on a straight must not dive inside an approaching tight bend.
  const anticipatedUsage = Math.max(
    usage,
    Math.abs(forwardSquared * anticipated - 9.81 * Math.sin(surface.bank)) /
      Math.max(0.1, lateralBudget)
  );
  const reserve = clamp(1 - anticipatedUsage * 0.65, 0, 1);
  const targetOffset =
    Math.sign(anticipated) *
    frame.halfWidth *
    SLOT_GRIP.insideFraction *
    corner *
    reserve;
  return {
    usage,
    lateralBudget,
    longitudinalDemand,
    targetOffset,
    curvature: frame.curvature,
    bank: surface.bank,
    surface: surface.surface,
  };
}

/** One fixed tick. Boundary frames are canonical; there is no authored racing line. */
export function stepSlotSimulation(
  track: Track,
  state: SimulationState,
  held: boolean,
  zones: readonly GripZone[] = []
): SimulationState {
  if (typeof held !== 'boolean')
    throw new Error('Accelerator input must be Boolean');
  if (state.status === 'finished') return state;
  if (state.tick >= MAX_SIMULATION_TICKS)
    throw new Error('Simulation duration limit exceeded');
  if (state.recoveryTicksRemaining > 0)
    return stepSimulation(track, state, held);
  const frame = sampleTrack(track, state.distance);
  const grip = slotGripTelemetry(track, state, held, zones);
  const offRoad = Math.abs(state.lateralOffset) > frame.halfWidth;
  const drive = held ? grip.longitudinalDemand : -grip.longitudinalDemand;
  const scrub = Math.max(0, grip.usage - 1) * 0.6;
  const speed = q(
    clamp(
      state.speed +
        (drive -
          HANDLING.rollingDrag * state.speed ** 2 -
          (offRoad ? HANDLING.offRoadDrag * state.speed : 0) -
          scrub) /
          SIMULATION_HZ,
      0,
      HANDLING.maximumSpeed
    )
  );
  const metric = Math.max(0.35, 1 - frame.curvature * state.lateralOffset);
  const forwardSquared = Math.max(0, speed ** 2 - state.lateralVelocity ** 2);
  const demand = (forwardSquared * frame.curvature) / metric;
  const gravity = 9.81 * Math.sin(grip.bank);
  const correction =
    (grip.targetOffset - state.lateralOffset) * SLOT_GRIP.response -
    state.lateralVelocity * SLOT_GRIP.damping;
  const tyreForce = clamp(
    demand - gravity + correction,
    -grip.lateralBudget,
    grip.lateralBudget
  );
  const mobility = Math.min(1, speed / 3);
  const lateralVelocity = q(
    clamp(
      state.lateralVelocity +
        ((tyreForce + gravity - demand) * mobility) / SIMULATION_HZ,
      -speed * 0.7,
      speed * 0.7
    )
  );
  const lateralOffset = q(
    state.lateralOffset + lateralVelocity / SIMULATION_HZ
  );
  const slip = q(clamp((grip.usage - 0.72) / 0.6, 0, 1));
  if (Math.abs(lateralOffset) > frame.halfWidth + SLOT_GRIP.recoveryRunoff)
    return {
      ...state,
      tick: state.tick + 1,
      speed,
      lateralOffset,
      lateralVelocity: 0,
      slip: 0,
      offRoad: true,
      recovering: true,
      recoveryTicksRemaining: HANDLING.recoveryTicks - 1,
      recoveryCount: state.recoveryCount + 1,
    };
  // Inner offsets travel a shorter arc. Lateral motion consumes real path speed.
  const alongSpeed = Math.sqrt(Math.max(0, speed ** 2 - lateralVelocity ** 2));
  const distance = Math.min(
    track.totalLength,
    q(state.distance + alongSpeed / metric / SIMULATION_HZ)
  );
  const finished = distance >= track.totalLength;
  return {
    tick: state.tick + 1,
    distance,
    speed,
    lateralOffset,
    lateralVelocity,
    slip,
    offRoad: Math.abs(lateralOffset) > sampleTrack(track, distance).halfWidth,
    recovering: false,
    recoveryTicksRemaining: 0,
    recoveryCount: state.recoveryCount,
    finishedTick: finished ? state.tick + 1 : null,
    status: finished ? 'finished' : 'running',
  };
}

export type BrakingMarker = { s: number; cornerS: number; direction: number };
/** Shared braking-distance rule for cues and controls; no guessed fixed spacing. */
export function slotBrakingMarkers(
  track: Track,
  zones: readonly GripZone[] = []
): BrakingMarker[] {
  const candidates = track.samples
    .filter((sample) => Math.abs(sample.curvature) > 0.025)
    .sort((a, b) => Math.abs(b.curvature) - Math.abs(a.curvature) || a.s - b.s);
  const selected: BrakingMarker[] = [];
  for (const sample of candidates) {
    if (selected.length >= 10) break;
    if (
      selected.some(
        (other) =>
          Math.min(
            Math.abs(other.cornerS - sample.s),
            track.totalLength - Math.abs(other.cornerS - sample.s)
          ) < 30
      )
    )
      continue;
    const grip = slotGripTelemetry(
      track,
      { ...stateForMarkers, distance: sample.s },
      false,
      zones
    );
    const safe = Math.sqrt(
      Math.max(1, grip.lateralBudget * 0.8) / Math.abs(sample.curvature)
    );
    const brakingDistance = Math.max(
      5,
      (HANDLING.maximumSpeed ** 2 - safe ** 2) / (2 * SLOT_GRIP.braking)
    );
    selected.push({
      s:
        (((sample.s - brakingDistance) % track.totalLength) +
          track.totalLength) %
        track.totalLength,
      cornerS: sample.s,
      direction: Math.sign(sample.curvature),
    });
  }
  return selected.sort((a, b) => a.s - b.s);
}
const stateForMarkers: SimulationState = {
  tick: 0,
  distance: 0,
  speed: HANDLING.maximumSpeed,
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
