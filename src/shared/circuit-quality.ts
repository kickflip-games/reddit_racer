import {
  FALLBACK_CIRCUIT_ATTEMPT,
  FALLBACK_CIRCUIT_SEED,
  generateCircuitCandidate,
  GENERATOR_VERSION,
  normalizeGeneratorConfig,
} from './circuit-generator.ts';
import type {
  GenerationDiagnostics,
  GeneratorConfig,
} from './circuit-generator.ts';
import {
  assessTrackStructure,
  MIN_START_STRAIGHT,
} from './circuit-validation.ts';
import type {
  StructuralAssessment,
  StructuralOptions,
} from './circuit-validation.ts';
import { MAX_CONTROLLER_RUNS, searchDrivingInputs } from './driving-bots.ts';
import type { BotRunSummary, BrakingPeak } from './driving-bots.ts';
import { runReplay } from './replay.ts';
import type { Replay } from './replay.ts';
import { MAX_SIMULATION_TICKS } from './simulation.ts';
import type { Track } from './track.ts';

export const QUALITY_VERSION = 'quality-v1';
export const ELEVATED_QUALITY_VERSION = 'quality-v3';
export const qualityVersionForTrack = (track: Track): string =>
  track.schemaVersion === 2 ? ELEVATED_QUALITY_VERSION : QUALITY_VERSION;
export const MAX_QUALITY_ASSESSMENTS = 4;
export const MAX_REPLAY_CHECKS = 3;
export const MAX_QUALITY_TICKS =
  (MAX_CONTROLLER_RUNS + MAX_REPLAY_CHECKS) * MAX_SIMULATION_TICKS;
export type QualityThresholds = {
  minFastSeconds: number;
  maxFastSeconds: number;
  minGainTicks: number;
  minMeaningfulLifts: number;
  maxMeaningfulLifts: number;
  minLiftTicks: number;
  maxFastOffRoadFraction: number;
  minDirectionChanges: number;
  maxCurvatureSlope: number;
  maxSeamTangentAngle: number;
  maxSeamCurvatureSlope: number;
};
export const DEFAULT_QUALITY_THRESHOLDS: Readonly<QualityThresholds> =
  Object.freeze({
    minFastSeconds: 20,
    maxFastSeconds: 40,
    minGainTicks: 60,
    minMeaningfulLifts: 3,
    maxMeaningfulLifts: 8,
    minLiftTicks: 12,
    maxFastOffRoadFraction: 0.15,
    minDirectionChanges: 2,
    maxCurvatureSlope: 0.05,
    maxSeamTangentAngle: 0.02,
    maxSeamCurvatureSlope: 0.005,
  });
export type QualityWork = {
  controllerRuns: number;
  simulatedTicks: number;
  replayChecks: number;
};
export type QualityMetrics = {
  hold: BotRunSummary;
  cautious: BotRunSummary;
  fast: BotRunSummary;
  gainTicks: number;
  meaningfulLifts: number;
  maxCurvatureSlope: number;
  seamTangentAngle: number;
  seamCurvatureSlope: number;
};
export type QualityAssessment = {
  valid: boolean;
  codes: string[];
  version: string;
  thresholds: QualityThresholds;
  structure: StructuralAssessment;
  metrics: QualityMetrics | null;
  fastReplay: Replay | null;
  work: QualityWork;
  search: { peaks: BrakingPeak[]; widths: number[] };
};
export type QualityOptions = {
  thresholds?: Partial<QualityThresholds>;
  structure?: StructuralOptions;
};
export type ValidatedGeneratorOptions = {
  generator?: Partial<GeneratorConfig>;
  quality?: Partial<QualityThresholds>;
  maxQualityAttempts?: number;
};
export type ValidatedDiagnostics = GenerationDiagnostics & {
  qualityVersion: string;
  qualityAttempts: number;
  qualityRejections: {
    attempt: number;
    candidateSeed: string;
    codes: string[];
  }[];
  validationWork: QualityWork & {
    candidates: number;
    qualityAssessments: number;
    reserveAssessments: number;
  };
};
export type ValidatedCircuit = {
  track: Track;
  diagnostics: ValidatedDiagnostics;
  quality: QualityAssessment;
};

