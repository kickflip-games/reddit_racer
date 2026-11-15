import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseWord, normalizeCourseWord } from '../../src/shared/word-seed.ts';
void test('v1 word normalization is explicit, Unicode-stable and reproducible', () => {
  assert.deepEqual(courseWord('  ＢＡＮＡＮＡ '), courseWord('banana'));
  assert.equal(courseWord('v1: Banana').code, 'v1:banana');
  assert.equal(normalizeCourseWord('Café   au lait'), 'café au lait');
  assert.equal(courseWord('banana').seed, 'word-v1:banana');
  assert.notEqual(courseWord('banana').seed, courseWord('apple').seed);
});
void test('rejects unsupported versions, controls, bidi, excessive and empty inputs', () => {
  for (const input of [
    '',
    '   ',
    'a'.repeat(49),
    'hello\u202eworld',
    'v1:banana\n',
    'v2:banana',
    '<script>',
    '🍌',
  ])
    assert.throws(() => courseWord(input));
  assert.throws(() => courseWord('𐐀'.repeat(48)));
  assert.ok(courseWord('𐐀'.repeat(44)).seed.length <= 96);
  assert.throws(() => courseWord('banana', 2));
  assert.throws(() => courseWord('v1:banana', 2));
  assert.equal(normalizeCourseWord('a'.repeat(48)).length, 48);
});
void test('word courses reproduce their own geometry and ghost key without changing legacy seeds', async () => {
  const { generateWordPracticeCourse, generatePracticeCourse } =
    await import('../../src/client/practice-course.ts');
  const { practiceBestKey } = await import('../../src/client/practice-best.ts');
  const { generateElevatedCircuit } =
    await import('../../src/shared/elevated-generator.ts');
  const { hashTrack } = await import('../../src/shared/track.ts');
  const a = await generateWordPracticeCourse('BANANA'),
    b = await generateWordPracticeCourse('v1:banana'),
    c = await generateWordPracticeCourse('apple');
  assert.equal(a.trackHash, b.trackHash);
  assert.notEqual(a.trackHash, c.trackHash);
  assert.equal(a.track.generatorVersion, 'other-tracks-v1');
  assert.equal(
    practiceBestKey(a.track, { continuousPractice: true }),
    practiceBestKey(b.track, { continuousPractice: true })
  );
  assert.notEqual(
    practiceBestKey(a.track, { continuousPractice: true }),
    practiceBestKey(c.track, { continuousPractice: true })
  );
  assert.equal(
    (await generatePracticeCourse('country-1')).trackHash,
    await hashTrack(generateElevatedCircuit('country-1').track)
  );
});
