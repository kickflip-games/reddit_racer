import { createPracticeDriver } from '../../src/client/practice-driver.ts';
import {
  searchDrivingInputs,
  type BotRun,
} from '../../src/shared/driving-bots.ts';
import {
  handlingForTrack,
  runtimeForTrack,
} from '../../src/shared/scored-runtime.ts';
import { sampleTrack, type Track } from '../../src/shared/track.ts';
import {
  SIMULATION_HZ,
  type SimulationState,
} from '../../src/shared/simulation.ts';
export type Policy = (
  state: Readonly<SimulationState>,
  held: boolean
) => boolean;
export type PracticeMetrics = {
  finished: boolean;
  ticks: number | null;
  seconds: number | null;
  offRoadTicks: number;
  recoveryTicks: number;
  recoveryCount: number;
  slipTicks: number;
  lifts: number;
  minSpeed: number;
  maxLateral: number;
  steps: number;
  releases: { s: number; speed: number }[];
};
export function drivePractice(track: Track, policy: Policy): PracticeMetrics {
  const driver = createPracticeDriver(track);
  driver.start(0);
  let held = false,
    offRoadTicks = 0,
    recoveryTicks = 0,
    slipTicks = 0,
    lifts = 0,
    minSpeed = Infinity,
    maxLateral = 0,
    steps = 0;
  const releases: { s: number; speed: number }[] = [];
  const cap = 123 * SIMULATION_HZ;
  for (
    let frame = 0;
    frame < cap && driver.active && !driver.completedLaps;
    frame++
  ) {
    const next = policy(driver.state, held);
    if (held && !next && driver.raceState.phase === 'racing') {
      lifts++;
      releases.push({ s: driver.state.distance, speed: driver.state.speed });
    }
    held = next;
    driver.setInput(held, (frame * 1000) / SIMULATION_HZ);
    driver.advance(((frame + 1) * 1000) / SIMULATION_HZ);
    if (driver.raceState.phase !== 'racing') continue;
    steps++;
    if (driver.state.offRoad) offRoadTicks++;
    if (driver.state.recovering) recoveryTicks++;
    if (driver.state.slip > 0.3) slipTicks++;
    if (driver.state.distance > 30)
      minSpeed = Math.min(minSpeed, driver.state.speed);
    maxLateral = Math.max(maxLateral, Math.abs(driver.state.lateralOffset));
  }
  const ticks = driver.lastLapTicks;
  return {
    finished: ticks !== null,
    ticks,
    seconds: ticks === null ? null : ticks / SIMULATION_HZ,
    offRoadTicks,
    recoveryTicks,
    recoveryCount: driver.state.recoveryCount,
    slipTicks,
    lifts,
    minSpeed: Number.isFinite(minSpeed) ? minSpeed : 0,
    maxLateral,
    steps,
    releases,
  };
}
export function replayPolicy(run: BotRun): Policy {
  let index = 0,
    held = false;
  return (state) => {
    while (
      index < run.replay.transitions.length &&
      run.replay.transitions[index]!.tick <= state.tick
    )
      held = run.replay.transitions[index++]!.held;
    return held;
  };
}
/** Conservative physical stopping envelope, sampled ahead. No substitute dynamics. */
export function envelopePolicy(track: Track, margin: number): Policy {
  const handling = handlingForTrack(track);
  let lastChange = -12;
  return (state, held) => {
    let target = handling.maximumSpeed;
    for (let d = 0; d <= 100; d += 5) {
      const curvature = Math.abs(
        sampleTrack(track, state.distance + d).curvature
      );
      if (curvature < 0.00001) continue;
      const corner = Math.sqrt((handling.lateralGrip * 0.95) / curvature);
      target = Math.min(
        target,
        Math.sqrt(
          corner * corner + 2 * handling.braking * Math.max(0, d - margin)
        )
      );
    }
    if (state.tick - lastChange < 12) return held;
    const next = held ? state.speed < target + 0.6 : state.speed < target - 0.6;
    if (next !== held) lastChange = state.tick;
    return next;
  };
}
export function evaluateBraking(track: Track) {
  const start = performance.now();
  const search = searchDrivingInputs(track);
  const fullHold = drivePractice(track, () => true);
  const searched = drivePractice(track, replayPolicy(search.fast));
  const early = drivePractice(track, envelopePolicy(track, 18));
  const timed = drivePractice(track, envelopePolicy(track, 5));
  const late = drivePractice(track, envelopePolicy(track, -5));
  const best =
    [searched, timed]
      .filter((run) => run.finished)
      .sort((a, b) => (a.ticks ?? Infinity) - (b.ticks ?? Infinity))[0] ??
    searched;
  return {
    runtime: runtimeForTrack(track).handlingVersion,
    fullHold,
    searched,
    timed,
    early,
    late,
    searchParity: searched.ticks === search.fast.summary.finishTicks,
    gainSeconds:
      fullHold.seconds !== null && best.seconds !== null
        ? fullHold.seconds - best.seconds
        : null,
    brakingLeads: search.peaks.map((peak) => {
      const release = searched.releases
        .filter((r) => r.s <= peak.s && peak.s - r.s < 100)
        .at(-1);
      const handling = handlingForTrack(track);
      const safeSpeed = Math.sqrt(
        (handling.lateralGrip * 0.9) / peak.curvature
      );
      return {
        s: peak.s,
        curvature: peak.curvature,
        safeSpeed,
        releaseSpeed: release?.speed ?? null,
        leadMetres: release ? peak.s - release.s : null,
        conservativeStopMetres: release
          ? Math.max(
              0,
              (release.speed ** 2 - safeSpeed ** 2) / (2 * handling.braking)
            )
          : null,
      };
    }),
    searchWork: search.work,
    wallMs: performance.now() - start,
  };
}
