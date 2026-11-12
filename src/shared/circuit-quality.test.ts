import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessTrackQuality,
  DEFAULT_QUALITY_THRESHOLDS,
  generateValidatedCircuit,
  MAX_QUALITY_ASSESSMENTS,
  MAX_QUALITY_TICKS,
  QUALITY_VERSION,
} from './circuit-quality.ts';
import { generateCircuit, FALLBACK_CIRCUIT_SEED } from './circuit-generator.ts';
import { assessTrackStructure } from './circuit-validation.ts';
import { MAX_CONTROLLER_RUNS } from './driving-bots.ts';
import { MAX_SIMULATION_TICKS } from './simulation.ts';
import { runReplay } from './replay.ts';
import { hashTrack } from './track.ts';
import { createOvalTrack } from './track-authoring.ts';
import {
  oscillatingCurvatureFixture,
  overlappingCorridorFixture,
  unsafeStartSeamFixture,
  unfinishableDurationFixture,
} from './fixtures/quality-tracks.ts';
import { EXPECTED_RESERVE_CIRCUIT_HASH } from './fixtures/showcase-circuits.ts';

void test('quality acceptance uses three completed real controllers and versioned finite thresholds', () => {
  const quality = assessTrackQuality(
    generateCircuit(FALLBACK_CIRCUIT_SEED).track
  );
  assert.equal(quality.valid, true);
  assert.equal(quality.version, QUALITY_VERSION);
  assert.deepEqual(quality.codes, []);
  assert.deepEqual(quality.thresholds, DEFAULT_QUALITY_THRESHOLDS);
  assert.ok(quality.metrics);
  assert.equal(quality.metrics.fast.finishTicks, 2848);
  assert.equal(quality.metrics.gainTicks, 470);
  assert.equal(quality.metrics.meaningfulLifts, 3);
  assert.equal(quality.metrics.fast.recoveryTicks, 0);
  assert.equal(quality.work.replayChecks, 3);
  assert.ok(quality.work.controllerRuns <= MAX_CONTROLLER_RUNS);
  assert.ok(quality.work.simulatedTicks <= MAX_QUALITY_TICKS);
  assert.ok(quality.fastReplay);
});

void test('structural defects, unsafe start seam and high-frequency curvature reject before bot work', () => {
  const invalid = createOvalTrack();
  invalid.totalLength += 1;
  const malformed = assessTrackQuality(invalid);
  assert.equal(malformed.valid, false);
  assert.ok(malformed.codes.includes('malformed-track'));
  assert.equal(malformed.metrics, null);
  assert.equal(malformed.work.controllerRuns, 0);
  const seam = assessTrackQuality(unsafeStartSeamFixture());
  assert.equal(seam.structure.valid, true);
  assert.ok(seam.codes.includes('seam-smoothness'));
  assert.equal(seam.work.controllerRuns, 0);
  const noisy = assessTrackQuality(oscillatingCurvatureFixture());
  assert.equal(noisy.structure.valid, true);
  assert.ok(noisy.codes.includes('curvature-smoothness'));
  assert.equal(noisy.work.controllerRuns, 0);
  const overlap = assessTrackStructure(overlappingCorridorFixture(), {
    minRadius: 4,
    clearance: 2,
    shoulder: 0.8,
  });
  assert.ok(overlap.codes.includes('road-clearance'));
  assert.equal(
    overlap.codes.includes('centerline-intersection'),
    false,
    'a noncrossing centreline is insufficient'
  );
});

void test('bounded unfinished controls cannot produce a fast score or accepted track', () => {
  const quality = assessTrackQuality(unfinishableDurationFixture());
  assert.equal(quality.structure.valid, true);
  assert.equal(quality.valid, false);
  assert.ok(quality.codes.includes('cautious-unfinished'));
  assert.ok(quality.codes.includes('hold-unfinished'));
  assert.ok(quality.codes.includes('fast-unfinished'));
  assert.equal(quality.metrics?.fast.finishTicks, null);
  assert.equal(quality.metrics?.fast.seconds, null);
  assert.equal(quality.metrics?.fast.elapsedTicks, MAX_SIMULATION_TICKS);
  assert.equal(quality.fastReplay, null);
  assert.equal(quality.work.replayChecks, 0);
});

