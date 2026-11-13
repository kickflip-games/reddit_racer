import {
  stepSlotSimulation,
  slotGripTelemetry,
  gripSurfaceAt,
  validateGripZones,
  type GripZone,
} from '../shared/slot-grip.ts';
import {
  createFlight,
  stepStuntSimulation,
} from '../shared/stunt-simulation.ts';
import { handlingForTrack } from '../shared/scored-runtime.ts';
import type { GapJump } from '../shared/stunt-course.ts';
import { sampleTrack, type Track } from '../shared/track.ts';
import {
  createSimulationState,
  MAX_SIMULATION_TICKS,
  quantizeSimulation,
  SIMULATION_HZ,
  stepSimulation,
  type SimulationState,
} from '../shared/simulation.ts';
import {
  abandonRace,
  prepareRace,
  startRace,
  stepRace,
  type RaceAbandonReason,
  type RaceState,
} from '../shared/race-rules.ts';

const tickMilliseconds = 1000 / SIMULATION_HZ;
const maximumFrameGap = 250;
const clockTolerance = 0.000001;

/**
 * Unranked flying laps select classic or dynamic-grip movement, but never produce
 * a scored replay. Public snapshots have monotonic ticks/unwrapped distance for
 * interpolation, wheel motion, audio and trails; physics keeps local distance.
 */
export class PracticeDriver {
  private race: RaceState;
  private physics = createSimulationState();
  private flight = createFlight();
  private readonly stepGrounded: typeof stepSimulation;
  get grip() {
    return this.handling.dynamicGrip
      ? slotGripTelemetry(
          this.track,
          this.physics,
          this.inputHeld,
          this.handling.zones
        )
      : null;
  }
  get roadBank(): number {
    return gripSurfaceAt(
      this.track,
      this.handling.zones ?? [],
      this.physics.distance
    ).bank;
  }
  get elevation(): number {
    if (this.physics.vertical) return this.physics.vertical.height;
    return (
      this.flight.height -
      (this.flight.airborne
        ? 0
        : this.physics.lateralOffset * Math.tan(this.roadBank))
    );
  }
  get verticalVelocity(): number {
    return this.physics.vertical?.velocity ?? this.flight.velocity;
  }
  get airborne(): boolean {
    return this.physics.vertical?.airborne ?? this.flight.airborne;
  }
  private previous: SimulationState;
  private lastTimestamp: number | undefined;
  private accumulatedMilliseconds = 0;
  private inputHeld = false;
  private completedLapCount = 0;
  private currentLapTicks = 0;
  private lastCompletedLapTicks: number | null = null;

  constructor(
    private readonly track: Track,
    private readonly jumps: readonly GapJump[] = [],
    private readonly handling: {
      dynamicGrip?: boolean;
      zones?: readonly GripZone[];
    } = {}
  ) {
    if (track.schemaVersion === 2 && (handling.dynamicGrip || jumps.length))
      throw new Error(
        'Prototype grip and gap rules require a flat practice course'
      );
    validateGripZones(track, handling.zones ?? []);
    this.stepGrounded = handling.dynamicGrip
      ? (track, state, held) =>
          stepSlotSimulation(track, state, held, handling.zones)
      : stepSimulation;
    this.race = prepareRace(track);
    // Every accepted game circuit is much longer than one tick's travel. Keep
    // seam work bounded to one crossing even for independently supplied tracks.
    if (
      track.totalLength <=
      handlingForTrack(track).maximumSpeed / SIMULATION_HZ + 0.000002
    )
      throw new Error('Practice circuit must exceed one fixed tick of travel');
    this.previous = this.race.simulation;
  }

  get state(): Readonly<SimulationState> {
    return this.race.simulation;
  }

  get previousState(): Readonly<SimulationState> {
    return this.previous;
  }

  get raceState(): Readonly<RaceState> {
    return this.race;
  }

  get active(): boolean {
    return this.race.phase === 'countdown' || this.race.phase === 'racing';
  }

  get interrupted(): boolean {
    return this.race.phase === 'abandoned';
  }

  get interruptionReason(): RaceAbandonReason | undefined {
    return this.race.abandonReason ?? undefined;
  }

  get alpha(): number {
    return this.active
      ? Math.max(
          0,
          Math.min(1, this.accumulatedMilliseconds / tickMilliseconds)
        )
      : 1;
  }

  get completedLaps(): number {
    return this.completedLapCount;
  }

  get lapTicks(): number {
    return this.currentLapTicks;
  }

  get lastLapTicks(): number | null {
    return this.lastCompletedLapTicks;
  }

  start(timestampMilliseconds: number): void {
    if (!Number.isFinite(timestampMilliseconds))
      throw new Error('Invalid start time');
    this.race = startRace(prepareRace(this.track));
    this.physics = createSimulationState(this.track);
    this.flight = createFlight();
    this.previous = this.race.simulation;
    this.lastTimestamp = timestampMilliseconds;
    this.accumulatedMilliseconds = 0;
    this.inputHeld = false;
    this.completedLapCount = 0;
    this.currentLapTicks = 0;
    this.lastCompletedLapTicks = null;
  }

