import { abandonRace, createRacingState, stepRace } from './race-rules.ts';
import {
  HANDLING,
  HANDLING_VERSION,
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
  SIMULATION_VERSION,
} from './simulation.ts';
import type { SimulationState } from './simulation.ts';
import { MAX_REPLAY_TRANSITIONS } from './replay.ts';
import type { Replay, ReplayTransition } from './replay.ts';
import { sampleTrack } from './track.ts';
import type { Track } from './track.ts';

export const MAX_BRAKING_PEAKS = 8;
export const SEARCH_PASSES = 2;
export const RELEASE_WINDOW_WIDTHS: readonly number[] = [6, 10, 14, 18];
export const MAX_CONTROLLER_RUNS =
  2 + MAX_BRAKING_PEAKS * SEARCH_PASSES * RELEASE_WINDOW_WIDTHS.length;
export type BrakingPeak = { s: number; curvature: number };
export type BotRunSummary = {
  finished: boolean;
  finishTicks: number | null;
  seconds: number | null;
  elapsedTicks: number;
  offRoadTicks: number;
  recoveryTicks: number;
  recoveryCount: number;
  lifts: number;
  meaningfulLifts: number;
};
export type BotRun = { summary: BotRunSummary; replay: Replay };
export type ControllerWork = { controllerRuns: number; simulatedTicks: number };
export type ImprovingSearch = {
  hold: BotRun;
  cautious: BotRun;
  fast: BotRun;
  peaks: BrakingPeak[];
  widths: number[];
  work: ControllerWork;
};

type Controller = (state: Readonly<SimulationState>, held: boolean) => boolean;

/** A release must persist for the configured sampled ticks to count as meaningful. */
export function countInputLifts(
  transitions: ReplayTransition[],
  endTick: number,
  minimumLiftTicks = 12
): { lifts: number; meaningfulLifts: number } {
  let lifts = 0,
    meaningfulLifts = 0;
  for (let index = 0; index < transitions.length; index++) {
    const transition = transitions[index];
    if (!transition || transition.held) continue;
    lifts++;
    const intervalEnd = transitions[index + 1]?.tick ?? endTick;
    if (intervalEnd - transition.tick >= minimumLiftTicks) meaningfulLifts++;
  }
  return { lifts, meaningfulLifts };
}

/** Control policy only: every state update is the production stepRace implementation. */
function drive(
  track: Track,
  controller: Controller,
  minimumLiftTicks: number
): BotRun {
  let race = createRacingState(track);
  let held = false,
    offRoadTicks = 0,
    recoveryTicks = 0;
  const transitions: ReplayTransition[] = [];
  while (
    race.phase === 'racing' &&
    race.simulation.tick < MAX_SIMULATION_TICKS
  ) {
    const nextHeld = controller(race.simulation, held);
    if (nextHeld !== held) {
      if (transitions.length >= MAX_REPLAY_TRANSITIONS) {
        race = abandonRace(race, 'input-limit');
        break;
      }
      held = nextHeld;
      transitions.push({ tick: race.simulation.tick, held });
    }
    const previous = race.simulation;
    race = stepRace(track, race, held);
    if (race.simulation.offRoad) offRoadTicks++;
    if (previous.recovering || race.simulation.recovering) recoveryTicks++;
  }
  const finished = race.phase === 'finished';
  const { lifts, meaningfulLifts } = countInputLifts(
    transitions,
    race.simulation.tick,
    minimumLiftTicks
  );
  return {
    summary: {
      finished,
      finishTicks: finished ? race.simulation.finishedTick : null,
      seconds: finished ? race.simulation.tick / SIMULATION_HZ : null,
      elapsedTicks: race.simulation.tick,
      offRoadTicks,
      recoveryTicks,
      recoveryCount: race.simulation.recoveryCount,
      lifts,
      meaningfulLifts,
    },
    replay: {
      schemaVersion: 1,
      simulationVersion: SIMULATION_VERSION,
      handlingVersion: HANDLING_VERSION,
      transitions,
      endTick: race.simulation.tick,
    },
  };
}

