import { runtimeForTrack } from '../shared/scored-runtime.ts';
import type { Track } from '../shared/track.ts';
import {
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
  type SimulationState,
} from '../shared/simulation.ts';
import {
  MAX_REPLAY_TRANSITIONS,
  replaySchemaForTrack,
  type Replay,
} from '../shared/replay.ts';
import {
  abandonRace,
  prepareRace,
  raceInputTick,
  startRace,
  stepRace,
  type RaceAbandonReason,
  type RaceState,
} from '../shared/race-rules.ts';

export type InterruptionReason = RaceAbandonReason;

const tickMilliseconds = 1000 / SIMULATION_HZ;
const maximumFrameGap = 250;
const clockTolerance = 0.000001;

/** Browser-independent clock and input tape. Rendering never changes authoritative state. */
export class SimulationDriver {
  private race: RaceState;
  private previous: SimulationState;
  private lastTimestamp: number | undefined;
  private accumulatedMilliseconds = 0;
  private inputHeld = false;
  private transitions: Replay['transitions'] = [];

  constructor(private readonly track: Track) {
    this.race = prepareRace(track);
    this.previous = this.race.simulation;
  }

  get state(): Readonly<SimulationState> {
    return this.race.simulation;
  }

  get raceState(): Readonly<RaceState> {
    return this.race;
  }

  get previousState(): Readonly<SimulationState> {
    return this.previous;
  }

  get active(): boolean {
    return this.race.phase === 'countdown' || this.race.phase === 'racing';
  }

  get interrupted(): boolean {
    return this.race.phase === 'abandoned';
  }

  get interruptionReason(): InterruptionReason | undefined {
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

  get replay(): Replay {
    return {
      schemaVersion: replaySchemaForTrack(this.track),
      simulationVersion: runtimeForTrack(this.track).simulationVersion,
      handlingVersion: runtimeForTrack(this.track).handlingVersion,
      transitions: this.transitions
        .filter((transition) => transition.tick < this.state.tick)
        .map((transition) => ({ ...transition })),
      endTick: this.state.tick,
    };
  }

  start(timestampMilliseconds: number): void {
    if (!Number.isFinite(timestampMilliseconds))
      throw new Error('Invalid start time');
    this.race = startRace(prepareRace(this.track));
    this.previous = this.race.simulation;
    this.lastTimestamp = timestampMilliseconds;
    this.accumulatedMilliseconds = 0;
    this.inputHeld = false;
    this.transitions = [];
  }

  advance(timestampMilliseconds: number): void {
    if (!this.active) return;
    if (!Number.isFinite(timestampMilliseconds))
      throw new Error('Invalid frame time');
    if (this.lastTimestamp === undefined)
      throw new Error('Simulation clock has not started');
    // A RAF timestamp may precede an input handled in that same rendering turn.
    if (timestampMilliseconds <= this.lastTimestamp) return;
    const elapsed = timestampMilliseconds - this.lastTimestamp;
    this.lastTimestamp = timestampMilliseconds;
    if (elapsed >= maximumFrameGap) {
      this.abandon('frame-gap');
      return;
    }
    this.accumulatedMilliseconds += elapsed;
    while (this.accumulatedMilliseconds + clockTolerance >= tickMilliseconds) {
      if (this.state.tick >= MAX_SIMULATION_TICKS) {
        this.abandon('time-limit');
        return;
      }
      // V9 records sampled countdown edges so the verifier reconstructs the launch.
      // Older runtimes retain their original scored-only tapes.
      if (
        (this.race.phase === 'racing' ||
          replaySchemaForTrack(this.track) === 2) &&
        this.inputHeld !== (this.transitions.at(-1)?.held ?? false)
      ) {
        if (this.transitions.length >= MAX_REPLAY_TRANSITIONS) {
          this.abandon('input-limit');
          return;
        }
        this.transitions.push({
          tick: raceInputTick(this.race),
          held: this.inputHeld,
        });
      }
      this.previous = this.race.simulation;
      this.race = stepRace(this.track, this.race, this.inputHeld);
      this.accumulatedMilliseconds = Math.max(
        0,
        this.accumulatedMilliseconds - tickMilliseconds
      );
      if (!this.active) return;
      if (this.state.tick >= MAX_SIMULATION_TICKS) {
        this.abandon('time-limit');
        return;
      }
    }
  }

  setInput(held: boolean, timestampMilliseconds: number): void {
    // Finish elapsed ticks with their old input before quantizing the new transition.
    this.advance(timestampMilliseconds);
    if (!this.active) return;
    this.inputHeld = held;
  }

  abandon(reason: InterruptionReason = 'focus'): void {
    if (!this.active) return;
    this.race = abandonRace(this.race, reason);
    this.inputHeld = false;
    this.accumulatedMilliseconds = 0;
  }
}

export function createSimulationDriver(track: Track): SimulationDriver {
  return new SimulationDriver(track);
}
