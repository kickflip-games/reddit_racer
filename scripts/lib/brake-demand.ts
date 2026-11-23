import {
  prepareRace,
  startRace,
  raceInputTick,
  stepRace,
} from '../../src/shared/race-rules';
import { handlingForTrack } from '../../src/shared/scored-runtime';
import { sampleTrack, type Track } from '../../src/shared/track';
import type { SimulationState } from '../../src/shared/simulation';

export type Zone = { from: number; to: number; floor?: number };
export type TracePoint = {
  tick: number;
  s: number;
  speed: number;
  held: boolean;
  airborne: boolean;
  offRoad: boolean;
  lateral: number;
};
export type DemandRun = {
  finished: boolean;
  seconds: number;
  offRoadTicks: number;
  recoveryTicks: number;
  checkpoints: number;
  trace: TracePoint[];
};
export type DemandEvent = Zone & {
  start: number;
  end: number;
  savedSeconds: number | null;
  finished: boolean;
  extraOffRoadTicks: number;
  extraRecoveryTicks: number;
  destabilizes: boolean;
};
export const MIN_RELEASE_TICKS = 24;
export const EXTENDED_SECONDS = 5;

/** Standing scored lap, armed by a legal countdown press; no rolling/cyclic seam. */
export function runDemand(
  track: Track,
  policy: (state: Readonly<SimulationState>, held: boolean) => boolean
): DemandRun {
  let race = startRace(prepareRace(track));
  while (race.phase === 'countdown')
    race = stepRace(track, race, raceInputTick(race) >= -120);
  let held = true,
    offRoadTicks = 0,
    recoveryTicks = 0;
  const trace: TracePoint[] = [];
  while (race.phase === 'racing' && race.simulation.tick < 14400) {
    const state = race.simulation;
    held = policy(state, held);
    trace.push({
      tick: state.tick,
      s: state.distance,
      speed: state.speed,
      held,
      airborne: state.vertical?.airborne ?? false,
      offRoad: state.offRoad,
      lateral: state.lateralOffset,
    });
    race = stepRace(track, race, held);
    if (race.simulation.offRoad) offRoadTicks++;
    if (race.simulation.recovering) recoveryTicks++;
  }
  return {
    finished: race.phase === 'finished',
    seconds: race.simulation.tick / 120,
    offRoadTicks,
    recoveryTicks,
    checkpoints: race.nextCheckpointIndex,
    trace,
  };
}

/** Curvature only proposes a speed bound. Every candidate runs in the actual dynamics. */
export function envelope(track: Track, gripFactor: number, lead: number) {
  const h = handlingForTrack(track),
    ds = track.totalLength / Math.ceil(track.totalLength);
  const bound = Array.from(
    { length: Math.ceil(track.totalLength) + 1 },
    (_, i) => {
      const p = sampleTrack(
        track,
        Math.min(track.totalLength - 0.00001, i * ds)
      );
      return Math.min(
        h.maximumSpeed,
        Math.sqrt(
          (h.lateralGrip * gripFactor) /
            Math.max(0.00001, Math.abs(p.curvature))
        )
      );
    }
  );
  // The finish is terminal: do not brake for the next lap or wrap the preview.
  bound[bound.length - 1] = h.maximumSpeed;
  for (let i = bound.length - 2; i >= 0; i--) {
    const p = sampleTrack(track, i * ds),
      v = bound[i + 1]!;
    const decel = h.braking + h.rollingDrag * v * v + 11.5 * (p.grade ?? 0);
    bound[i] = Math.min(
      bound[i]!,
      Math.sqrt(v * v + 2 * Math.max(1, decel) * ds)
    );
  }
  let changed = -MIN_RELEASE_TICKS;
  return (state: Readonly<SimulationState>, held: boolean) => {
    if (state.vertical?.airborne) return true;
    // Preserve the authored jump and its run-out; braking in flight has no effect.
    if (
      track.jumps?.some(
        (j) =>
          state.distance >= j.rampStart - 12 && state.distance <= j.rampEnd + 35
      )
    )
      return true;
    const position = Math.min(
      bound.length - 1,
      Math.max(0, (state.distance + lead) / ds)
    );
    const i = Math.floor(position),
      t = position - i;
    const target =
      bound[i]! * (1 - t) + bound[Math.min(i + 1, bound.length - 1)]! * t;
    if (state.tick - changed < MIN_RELEASE_TICKS) return held;
    const next = held
      ? state.speed < target + 0.65
      : state.speed < target - 0.65;
    if (next !== held) changed = state.tick;
    return next;
  };
}

/** Ignore tiny pulses; merge nearby releases into one approach (at most 0.75s apart). */
export function releaseZones(run: DemandRun): Zone[] {
  const result: Zone[] = [];
  for (let i = 0; i < run.trace.length; i++) {
    if (run.trace[i]!.held || run.trace[i]!.airborne) continue;
    const start = i;
    while (
      i + 1 < run.trace.length &&
      !run.trace[i + 1]!.held &&
      !run.trace[i + 1]!.airborne
    )
      i++;
    if (i - start + 1 < MIN_RELEASE_TICKS) continue;
    const zone = {
      from: run.trace[start]!.s,
      to: run.trace[i + 1]?.s ?? run.trace[i]!.s + 0.001,
      floor: run.trace[i]!.speed,
    };
    const previous = result.at(-1);
    const previousEnd = previous
      ? (run.trace.findLast((p) => p.s <= previous.to)?.tick ?? 0)
      : 0;
    if (previous && start - previousEnd <= 90) {
      previous.to = zone.to;
      previous.floor = Math.min(previous.floor ?? Infinity, zone.floor);
    } else result.push(zone);
  }
  return result;
}