function thresholdsFor(
  overrides: Partial<QualityThresholds> = {}
): QualityThresholds {
  const thresholds = { ...DEFAULT_QUALITY_THRESHOLDS, ...overrides };
  if (
    Object.keys(overrides).some(
      (key) => !Object.hasOwn(DEFAULT_QUALITY_THRESHOLDS, key)
    ) ||
    !Object.values(thresholds).every(Number.isFinite) ||
    thresholds.minFastSeconds < 10 ||
    thresholds.maxFastSeconds > 120 ||
    thresholds.maxFastSeconds < thresholds.minFastSeconds ||
    !Number.isInteger(thresholds.minGainTicks) ||
    thresholds.minGainTicks < 1 ||
    thresholds.minGainTicks > 1200 ||
    !Number.isInteger(thresholds.minMeaningfulLifts) ||
    thresholds.minMeaningfulLifts < 1 ||
    !Number.isInteger(thresholds.maxMeaningfulLifts) ||
    thresholds.maxMeaningfulLifts > 8 ||
    thresholds.maxMeaningfulLifts < thresholds.minMeaningfulLifts ||
    !Number.isInteger(thresholds.minLiftTicks) ||
    thresholds.minLiftTicks < 12 ||
    thresholds.minLiftTicks > 120 ||
    thresholds.maxFastOffRoadFraction < 0 ||
    thresholds.maxFastOffRoadFraction > 0.5 ||
    !Number.isInteger(thresholds.minDirectionChanges) ||
    thresholds.minDirectionChanges < 1 ||
    thresholds.minDirectionChanges > 16 ||
    thresholds.maxCurvatureSlope <= 0 ||
    thresholds.maxCurvatureSlope > 1 ||
    thresholds.maxSeamTangentAngle <= 0 ||
    thresholds.maxSeamTangentAngle > 0.2 ||
    thresholds.maxSeamCurvatureSlope <= 0 ||
    thresholds.maxSeamCurvatureSlope > 0.1
  )
    throw new Error('Quality thresholds exceed supported bounds');
  return thresholds;
}
function smoothness(track: Track): {
  maxCurvatureSlope: number;
  seamTangentAngle: number;
  seamCurvatureSlope: number;
} {
  let maxCurvatureSlope = 0;
  for (let index = 0; index < track.samples.length; index++) {
    const current = track.samples[index],
      next = track.samples[(index + 1) % track.samples.length];
    if (!current || !next) throw new Error('Incomplete smoothness sample');
    const distance =
      index + 1 === track.samples.length
        ? track.totalLength - current.s
        : next.s - current.s;
    maxCurvatureSlope = Math.max(
      maxCurvatureSlope,
      Math.abs(next.curvature - current.curvature) / distance
    );
  }
  const first = track.samples[0],
    last = track.samples.at(-1);
  if (!first || !last) throw new Error('Missing seam samples');
  return {
    maxCurvatureSlope,
    seamTangentAngle: Math.acos(
      Math.max(-1, Math.min(1, first.tx * last.tx + first.tz * last.tz))
    ),
    seamCurvatureSlope:
      Math.abs(first.curvature - last.curvature) / (track.totalLength - last.s),
  };
}

