import { generateBrakeRhythmCandidate } from './brake-rhythm-generator';
import { assessTrackQuality, type QualityAssessment } from './circuit-quality';
import type { Track } from './track';

export const BRAKING_QUALITY_VERSION = 'braking-quality-v1';
export const MAX_BRAKING_QUALITY_ATTEMPTS = 3;
/** Declared before the evaluation campaign; never relax these on rejected seeds. */
export const BRAKING_QUALITY_THRESHOLDS = Object.freeze({
  minFastSeconds: 20,
  maxFastSeconds: 60,
  minGainTicks: 90,
  minMeaningfulLifts: 2,
  maxMeaningfulLifts: 8,
  maxFastOffRoadFraction: 0.15,
});
export function assessBrakingTrack(track: Track): QualityAssessment {
  return assessTrackQuality(track, { thresholds: BRAKING_QUALITY_THRESHOLDS });
}
/** Bounded, deterministic gate. An invalid last candidate is never a silent reserve. */
export function generateBrakingCircuit(
  seed: string,
  maxAttempts = MAX_BRAKING_QUALITY_ATTEMPTS
) {
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > MAX_BRAKING_QUALITY_ATTEMPTS
  )
    throw new Error('Braking quality attempts must be1–3.');
  if (!seed || seed.length > 96)
    throw new Error('Braking course seeds must contain1–96 characters.');
  const rejections: { attempt: number; codes: string[] }[] = [];
  let last: { track: Track; quality: QualityAssessment } | undefined;
  let simulatedTicks = 0,
    controllerRuns = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const candidate = generateBrakeRhythmCandidate(seed, attempt);
    const quality = assessBrakingTrack(candidate.track);
    simulatedTicks += quality.work.simulatedTicks;
    controllerRuns += quality.work.controllerRuns;
    last = { track: candidate.track, quality };
    if (quality.valid)
      return {
        ...last,
        motifs: candidate.motifs,
        diagnostics: {
          fallbackUsed: false,
          requestedSeed: seed,
          acceptedAttempt: attempt,
          qualityVersion: BRAKING_QUALITY_VERSION,
          attempts: attempt,
          rejections,
          simulatedTicks,
          controllerRuns,
        },
      };
    rejections.push({ attempt, codes: [...quality.codes] });
  }
  if (!last) throw new Error('No braking course candidate was produced.');
  return {
    ...last,
    motifs: [],
    diagnostics: {
      fallbackUsed: false,
      requestedSeed: seed,
      acceptedAttempt: null,
      qualityVersion: BRAKING_QUALITY_VERSION,
      attempts: maxAttempts,
      rejections,
      simulatedTicks,
      controllerRuns,
    },
  };
}
