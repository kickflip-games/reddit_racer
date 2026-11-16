import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateFixedBrakeMotifCourse } from '../../src/shared/brake-rhythm-generator.ts';
import {
  assessBrakingTrack,
  generateBrakingCircuit,
  MAX_BRAKING_QUALITY_ATTEMPTS,
  MAX_BRAKING_CANDIDATES,
} from '../../src/shared/braking-course-generator.ts';
import { evaluateBraking } from '../../scripts/lib/braking-validation.ts';
import { hashTrack } from '../../src/shared/track.ts';
void test('actual continuous practice driver reproduces ranked search and easy sweeper is flat-out', () => {
  const r = evaluateBraking(generateFixedBrakeMotifCourse('sweeper').track);
  assert.equal(r.searchParity, true);
  assert.equal(r.fullHold.finished, true);
  assert.equal(r.fullHold.offRoadTicks, 0);
  assert.equal(r.searched.ticks, r.fullHold.ticks);
  assert.equal(r.fullHold.recoveryCount, 0);
});
void test('tightening corner rewards a real brake input and early braking only costs time', () => {
  const r = evaluateBraking(
    generateFixedBrakeMotifCourse('tightening-corner').track
  );
  assert.equal(r.searchParity, true);
  assert.ok((r.gainSeconds ?? 0) > 0.75);
  assert.ok(r.searched.lifts > 0);
  assert.equal(r.early.recoveryCount, 0);
  assert.equal(r.early.finished, true);
  assert.ok(r.early.seconds! > r.searched.seconds!);
  assert.ok(r.searched.offRoadTicks < r.fullHold.offRoadTicks);
});
void test('gate retains failures, respects bounded attempts and never substitutes an unvalidated reserve', async () => {
  assert.throws(() => generateBrakingCircuit('word-v2:evaluation-0', 1));
  const accepted = generateBrakingCircuit('word-v2:evaluation-0');
  assert.equal(accepted.quality.valid, true);
  assert.equal(accepted.diagnostics.fallbackUsed, false);
  assert.ok(accepted.diagnostics.rejections.length);
  assert.ok(accepted.diagnostics.attempts <= MAX_BRAKING_CANDIDATES);
  assert.ok(
    accepted.diagnostics.qualityAttempts <= MAX_BRAKING_QUALITY_ATTEMPTS
  );
  assert.equal(
    await hashTrack(accepted.track),
    await hashTrack(generateBrakingCircuit('word-v2:evaluation-0').track)
  );
  assert.throws(() =>
    generateBrakingCircuit('banana', MAX_BRAKING_CANDIDATES + 1)
  );
  const sweep = assessBrakingTrack(
    generateFixedBrakeMotifCourse('sweeper').track
  );
  assert.equal(sweep.valid, false);
  assert.ok(sweep.codes.includes('corner-diversity'));
  assert.equal(
    sweep.metrics,
    null,
    'reject the easy-only loop before costly controller search'
  );
});
