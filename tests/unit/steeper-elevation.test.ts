import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { generateBrakingCircuit } from '../../src/shared/braking-course-generator.ts';
import { generateLinkedCourseCandidate } from '../../src/shared/linked-course-generator.ts';
import { parseDailyChallengeRecord } from '../../src/shared/daily-challenge.ts';
import { runReplay, validateReplay } from '../../src/shared/replay.ts';
import {
  FLIGHT_GRAVITY,
  runtimeForTrack,
} from '../../src/shared/scored-runtime.ts';
import { hashTrack, serializeTrack } from '../../src/shared/track.ts';
import { generateWordPracticeCourse } from '../../src/client/practice-course.ts';
import { practiceBestKey } from '../../src/client/practice-best.ts';
import {
  createTrackShare,
  parseTrackShare,
  verifySharedTrack,
} from '../../src/shared/track-share.ts';

function retainedFixtures() {
  const value: unknown = JSON.parse(
    readFileSync(
      new URL('../fixtures/elevation/retained-v4.json', import.meta.url),
      'utf8'
    )
  );
  assert.ok(Array.isArray(value));
  return value.map((row: unknown) => {
    assert.ok(row && typeof row === 'object');
    assert.ok('seed' in row && typeof row.seed === 'string');
    assert.ok('hash' in row && typeof row.hash === 'string');
    assert.ok('fastTicks' in row && typeof row.fastTicks === 'number');
    assert.ok(
      'acceptedAttempt' in row && typeof row.acceptedAttempt === 'number'
    );
    assert.ok('fastReplay' in row);
    return {
      seed: row.seed,
      hash: row.hash,
      ticks: row.fastTicks,
      attempt: row.acceptedAttempt,
      replay: validateReplay(row.fastReplay),
    };
  });
}

void test('retained V4 recipes and already-recorded replays keep pre-release hashes and exact ticks', async () => {
  for (const fixture of retainedFixtures()) {
    const old = generateBrakingCircuit(
      fixture.seed,
      undefined,
      'linked-circuits-v4'
    );
    assert.equal(old.diagnostics.acceptedAttempt, fixture.attempt);
    assert.equal(old.diagnostics.qualityVersion, old.quality.version);
    assert.equal(await hashTrack(old.track), fixture.hash);
    assert.equal(
      runReplay(old.track, fixture.replay).finishTicks,
      fixture.ticks
    );
    assert.equal(runtimeForTrack(old.track).simulationVersion, 'fixed-step-v9');
  }
});

void test('steeper C2 hills keep the horizontal course and flat grid with a safe crest curvature', () => {
  for (const fixture of retainedFixtures()) {
    const before = generateLinkedCourseCandidate(
      fixture.seed,
      fixture.attempt,
      'linked-circuits-v4'
    ).track;
    const after = generateLinkedCourseCandidate(
      fixture.seed,
      fixture.attempt,
      'linked-circuits-v5'
    ).track;
    assert.ok(before && after);
    assert.deepEqual(
      after.samples.map((p) => [
        p.s,
        p.x,
        p.z,
        p.tx,
        p.tz,
        p.curvature,
        p.width,
      ]),
      before.samples.map((p) => [
        p.s,
        p.x,
        p.z,
        p.tx,
        p.tz,
        p.curvature,
        p.width,
      ])
    );
    const oldGrade = Math.max(
      ...before.samples.map((p) => Math.abs(p.grade ?? 0))
    );
    const newGrade = Math.max(
      ...after.samples.map((p) => Math.abs(p.grade ?? 0))
    );
    assert.ok(newGrade >= oldGrade * 1.2999);
    assert.ok(newGrade < 0.19);
    assert.ok(
      after.samples.every((p) => Math.abs(p.verticalCurvature ?? 0) <= 0.010561)
    );
    assert.ok(30 ** 2 * 0.010561 < FLIGHT_GRAVITY);
    assert.ok(
      after.samples
        .filter((p) => p.s < 20 || p.s > after.totalLength - 20)
        .every((p) => p.y === 0 && p.grade === 0 && p.verticalCurvature === 0)
    );
  }
});

void test('new course generation is deterministic and its admitted replay uses the unchanged V9 rules', async () => {
  const a = generateBrakingCircuit('word-v2:tui');
  generateBrakingCircuit('word-v2:banana');
  const b = generateBrakingCircuit('word-v2:tui');
  assert.equal(serializeTrack(a.track), serializeTrack(b.track));
  assert.equal(a.track.generatorVersion, 'linked-circuits-v6');
  assert.ok(a.quality.valid && a.quality.fastReplay && a.quality.metrics);
  assert.equal(a.quality.fastReplay.schemaVersion, 2);
  assert.equal(
    runReplay(a.track, a.quality.fastReplay).finishTicks,
    a.quality.metrics.fast.finishTicks
  );
  const old = generateBrakingCircuit(
    'word-v2:tui',
    undefined,
    'linked-circuits-v4'
  );
  assert.notEqual(await hashTrack(a.track), await hashTrack(old.track));
  assert.notEqual(practiceBestKey(a.track, {}), practiceBestKey(old.track, {}));
});

void test('stored V4 daily retains its complete course, challenge binding and leaderboard-time authority', async () => {
  const raw: unknown = JSON.parse(
    readFileSync(
      new URL('../fixtures/elevation/stored-v4-daily.json', import.meta.url),
      'utf8'
    )
  );
  const record = await parseDailyChallengeRecord(raw);
  const fixture = retainedFixtures()[0];
  assert.ok(fixture);
  assert.equal(record.generatorVersion, 'linked-circuits-v4');
  assert.equal(record.trackHash, fixture.hash);
  assert.equal(await hashTrack(record.track), fixture.hash);
  assert.equal(record.simulationVersion, 'fixed-step-v9');
  assert.equal(
    runReplay(record.track, fixture.replay).finishTicks,
    fixture.ticks
  );
  const again = await parseDailyChallengeRecord(raw);
  assert.equal(again.challengeHash, record.challengeHash);
  assert.equal(serializeTrack(again.track), serializeTrack(record.track));
});

void test('saved V4 shares reconstruct the frozen course while new named courses get separate identities', async () => {
  const old = await generateWordPracticeCourse('banana', 'linked-circuits-v4');
  const share = parseTrackShare(
    JSON.stringify(await createTrackShare('banana', old.track))
  );
  const restored = await generateWordPracticeCourse(
    share.seed,
    share.generator
  );
  await verifySharedTrack(share, restored.track);
  assert.equal(restored.trackHash, retainedFixtures()[0]?.hash);
  const current = await generateWordPracticeCourse('banana');
  assert.notEqual(current.trackHash, old.trackHash);
  await assert.rejects(verifySharedTrack(share, current.track));
});
