import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateBrakingCircuit,
  assessBrakingTrack,
  MAX_BRAKING_CANDIDATES,
  MAX_BRAKING_QUALITY_ATTEMPTS,
} from '../../src/shared/braking-course-generator';
import {
  LINKED_COURSE_VERSION,
  LINKED_QUALITY_VERSION,
  longestThrottleTicks,
  LINKED_RHYTHM_LIMITS,
} from '../../src/shared/course-rhythm';
import { generateBrakeRhythmCandidate } from '../../src/shared/brake-rhythm-generator';
import { generateLinkedCourseCandidate } from '../../src/shared/linked-course-generator';
import { serializeTrack } from '../../src/shared/track';
import { runtimeForTrack } from '../../src/shared/scored-runtime';
import type { Replay } from '../../src/shared/replay';

void test('brief throttle taps do not hide a long passive driving interval', () => {
  const replay: Replay = {
    schemaVersion: 1,
    simulationVersion: 'fixed-step-v6',
    handlingVersion: 'progressive-slip-v1',
    endTick: 1500,
    transitions: [
      { tick: 0, held: true },
      { tick: 600, held: false },
      { tick: 606, held: true },
      { tick: 1000, held: false },
      { tick: 1060, held: true },
    ],
  };
  assert.equal(longestThrottleTicks(replay), 1000);
});

void test('linked courses distribute real braking decisions while retaining safe rolling elevation', () => {
  const profiles = new Set<string>();
  for (const i of [...Array.from({ length: 12 }, (_, i) => i), 29, 66, 85]) {
    const result = generateBrakingCircuit(`word-v2:evaluation-${i}`);
    const { track, quality, diagnostics } = result;
    assert.ok(quality.valid, JSON.stringify({ i, diagnostics }));
    assert.equal(track.generatorVersion, LINKED_COURSE_VERSION);
    assert.equal(quality.version, LINKED_QUALITY_VERSION);
    assert.equal(track.schemaVersion, 2);
    assert.ok(track.totalLength >= 540 && track.totalLength <= 900);
    assert.equal(diagnostics.fallbackUsed, false);
    assert.ok(diagnostics.attempts <= MAX_BRAKING_CANDIDATES);
    assert.ok(diagnostics.qualityAttempts <= MAX_BRAKING_QUALITY_ATTEMPTS);
    assert.ok(
      quality.structure.metrics.longestStraight <=
        LINKED_RHYTHM_LIMITS.longestStraight
    );
    assert.ok(Math.max(...track.samples.map((p) => p.y ?? 0)) >= 1);
    assert.ok(track.samples.every((p) => Math.abs(p.curvature) <= 0.1));
    assert.ok(
      track.samples
        .filter((p) => p.s < 20 || p.s > track.totalLength - 20)
        .every((p) => p.y === 0 && p.grade === 0 && p.verticalCurvature === 0)
    );
    assert.ok(quality.metrics && quality.fastReplay);
    assert.ok(quality.metrics.meaningfulLifts >= 3);
    assert.ok(quality.metrics.gainTicks >= 90);
    assert.equal(quality.metrics.fast.recoveryCount, 0);
    assert.equal(quality.metrics.fast.airborneCornerTicks, 0);
    assert.equal(quality.work.replayChecks, 3);
    assert.ok(
      longestThrottleTicks(quality.fastReplay) <=
        LINKED_RHYTHM_LIMITS.longestThrottleTicks
    );
    profiles.add(JSON.stringify(quality.structure.metrics.curvatureProfile));
  }
  assert.equal(profiles.size, 15);
});

void test('new acceptance policy rejects the passive rectangle and flattened elevation before search', () => {
  const old = generateBrakeRhythmCandidate('word-v2:evaluation-0').track;
  const passive = assessBrakingTrack({
    ...old,
    generatorVersion: 'linked-circuits-v5',
  });
  assert.ok(passive.codes.includes('passive-straight'));
  assert.equal(passive.work.controllerRuns, 0);
  const linked = generateBrakingCircuit('word-v2:banana').track;
  const flat = assessBrakingTrack({
    ...linked,
    samples: linked.samples.map((p) => ({
      ...p,
      y: 0,
      grade: 0,
      verticalCurvature: 0,
    })),
  });
  assert.ok(flat.codes.includes('missing-elevation'));
  assert.equal(flat.work.controllerRuns, 0);
  assert.equal(runtimeForTrack(linked).simulationVersion, 'fixed-step-v9');
  assert.equal(runtimeForTrack(old).simulationVersion, 'fixed-step-v6');
});

void test('candidate budgets are finite and seed reproduction is independent of other requests', () => {
  const first = generateLinkedCourseCandidate('word-v2:banana');
  assert.ok(first.track);
  generateLinkedCourseCandidate('some-other-seed');
  assert.equal(
    serializeTrack(first.track),
    serializeTrack(generateLinkedCourseCandidate('word-v2:banana').track!)
  );
  assert.throws(() => generateLinkedCourseCandidate('', 1));
  assert.throws(() =>
    generateLinkedCourseCandidate('x', MAX_BRAKING_CANDIDATES + 1)
  );
});

void test('V7 searches past twelve rejected jump approaches without relaxing safety gates', () => {
  const seed = 'daily:t5_rhythm:2027-02-14';
  const exhausted = generateBrakingCircuit(seed, 12);
  assert.equal(exhausted.quality.valid, false);
  assert.equal(exhausted.diagnostics.acceptedAttempt, null);
  const result = generateBrakingCircuit(seed);
  assert.equal(result.diagnostics.acceptedAttempt, 13);
  assert.equal(result.diagnostics.qualityAttempts, 13);
  assert.equal(result.quality.valid, true);
  assert.deepEqual(result.quality.codes, []);
  assert.equal(result.quality.metrics?.fast.recoveryCount, 0);
  assert.equal(result.quality.metrics?.fast.airborneCornerTicks, 0);
  assert.equal(result.diagnostics.fallbackUsed, false);
});

void test('v8 daily selection stays bounded and meets unchanged quality limits', () => {
  const seed = 'daily:t5_rhythm:2027-03-30';
  const exhausted = generateBrakingCircuit(seed, 24, 'linked-circuits-v5');
  assert.equal(exhausted.quality.valid, true);
  assert.equal(exhausted.diagnostics.acceptedAttempt, 3);
  const result = generateBrakingCircuit(seed, undefined, 'linked-circuits-v5');
  assert.equal(result.quality.valid, true);
  assert.deepEqual(result.quality.codes, []);
  assert.equal(result.diagnostics.acceptedAttempt, 3);
  assert.equal(result.diagnostics.qualityAttempts, 2);
  assert.equal(result.diagnostics.fallbackUsed, false);
});