export function holdBot(track: Track, minimumLiftTicks = 12): BotRun {
  return drive(track, () => true, minimumLiftTicks);
}
export function cautiousBot(track: Track, minimumLiftTicks = 12): BotRun {
  return drive(
    track,
    (state, held) => {
      const lookAhead = Math.max(6, state.speed * 0.7);
      let curvature = 0.003;
      for (const fraction of [0, 0.25, 0.5, 0.75, 1])
        curvature = Math.max(
          curvature,
          Math.abs(
            sampleTrack(track, state.distance + lookAhead * fraction).curvature
          )
        );
      const targetSpeed = Math.sqrt((HANDLING.lateralGrip * 0.75) / curvature);
      return held
        ? state.speed < targetSpeed + 0.25
        : state.speed < targetSpeed - 0.25;
    },
    minimumLiftTicks
  );
}

export function brakingPeaks(track: Track): BrakingPeak[] {
  const ranked = track.samples
    .map((sample, index) => ({
      s: sample.s,
      curvature: Math.abs(sample.curvature),
      index,
    }))
    .filter((point) => point.curvature > 0.03)
    .sort((a, b) => b.curvature - a.curvature || a.index - b.index);
  const peaks: BrakingPeak[] = [];
  for (const point of ranked) {
    if (peaks.length >= MAX_BRAKING_PEAKS) break;
    if (
      peaks.every(
        (peak) =>
          Math.min(
            Math.abs(peak.s - point.s),
            track.totalLength - Math.abs(peak.s - point.s)
          ) > 28
      )
    )
      peaks.push({ s: point.s, curvature: point.curvature });
  }
  return peaks.sort((a, b) => a.s - b.s);
}
function windowBot(
  track: Track,
  peaks: BrakingPeak[],
  widths: number[],
  minimumLiftTicks: number
): BotRun {
  const completed = new Set<number>();
  return drive(
    track,
    (state) => {
      let held = true;
      for (let index = 0; index < peaks.length; index++) {
        const peak = peaks[index],
          width = widths[index];
        if (
          !peak ||
          width === undefined ||
          width <= 0 ||
          completed.has(index) ||
          state.distance < peak.s - width ||
          state.distance > peak.s + 2
        )
          continue;
        if (
          state.speed <=
          Math.sqrt((HANDLING.lateralGrip * 0.9) / peak.curvature)
        )
          completed.add(index);
        else held = false;
      }
      return held;
    },
    minimumLiftTicks
  );
}

/** Bounded coordinate improvement over short release windows; not a global optimum. */
export function searchDrivingInputs(
  track: Track,
  minimumLiftTicks = 12
): ImprovingSearch {
  const peaks = brakingPeaks(track),
    widths = peaks.map(() => 0);
  const hold = holdBot(track, minimumLiftTicks),
    cautious = cautiousBot(track, minimumLiftTicks);
  const work = {
    controllerRuns: 2,
    simulatedTicks: hold.summary.elapsedTicks + cautious.summary.elapsedTicks,
  };
  let fast = hold;
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    for (let index = 0; index < peaks.length; index++) {
      let selected = widths[index] ?? 0;
      for (const width of RELEASE_WINDOW_WIDTHS) {
        const trialWidths = [...widths];
        trialWidths[index] = width;
        const trial = windowBot(track, peaks, trialWidths, minimumLiftTicks);
        work.controllerRuns++;
        work.simulatedTicks += trial.summary.elapsedTicks;
        if (
          trial.summary.finishTicks !== null &&
          (fast.summary.finishTicks === null ||
            trial.summary.finishTicks < fast.summary.finishTicks)
        ) {
          fast = trial;
          selected = width;
        }
      }
      widths[index] = selected;
    }
  }
  return { hold, cautious, fast, peaks, widths, work };
}