/** Structural + real race-model controls; no alternate vehicle dynamics are used. */
export function assessTrackQuality(
  track: Track,
  options: QualityOptions = {}
): QualityAssessment {
  if (
    Object.keys(options).some(
      (key) => !['thresholds', 'structure'].includes(key)
    )
  )
    throw new Error('Unknown track quality option');
  const thresholds = thresholdsFor({
    ...(track.schemaVersion === 2 ? { minMeaningfulLifts: 2 } : {}),
    ...options.thresholds,
  });
  const structure = assessTrackStructure(track, options.structure);
  const codes = [...structure.codes];
  const result: QualityAssessment = {
    valid: false,
    codes,
    version: qualityVersionForTrack(track),
    thresholds,
    structure,
    metrics: null,
    fastReplay: null,
    work: { controllerRuns: 0, simulatedTicks: 0, replayChecks: 0 },
    search: { peaks: [], widths: [] },
  };
  if (!structure.valid) return result;
  if (structure.metrics.startStraight < MIN_START_STRAIGHT)
    codes.push('start-straight');
  if (structure.metrics.directionChanges < thresholds.minDirectionChanges)
    codes.push('corner-diversity');
  const smooth = smoothness(track);
  if (smooth.maxCurvatureSlope > thresholds.maxCurvatureSlope)
    codes.push('curvature-smoothness');
  if (
    smooth.seamTangentAngle > thresholds.maxSeamTangentAngle ||
    smooth.seamCurvatureSlope > thresholds.maxSeamCurvatureSlope
  )
    codes.push('seam-smoothness');
  if (codes.length) return result;
  const search = searchDrivingInputs(track, thresholds.minLiftTicks);
  result.search = { peaks: search.peaks, widths: search.widths };
  result.work.controllerRuns = search.work.controllerRuns;
  result.work.simulatedTicks = search.work.simulatedTicks;
  const hold = search.hold.summary,
    cautious = search.cautious.summary,
    fast = search.fast.summary;
  const gainTicks =
    hold.finishTicks !== null && fast.finishTicks !== null
      ? hold.finishTicks - fast.finishTicks
      : 0;
  result.metrics = {
    hold,
    cautious,
    fast,
    gainTicks,
    meaningfulLifts: fast.meaningfulLifts,
    ...smooth,
  };
  if (track.schemaVersion === 2) {
    if (
      track.jumps?.length &&
      ((fast.airborneTicks ?? 0) < 12 || (fast.landings ?? 0) < 1)
    )
      codes.push('no-playable-jump');
    if ((fast.airborneCornerTicks ?? 0) > 0 || (fast.maxAirHeight ?? 0) > 6)
      codes.push('unsafe-jump-landing');
  }
  if (!hold.finished) codes.push('hold-unfinished');
  if (!cautious.finished) codes.push('cautious-unfinished');
  if (!fast.finished || fast.seconds === null) codes.push('fast-unfinished');
  else if (
    fast.seconds < thresholds.minFastSeconds ||
    fast.seconds > thresholds.maxFastSeconds
  )
    codes.push('fast-duration');
  if (gainTicks < thresholds.minGainTicks) codes.push('no-braking-benefit');
  if (
    fast.meaningfulLifts < thresholds.minMeaningfulLifts ||
    fast.meaningfulLifts > thresholds.maxMeaningfulLifts
  )
    codes.push('braking-opportunities');
  if (fast.recoveryCount > 0 || fast.recoveryTicks > 0)
    codes.push('fast-recovery');
  if (
    fast.finishTicks !== null &&
    fast.offRoadTicks / fast.finishTicks > thresholds.maxFastOffRoadFraction
  )
    codes.push('fast-off-road');
  for (const run of [search.hold, search.cautious, search.fast]) {
    if (!run.summary.finished) continue;
    result.work.replayChecks++;
    // Count the replay's bounded tick budget even if verification rejects it.
    result.work.simulatedTicks += run.replay.endTick;
    try {
      const verified = runReplay(track, run.replay);
      if (verified.finishTicks !== run.summary.finishTicks)
        codes.push('replay-mismatch');
    } catch {
      codes.push('replay-mismatch');
    }
  }
  result.fastReplay = fast.finished ? search.fast.replay : null;
  result.valid = codes.length === 0;
  return result;
}