  private step(): void {
    this.previous = this.race.simulation;
    if (this.race.phase === 'countdown') {
      this.race = stepRace(this.track, this.race, this.inputHeld);
      return;
    }

    const result = this.jumps.length
      ? stepStuntSimulation(
          this.track,
          this.jumps,
          this.physics,
          this.flight,
          this.inputHeld,
          this.stepGrounded
        )
      : null;
    const next =
      result?.simulation ??
      this.stepGrounded(this.track, this.physics, this.inputHeld);
    if (result) this.flight = result.flight;
    this.currentLapTicks++;
    let nextCheckpointIndex = this.race.nextCheckpointIndex;
    let checkpointTicks = this.race.checkpointTicks;
    while (nextCheckpointIndex < this.track.checkpoints.length) {
      const gate = this.track.checkpoints[nextCheckpointIndex];
      if (!gate || gate.s > next.distance) break;
      checkpointTicks = [...checkpointTicks, this.currentLapTicks];
      nextCheckpointIndex++;
    }

    let localDistance = next.distance;
    let offRoad = next.offRoad;
    if (next.status === 'finished') {
      if (nextCheckpointIndex !== this.track.checkpoints.length)
        throw new Error('Practice lap missed a checkpoint');
      // The scored one-lap step clamps at the line. Retain its sub-tick travel
      // beyond the line for seamless practice using the selected path metric.
      const unclippedDistance = quantizeSimulation(
        this.physics.distance +
          (this.handling.dynamicGrip && !this.flight.airborne
            ? Math.sqrt(
                Math.max(0, next.speed ** 2 - next.lateralVelocity ** 2)
              ) /
              Math.max(
                0.35,
                1 -
                  sampleTrack(this.track, this.physics.distance).curvature *
                    this.physics.lateralOffset
              )
            : next.speed) /
            SIMULATION_HZ
      );
      localDistance = Math.max(
        0,
        quantizeSimulation(unclippedDistance - this.track.totalLength)
      );
      if (localDistance >= this.track.totalLength)
        throw new Error('Practice crossed more than one lap in a tick');
      this.completedLapCount++;
      this.lastCompletedLapTicks = this.currentLapTicks;
      this.currentLapTicks = 0;
      nextCheckpointIndex = 0;
      checkpointTicks = [];
      while (nextCheckpointIndex < this.track.checkpoints.length) {
        const gate = this.track.checkpoints[nextCheckpointIndex];
        if (!gate || gate.s > localDistance) break;
        checkpointTicks.push(0);
        nextCheckpointIndex++;
      }
      offRoad =
        Math.abs(next.lateralOffset) >
        quantizeSimulation(sampleTrack(this.track, localDistance).halfWidth);
    }

    this.physics = {
      ...next,
      // This is only a private clock renormalization for unranked practice.
      // Keep all physical fields, recovery history and public time unchanged.
      tick: next.tick === MAX_SIMULATION_TICKS ? 0 : next.tick,
      distance: localDistance,
      offRoad,
      status: 'running',
      finishedTick: null,
    };
    this.race = {
      ...this.race,
      phase: 'racing',
      nextCheckpointIndex,
      checkpointTicks,
      simulation: {
        ...this.physics,
        tick: this.previous.tick + 1,
        distance:
          this.completedLapCount * this.track.totalLength + localDistance,
      },
    };
  }

  advance(timestampMilliseconds: number): void {
    if (!this.active) return;
    if (!Number.isFinite(timestampMilliseconds))
      throw new Error('Invalid frame time');
    if (this.lastTimestamp === undefined)
      throw new Error('Practice clock has not started');
    if (timestampMilliseconds <= this.lastTimestamp) return;
    const elapsed = timestampMilliseconds - this.lastTimestamp;
    this.lastTimestamp = timestampMilliseconds;
    if (elapsed >= maximumFrameGap) {
      this.abandon('frame-gap');
      return;
    }
    this.accumulatedMilliseconds += elapsed;
    while (this.accumulatedMilliseconds + clockTolerance >= tickMilliseconds) {
      try {
        this.step();
      } catch {
        this.abandon('invalid-progress');
        return;
      }
      this.accumulatedMilliseconds = Math.max(
        0,
        this.accumulatedMilliseconds - tickMilliseconds
      );
      if (!this.active) return;
    }
  }

  setInput(held: boolean, timestampMilliseconds: number): void {
    // Input transitions finish elapsed fixed ticks using the old held state.
    this.advance(timestampMilliseconds);
    if (!this.active) return;
    this.inputHeld = held;
  }

  abandon(reason: RaceAbandonReason = 'focus'): void {
    if (!this.active) return;
    this.race = abandonRace(this.race, reason);
    this.inputHeld = false;
    this.accumulatedMilliseconds = 0;
  }
}

export function createPracticeDriver(
  track: Track,
  jumps: readonly GapJump[] = [],
  handling: { dynamicGrip?: boolean; zones?: readonly GripZone[] } = {}
): PracticeDriver {
  return new PracticeDriver(track, jumps, handling);
}
