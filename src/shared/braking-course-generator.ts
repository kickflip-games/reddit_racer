import { generateLinkedCourseCandidate } from './linked-course-generator';
import {
  LINKED_QUALITY_VERSION,
  LINKED_CANDIDATE_BUDGET,
  LINKED_QUALITY_BUDGET,
  LINKED_COURSE_VERSION,
  type LinkedCourseVersion,
} from './course-rhythm';
import { assessTrackQuality, type QualityAssessment } from './circuit-quality';
import type { GeneratorConfig } from './circuit-generator';
import type { ValidatedCircuit } from './circuit-quality';
import type { Track } from './track';

export const BRAKING_QUALITY_VERSION = LINKED_QUALITY_VERSION;
export const MAX_BRAKING_CANDIDATES = LINKED_CANDIDATE_BUDGET;
export const MAX_BRAKING_QUALITY_ATTEMPTS = LINKED_QUALITY_BUDGET;
/** Declared before the evaluation campaign; never relax these on rejected seeds. */
export const BRAKING_QUALITY_THRESHOLDS = Object.freeze({
  minFastSeconds: 20,
  maxFastSeconds: 60,
  minGainTicks: 90,
  minMeaningfulLifts: 3,
  maxMeaningfulLifts: 8,
  maxFastOffRoadFraction: 0.15,
});
export function assessBrakingTrack(track: Track): QualityAssessment {
  return assessTrackQuality(track, { thresholds: BRAKING_QUALITY_THRESHOLDS });
}
/** Bounded, deterministic gate. An invalid last candidate is never a silent reserve. */
export function generateBrakingCircuit(
  seed: string,
  maxAttempts = MAX_BRAKING_CANDIDATES,
  version: LinkedCourseVersion = LINKED_COURSE_VERSION
) {
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > MAX_BRAKING_CANDIDATES
  )
    throw new Error(
      `Braking candidate attempts must be 1–${MAX_BRAKING_CANDIDATES}.`
    );
  if (!seed || seed.length > 96)
    throw new Error('Braking course seeds must contain1–96 characters.');
  if (
    version !== LINKED_COURSE_VERSION &&
    version !== 'linked-circuits-v6' &&
    version !== 'linked-circuits-v5' &&
    version !== 'linked-circuits-v4'
  )
    throw new Error('Unsupported linked course recipe.');
  const rejections: { attempt: number; codes: string[] }[] = [];
  const qualityRejections: { attempt: number; codes: string[] }[] = [];
  let last: { track: Track; quality: QualityAssessment } | undefined;
  let simulatedTicks = 0,
    controllerRuns = 0,
    replayChecks = 0,
    qualityAttempts = 0,
    attempts = 0;
  for (
    let attempt = 1;
    attempt <= maxAttempts && qualityAttempts < MAX_BRAKING_QUALITY_ATTEMPTS;
    attempt++
  ) {
    attempts = attempt;
    const candidate = generateLinkedCourseCandidate(seed, attempt, version);
    if (!candidate.track || candidate.diagnostics.codes.length) {
      rejections.push({ attempt, codes: [...candidate.diagnostics.codes] });
      continue;
    }
    qualityAttempts++;
    const quality = assessBrakingTrack(candidate.track);
    simulatedTicks += quality.work.simulatedTicks;
    controllerRuns += quality.work.controllerRuns;
    replayChecks += quality.work.replayChecks;
    last = { track: candidate.track, quality };
    if (quality.valid)
      return {
        ...last,
        motifs: candidate.diagnostics.motifs,
        diagnostics: {
          fallbackUsed: false,
          requestedSeed: seed,
          acceptedAttempt: attempt,
          qualityVersion: quality.version,
          attempts: attempt,
          qualityAttempts,
          rejections,
          qualityRejections,
          simulatedTicks,
          controllerRuns,
          replayChecks,
        },
      };
    rejections.push({ attempt, codes: [...quality.codes] });
    qualityRejections.push({ attempt, codes: [...quality.codes] });
  }
  if (!last) throw new Error('No braking course candidate was produced.');
  return {
    ...last,
    motifs: [],
    diagnostics: {
      fallbackUsed: false,
      requestedSeed: seed,
      acceptedAttempt: null,
      qualityVersion: last.quality.version,
      attempts,
      qualityAttempts,
      rejections,
      qualityRejections,
      simulatedTicks,
      controllerRuns,
      replayChecks,
    },
  };
}

/** Storage adapter for the one current generator; no legacy generation fallback. */
export const CURRENT_COURSE_CONFIG: Readonly<GeneratorConfig> = Object.freeze({
  width: 7,
  lengthMin: 540,
  lengthMax: 900,
  minRadius: 10,
  clearance: 2,
  shoulder: 0.8,
  maxAttempts: MAX_BRAKING_CANDIDATES,
});
export const CURRENT_COURSE_RESERVE_SEED = 'current-course-reserve';
export function normalizeCurrentCourseConfig(
  input: Partial<GeneratorConfig> = {}
): GeneratorConfig {
  const c = { ...CURRENT_COURSE_CONFIG, ...input };
  if (
    Object.keys(input).some((k) => !Object.hasOwn(CURRENT_COURSE_CONFIG, k)) ||
    Object.entries(CURRENT_COURSE_CONFIG).some(
      ([k, v]) => Object.entries(c).find(([key]) => key === k)?.[1] !== v
    )
  )
    throw new Error(
      'Current course audit configuration does not match the generator.'
    );
  return c;
}
function generateLinkedDailyCircuit(
  seed: string,
  version: LinkedCourseVersion
): ValidatedCircuit {
  const result = generateBrakingCircuit(seed, undefined, version);
  if (!result.quality.valid || result.diagnostics.acceptedAttempt === null)
    throw new Error('Current course failed bounded braking quality gates.');
  if (
    result.track.totalLength < CURRENT_COURSE_CONFIG.lengthMin ||
    result.track.totalLength > CURRENT_COURSE_CONFIG.lengthMax
  )
    throw new Error('Current course length is outside its declared bounds.');
  const d = result.diagnostics;
  return {
    track: result.track,
    quality: result.quality,
    diagnostics: {
      requestedSeed: seed,
      version: result.track.generatorVersion,
      config: normalizeCurrentCourseConfig(),
      attempts: d.attempts,
      fallbackUsed: false,
      rejections: d.rejections,
      accepted: {
        ...result.quality.structure.metrics,
        candidateSeed: `${seed}:attempt:${d.acceptedAttempt}`,
        motifs: result.motifs,
        controlPoints: [],
      },
      qualityVersion: result.quality.version,
      qualityAttempts: d.qualityAttempts,
      qualityRejections: d.qualityRejections.map((r) => ({
        ...r,
        candidateSeed: seed,
      })),
      validationWork: {
        candidates: d.attempts,
        qualityAssessments: d.qualityAttempts,
        reserveAssessments: 0,
        controllerRuns: d.controllerRuns,
        simulatedTicks: d.simulatedTicks,
        replayChecks: d.replayChecks,
      },
    },
  };
}

export function generateCurrentDailyCircuit(seed: string): ValidatedCircuit {
  return generateLinkedDailyCircuit(seed, LINKED_COURSE_VERSION);
}

/** Exact reconstruction for retained shares and compatibility fixtures only. */
export function generateRetainedV4DailyCircuit(seed: string): ValidatedCircuit {
  return generateLinkedDailyCircuit(seed, 'linked-circuits-v4');
}