/** At most12 structural candidates,4 requested quality assessments, then one reserve. */
export function generateValidatedCircuit(
  seed: string,
  options: ValidatedGeneratorOptions = {}
): ValidatedCircuit {
  if (
    Object.keys(options).some(
      (key) => !['generator', 'quality', 'maxQualityAttempts'].includes(key)
    )
  )
    throw new Error('Unknown validated generator option');
  const generator = normalizeGeneratorConfig(options.generator);
  const thresholds = thresholdsFor(options.quality);
  const qualityLimit = options.maxQualityAttempts ?? MAX_QUALITY_ASSESSMENTS;
  if (
    !Number.isInteger(qualityLimit) ||
    qualityLimit < 1 ||
    qualityLimit > MAX_QUALITY_ASSESSMENTS
  )
    throw new Error('Quality attempt limit must be1–4');
  const diagnostics: ValidatedDiagnostics = {
    requestedSeed: seed,
    version: GENERATOR_VERSION,
    config: generator,
    attempts: 0,
    fallbackUsed: false,
    rejections: [],
    accepted: {
      candidateSeed: '',
      motifs: [],
      controlPoints: [],
      length: 0,
      minRadius: 0,
      minClearance: 0,
      longestStraight: 0,
      startStraight: 0,
      directionChanges: 0,
      curvatureProfile: [],
    },
    qualityVersion: QUALITY_VERSION,
    qualityAttempts: 0,
    qualityRejections: [],
    validationWork: {
      candidates: 0,
      qualityAssessments: 0,
      reserveAssessments: 0,
      controllerRuns: 0,
      simulatedTicks: 0,
      replayChecks: 0,
    },
  };
  const assess = (track: Track): QualityAssessment => {
    const quality = assessTrackQuality(track, {
      thresholds,
      structure: {
        minRadius: generator.minRadius,
        clearance: generator.clearance,
        shoulder: generator.shoulder,
      },
    });
    diagnostics.validationWork.qualityAssessments++;
    diagnostics.validationWork.controllerRuns += quality.work.controllerRuns;
    diagnostics.validationWork.simulatedTicks += quality.work.simulatedTicks;
    diagnostics.validationWork.replayChecks += quality.work.replayChecks;
    return quality;
  };
  for (
    let attempt = 1;
    attempt <= generator.maxAttempts &&
    diagnostics.qualityAttempts < qualityLimit;
    attempt++
  ) {
    const candidate = generateCircuitCandidate(seed, attempt, generator);
    diagnostics.attempts = attempt;
    diagnostics.validationWork.candidates++;
    if (!candidate.track || candidate.diagnostics.codes.length) {
      diagnostics.rejections.push({
        attempt,
        codes: candidate.diagnostics.codes,
      });
      continue;
    }
    diagnostics.qualityAttempts++;
    const quality = assess(candidate.track);
    if (!quality.valid) {
      diagnostics.rejections.push({
        attempt,
        codes: quality.codes.map((code) => `quality:${code}`),
      });
      diagnostics.qualityRejections.push({
        attempt,
        candidateSeed: candidate.diagnostics.candidateSeed,
        codes: quality.codes,
      });
      continue;
    }
    const { codes: _codes, ...accepted } = candidate.diagnostics;
    diagnostics.accepted = accepted;
    return { track: candidate.track, diagnostics, quality };
  }
  const reserve = generateCircuitCandidate(
    FALLBACK_CIRCUIT_SEED,
    FALLBACK_CIRCUIT_ATTEMPT,
    generator
  );
  diagnostics.validationWork.candidates++;
  if (!reserve.track || reserve.diagnostics.codes.length)
    throw new Error(
      `Validated reserve fails structural configuration (${reserve.diagnostics.codes.join(', ')})`
    );
  const quality = assess(reserve.track);
  diagnostics.validationWork.reserveAssessments = 1;
  if (!quality.valid)
    throw new Error(
      `Validated reserve fails quality configuration (${quality.codes.join(', ')})`
    );
  const { codes: _codes, ...accepted } = reserve.diagnostics;
  diagnostics.accepted = accepted;
  diagnostics.fallbackUsed = true;
  return { track: reserve.track, diagnostics, quality };
}
