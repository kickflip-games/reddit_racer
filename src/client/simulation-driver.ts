import type { Track } from '../shared/track.ts';
import {
  createSimulationState,
  HANDLING_VERSION,
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
  SIMULATION_VERSION,
  stepSimulation,
  type SimulationState,
} from '../shared/simulation.ts';
import { MAX_REPLAY_TRANSITIONS, type Replay } from '../shared/replay.ts';

export type InterruptionReason =
  'focus' | 'frame-gap' | 'input-limit' | 'time-limit';

const tickMilliseconds = 1000 / SIMULATION_HZ;
const maximumFrameGap = 250;
const clockTolerance = 0.000001;

/** Browser-independent clock and input tape. Rendering never changes authoritative state. */
export class SimulationDriver {
  private current = createSimulationState();
  private previous = this.current;
  private lastTimestamp: number | undefined;
  private accumulatedMilliseconds = 0;
  private inputHeld = false;
  private transitions: Replay['transitions'] = [];
  private running = false;
  private reason: InterruptionReason | undefined;

  constructor(private readonly track: Track) {}

  get state(): Readonly<SimulationState> {
    return this.current;
  }

  get previousState(): Readonly<SimulationState> {
    return this.previous;
  }

  get active(): boolean {
    return this.running;
  }

  get interrupted(): boolean {
    return this.reason !== undefined;
  }

  get interruptionReason(): InterruptionReason | undefined {
    return this.reason;
  }

  get alpha(): number {
    return this.running
      ? Math.max(
          0,
          Math.min(1, this.accumulatedMilliseconds / tickMilliseconds)
        )
      : 1;
  }

  get replay(): Replay {
    return {
      schemaVersion: 1,
      simulationVersion: SIMULATION_VERSION,
      handlingVersion: HANDLING_VERSION,
      // A transition on current.tick is pending, so it is not part of the completed tape yet.
      transitions: this.transitions
        .filter((transition) => transition.tick < this.current.tick)
        .map((transition) => ({ ...transition })),
      endTick: this.current.tick,
    };
  }

  start(timestampMilliseconds: number): void {
    if (!Number.isFinite(timestampMilliseconds))
      throw new Error('Invalid start time');
    this.current = createSimulationState();
    this.previous = this.current;
    this.lastTimestamp = timestampMilliseconds;
    this.accumulatedMilliseconds = 0;
    this.inputHeld = false;
    this.transitions = [];
    this.reason = undefined;
    this.running = true;
  }

  advance(timestampMilliseconds: number): void {
    if (!this.running) return;
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
      if (this.current.tick >= MAX_SIMULATION_TICKS) {
        this.abandon('time-limit');
        return;
      }
      this.previous = this.current;
      this.current = stepSimulation(this.track, this.current, this.inputHeld);
      this.accumulatedMilliseconds = Math.max(
        0,
        this.accumulatedMilliseconds - tickMilliseconds
      );
      if (this.current.status === 'finished') {
        this.running = false;
        return;
      }
      if (this.current.tick >= MAX_SIMULATION_TICKS) {
        this.abandon('time-limit');
        return;
      }
    }
  }

  setInput(held: boolean, timestampMilliseconds: number): void {
    // Finish elapsed ticks with their old input before quantizing the new transition.
    this.advance(timestampMilliseconds);
    if (!this.running || held === this.inputHeld) return;
    const last = this.transitions.at(-1);
    if (last?.tick === this.current.tick) this.transitions.pop();
    const precedingHeld = this.transitions.at(-1)?.held ?? false;
    if (held !== precedingHeld) {
      if (this.transitions.length >= MAX_REPLAY_TRANSITIONS) {
        this.abandon('input-limit');
        return;
      }
      this.transitions.push({ tick: this.current.tick, held });
    }
    this.inputHeld = held;
  }

  abandon(reason: InterruptionReason = 'focus'): void {
    if (!this.running) return;
    this.reason = reason;
    this.running = false;
    this.inputHeld = false;
    this.accumulatedMilliseconds = 0;
  }
}

export function createSimulationDriver(track: Track): SimulationDriver {
  return new SimulationDriver(track);
}
