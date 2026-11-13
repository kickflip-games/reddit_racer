import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPracticeCourseGenerator,
  generatePracticeCourse,
  practiceTrackFingerprint,
} from '../../src/client/practice-course.ts';
import { assessTrackQuality } from '../../src/shared/circuit-quality.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { hashTrack } from '../../src/shared/track.ts';

void test('an explicit practice seed reproduces an approved course and may intentionally repeat the previous hash', async () => {
  const first = await generatePracticeCourse('practice-fixture-a');
  const second = await generatePracticeCourse(first.seed, first.trackHash);
  assert.deepEqual(second, first);
  assert.equal(first.trackHash, await hashTrack(first.track));
  const quality = assessTrackQuality(first.track);
  assert.equal(quality.valid, true);
  assert.deepEqual(quality.codes, []);
  assert.ok(quality.metrics?.fast.finished);
  assert.ok(
    quality.metrics.fast.seconds !== null &&
      quality.metrics.fast.seconds >= 20 &&
      quality.metrics.fast.seconds <= 40
  );
  assert.deepEqual(Object.keys(first).sort(), [
    'fallbackUsed',
    'seed',
    'track',
    'trackHash',
  ]);
  assert.doesNotMatch(
    JSON.stringify(first),
    /fastReplay|transitions|validationWork|qualityAttempts/
  );
});

void test('known practice seeds produce different approved canonical layouts', async () => {
  const hashes = [];
  for (const seed of ['practice-fixture-b', 'practice-fixture-c']) {
    const course = await generatePracticeCourse(seed);
    assert.equal(course.seed, seed);
    assert.equal(course.trackHash, await hashTrack(course.track));
    hashes.push(course.trackHash);
  }
  assert.equal(new Set(hashes).size, 2);
});

void test('empty and oversized explicit seeds reject before reading entropy', async () => {
  let entropyReads = 0;
  const generate = createPracticeCourseGenerator({
    randomValues: () => {
      entropyReads++;
    },
  });
  for (const seed of ['', 'x'.repeat(97)])
    await assert.rejects(generate(seed), /1–96 characters/);
  assert.equal(entropyReads, 0);
});

void test('controlled random selection skips the previous course and stops after finding a new one', async () => {
  let entropyReads = 0;
  const generate = createPracticeCourseGenerator({
    randomValues: (values) => values.fill(entropyReads++),
    hash: hashTrack,
  });
  const previous = await generate(`practice-${'00'.repeat(16)}`);
  const next = await generate(undefined, previous.trackHash);
  assert.equal(entropyReads, 2);
  assert.equal(next.seed, `practice-${'01'.repeat(16)}`);
  assert.notEqual(next.trackHash, previous.trackHash);
});

void test('three duplicate random candidates fail clearly without unbounded generation', async () => {
  let entropyReads = 0;
  const generate = createPracticeCourseGenerator({
    randomValues: (values) => {
      entropyReads++;
      values.fill(0);
    },
    hash: hashTrack,
  });
  const previous = await generate(`practice-${'00'.repeat(16)}`);
  await assert.rejects(
    generate(undefined, previous.trackHash),
    /after 3 attempts/
  );
  assert.equal(entropyReads, 3);
});

void test('HTTP capabilities retain deterministic labelled practice identity and fresh fallback seeds', async () => {
  const generate = createPracticeCourseGenerator({
    now: () => 123456789,
    random: () => 0.25,
  });
  const first = await generate();
  const second = await generate(undefined, first.trackHash);
  assert.match(first.seed, /^practice-/);
  assert.notEqual(first.seed, second.seed);
  assert.notEqual(first.trackHash, second.trackHash);
  assert.match(first.trackHash, /^practice-[0-9a-f]{16}$/);
  assert.equal(first.trackHash, practiceTrackFingerprint(first.track));
  assert.equal(
    (await generate(first.seed, first.trackHash)).trackHash,
    first.trackHash
  );
  assert.equal(
    practiceTrackFingerprint(first.track),
    practiceTrackFingerprint(structuredClone(first.track))
  );
  assert.notEqual(
    practiceTrackFingerprint(first.track),
    practiceTrackFingerprint(createOvalTrack())
  );
});

void test('failing optional crypto capabilities still permit unranked practice', async () => {
  const generate = createPracticeCourseGenerator({
    randomValues: () => {
      throw new Error('Capability unavailable');
    },
    hash: () => Promise.reject(new Error('Subtle crypto unavailable')),
    now: () => 123456789,
    random: () => 0.75,
  });
  const course = await generate();
  assert.match(course.seed, /^practice-/);
  assert.equal(course.trackHash, practiceTrackFingerprint(course.track));
});