export function zonePolicy(zones: Zone[]) {
  return (state: Readonly<SimulationState>) =>
    state.vertical?.airborne === true ||
    !zones.some(
      (z) =>
        state.distance >= z.from &&
        state.distance < z.to &&
        state.speed > (z.floor ?? 2)
    );
}
const cleanScore = (r: DemandRun) =>
  r.finished
    ? r.recoveryTicks * 10 + Math.max(0, r.offRoadTicks - 12) * 0.1
    : 1e9;
function better(a: DemandRun, b: DemandRun): boolean {
  return (
    cleanScore(a) < cleanScore(b) ||
    (cleanScore(a) === cleanScore(b) && a.seconds < b.seconds)
  );
}

export function referenceDemand(track: Track, searchedZones: Zone[] = []) {
  const hold = runDemand(track, () => true);
  let best = hold,
    selected = 'hold',
    zones: Zone[] = [];
  const freeze = (run: DemandRun): Zone[] => {
    const result: Zone[] = [];
    for (let i = 0; i < run.trace.length; i++) {
      if (run.trace[i]!.held) continue;
      const start = i;
      while (i + 1 < run.trace.length && !run.trace[i + 1]!.held) i++;
      result.push({
        from: run.trace[start]!.s,
        to: run.trace[i + 1]?.s ?? run.trace[i]!.s + 0.001,
        floor: run.trace[i]!.speed,
      });
    }
    return result;
  };
  for (const factor of [1, 1.25, 1.5, 1.8, 2.1])
    for (const lead of [0, 3, 6, 10]) {
      const candidateZones = freeze(
        runDemand(track, envelope(track, factor, lead))
      );
      const trial = runDemand(track, zonePolicy(candidateZones));
      if (better(trial, best)) {
        best = trial;
        zones = candidateZones;
        selected = `envelope:${factor}:${lead}`;
      }
    }
  if (searchedZones.length) {
    const trial = runDemand(track, zonePolicy(searchedZones));
    if (better(trial, best)) {
      best = trial;
      zones = searchedZones;
      selected = 'existing-search';
    }
  }
  // Remove whole conservative approaches if throttle is no worse. Re-evaluate to
  // avoid counting brakes that matter only because another unnecessary one stayed.
  let pruned = 0;
  for (let pass = 0; pass < 2; pass++)
    for (const event of releaseZones(best)) {
      const trialZones = zones.filter(
        (z) => z.to <= event.from || z.from >= event.to
      );
      const trial = runDemand(track, zonePolicy(trialZones));
      if (
        trial.finished &&
        trial.recoveryTicks <= best.recoveryTicks &&
        trial.offRoadTicks <= best.offRoadTicks + 6 &&
        trial.seconds <= best.seconds + 0.025
      ) {
        zones = trialZones;
        best = trial;
        pruned++;
      }
    }
  const events: DemandEvent[] = releaseZones(best).map((event) => {
    const trial = runDemand(
      track,
      zonePolicy(zones.filter((z) => z.to <= event.from || z.from >= event.to))
    );
    const first = best.trace.find((p) => p.s >= event.from)!,
      last = best.trace.find((p) => p.s >= event.to);
    const extraOffRoadTicks = trial.offRoadTicks - best.offRoadTicks,
      extraRecoveryTicks = trial.recoveryTicks - best.recoveryTicks;
    return {
      ...event,
      start: first.tick / 120,
      end: (last?.tick ?? best.trace.length) / 120,
      savedSeconds: trial.finished ? trial.seconds - best.seconds : null,
      finished: trial.finished,
      extraOffRoadTicks,
      extraRecoveryTicks,
      destabilizes:
        !trial.finished || extraRecoveryTicks > 0 || extraOffRoadTicks > 12,
    };
  });
  const validated = events.filter(
    (e) => (e.savedSeconds ?? 0) >= 0.05 || e.destabilizes
  );
  const intervals = noBrakeIntervals(best.seconds, validated);
  const longest = Math.max(...intervals.map((i) => i.end - i.start));
  const excess = intervals.reduce(
    (sum, i) => sum + Math.max(0, i.end - i.start - EXTENDED_SECONDS),
    0
  );
  return {
    selected,
    pruned,
    hold: { ...hold, trace: undefined },
    run: best,
    events,
    validated,
    intervals,
    longest,
    excess,
    // Report the cost of repeated long runs while allowing one deliberate breather.
    repeatedExcess: Math.max(
      0,
      excess - Math.max(0, longest - EXTENDED_SECONDS)
    ),
    extendedCount: intervals.filter((i) => i.end - i.start > EXTENDED_SECONDS)
      .length,
    brakeFraction:
      best.trace.filter((p) => !p.held && !p.airborne).length /
      best.trace.length,
  };
}

/** Include acceleration from GO and the terminal run to the road finish separately. */
export function noBrakeIntervals(
  seconds: number,
  events: { start: number; end: number }[]
) {
  const intervals: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const event of events) {
    if (event.start > cursor)
      intervals.push({ start: cursor, end: event.start });
    cursor = Math.max(cursor, event.end);
  }
  if (cursor < seconds) intervals.push({ start: cursor, end: seconds });
  return intervals;
}