void test('a quality failure retries a different candidate; its bounded reserve is also quality-validated', async () => {
  const retried = generateValidatedCircuit('showcase-3');
  assert.equal(retried.quality.valid, true);
  assert.equal(retried.diagnostics.qualityAttempts, 2);
  assert.ok(
    retried.diagnostics.qualityRejections.some((rejection) =>
      rejection.codes.includes('braking-opportunities')
    )
  );
  const reserve = generateValidatedCircuit('showcase-3', {
    maxQualityAttempts: 1,
  });
  assert.equal(reserve.diagnostics.fallbackUsed, true);
  assert.equal(reserve.diagnostics.qualityAttempts, 1);
  assert.equal(reserve.diagnostics.validationWork.reserveAssessments, 1);
  assert.equal(reserve.diagnostics.validationWork.qualityAssessments, 2);
  assert.equal(reserve.diagnostics.requestedSeed, 'showcase-3');
  assert.equal(reserve.track.seed, FALLBACK_CIRCUIT_SEED);
  assert.equal(await hashTrack(reserve.track), EXPECTED_RESERVE_CIRCUIT_HASH);
  assert.equal(reserve.quality.valid, true);
  assert.throws(
    () =>
      generateValidatedCircuit('strict', {
        quality: { minFastSeconds: 20, maxFastSeconds: 20 },
        maxQualityAttempts: 1,
      }),
    /reserve fails quality/
  );
});

void test('quality settings cannot introduce nonfinite, unbounded or unsupported work requests', () => {
  const track = generateCircuit(FALLBACK_CIRCUIT_SEED).track;
  for (const thresholds of [
    { minFastSeconds: NaN },
    { maxFastSeconds: Infinity },
    { maxFastSeconds: 121 },
    { minGainTicks: 0 },
    { minLiftTicks: 11 },
    { minMeaningfulLifts: 0 },
    { maxMeaningfulLifts: 9 },
    { maxFastOffRoadFraction: -1 },
    { maxCurvatureSlope: 0 },
    { maxSeamTangentAngle: -1 },
  ])
    assert.throws(
      () => assessTrackQuality(track, { thresholds }),
      /thresholds/
    );
  assert.throws(
    () => assessTrackQuality(track, JSON.parse('{"unknown":true}')),
    /Unknown/
  );
  assert.throws(
    () =>
      assessTrackQuality(track, { thresholds: JSON.parse('{"unknown":1}') }),
    /thresholds/
  );
  for (const maxQualityAttempts of [0, 5, 1.5])
    assert.throws(
      () => generateValidatedCircuit('bounds', { maxQualityAttempts }),
      /limit/
    );
  assert.throws(
    () => generateValidatedCircuit('bounds', JSON.parse('{"unknown":true}')),
    /Unknown/
  );
});

void test(
  '200 fixed seeds produce reproducible quality-approved circuits within explicit budgets',
  { timeout: 120_000 },
  () => {
    let fallbackCount = 0,
      totalQualityFailures = 0;
    const fastTimes: number[] = [];
    for (let index = 0; index < 200; index++) {
      const generated = generateValidatedCircuit(`regression-${index}`);
      const quality = generated.quality,
        metrics = quality.metrics,
        work = generated.diagnostics.validationWork;
      assert.equal(quality.valid, true, `${index}: ${quality.codes.join(',')}`);
      assert.ok(metrics && quality.fastReplay);
      assert.ok(
        metrics.hold.finished &&
          metrics.cautious.finished &&
          metrics.fast.finished
      );
      assert.ok(
        metrics.fast.seconds !== null &&
          metrics.fast.seconds >= 20 &&
          metrics.fast.seconds <= 40
      );
      assert.ok(metrics.gainTicks >= 60);
      assert.ok(metrics.meaningfulLifts >= 3 && metrics.meaningfulLifts <= 8);
      assert.equal(metrics.fast.recoveryTicks, 0);
      assert.ok(
        metrics.fast.finishTicks !== null &&
          metrics.fast.offRoadTicks / metrics.fast.finishTicks <= 0.15
      );
      assert.ok(work.candidates <= 13);
      assert.ok(
        generated.diagnostics.qualityAttempts <= MAX_QUALITY_ASSESSMENTS
      );
      assert.ok(work.qualityAssessments <= MAX_QUALITY_ASSESSMENTS + 1);
      assert.ok(
        work.controllerRuns <= work.qualityAssessments * MAX_CONTROLLER_RUNS
      );
      assert.ok(
        work.simulatedTicks <= work.qualityAssessments * MAX_QUALITY_TICKS
      );
      assert.equal(
        runReplay(generated.track, quality.fastReplay).finishTicks,
        metrics.fast.finishTicks
      );
      fastTimes.push(metrics.fast.seconds);
      fallbackCount += Number(generated.diagnostics.fallbackUsed);
      totalQualityFailures += generated.diagnostics.qualityRejections.length;
    }
    assert.ok(
      fallbackCount <= 10,
      `${fallbackCount}/200 reserve uses exceeds5%`
    );
    assert.ok(
      totalQualityFailures > 0,
      'suite must exercise quality rejection as well as success'
    );
    assert.ok(
      Math.max(...fastTimes) - Math.min(...fastTimes) > 5,
      'approved courses should retain duration variety'
    );
  }
);
