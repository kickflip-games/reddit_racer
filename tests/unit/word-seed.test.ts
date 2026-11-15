import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseWord, normalizeCourseWord } from '../../src/shared/word-seed.ts';
void test('v1 word normalization is explicit, Unicode-stable and reproducible', () => {
  assert.deepEqual(courseWord('  ＢＡＮＡＮＡ '), courseWord('banana'));
  assert.equal(courseWord('v1: Banana').code, 'v1:banana');
  assert.equal(normalizeCourseWord('Café   au lait'), 'café au lait');
  assert.equal(courseWord('banana').seed, 'word-v2:banana');
  assert.equal(courseWord('banana', 1).seed, 'word-v1:banana');
  assert.equal(courseWord('v1:banana').version, 1);
  assert.notEqual(courseWord('banana').seed, courseWord('apple').seed);
});
void test('rejects unsupported versions, controls, bidi, excessive and empty inputs', () => {
  for (const input of [
    '',
    '   ',
    'a'.repeat(49),
    'hello\u202eworld',
    'v1:banana\n',
    'v99:banana',
    '<script>',
    '🍌',
  ])
    assert.throws(() => courseWord(input));
  assert.throws(() => courseWord('𐐀'.repeat(48)));
  assert.ok(courseWord('𐐀'.repeat(44)).seed.length <= 96);
  assert.throws(() => courseWord('banana', 99));
  assert.throws(() => courseWord('v1:banana', 99));
  assert.equal(normalizeCourseWord('a'.repeat(48)).length, 48);
});
void test('word courses reproduce their own geometry and ghost key without changing legacy seeds', async () => {
  const { generateWordPracticeCourse, generatePracticeCourse } =
    await import('../../src/client/practice-course.ts');
  const { practiceBestKey } = await import('../../src/client/practice-best.ts');
  const { generateElevatedCircuit } =
    await import('../../src/shared/elevated-generator.ts');
  const { hashTrack } = await import('../../src/shared/track.ts');
  const a = await generateWordPracticeCourse('BANANA', 1),
    b = await generateWordPracticeCourse('v1:banana'),
    c = await generateWordPracticeCourse('apple', 1);
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
void test('random Other tracks also expose a reproducible versioned word code', async () => {
  const { generateRandomWordPracticeCourse, generateWordPracticeCourse } =
    await import('../../src/client/practice-course.ts');
  const a = await generateRandomWordPracticeCourse();
  const b = await generateRandomWordPracticeCourse(a.trackHash);
  assert.notEqual(a.trackHash, b.trackHash);
  assert.equal(
    (await generateWordPracticeCourse(a.wordCourse.code)).trackHash,
    a.trackHash
  );
});

void test('v2 braking courses are deterministic and isolated from saved v1 ghosts', async () => {
  const { generateWordPracticeCourse } =
    await import('../../src/client/practice-course.ts');
  const { practiceBestKey } = await import('../../src/client/practice-best.ts');
  const a = await generateWordPracticeCourse('v2:banana');
  const b = await generateWordPracticeCourse('BANANA');
  const old = await generateWordPracticeCourse('v1:banana');
  assert.equal(a.trackHash, b.trackHash);
  assert.notEqual(a.trackHash, old.trackHash);
  assert.notEqual(
    practiceBestKey(a.track, { continuousPractice: true }),
    practiceBestKey(old.track, { continuousPractice: true })
  );
});
void test('accepted v2 course hashes freeze quality selection as well as candidate geometry', async () => {
  const { generateWordPracticeCourse } =
    await import('../../src/client/practice-course.ts');
  for (const [word, hash] of [
    [
      'banana',
      '7a2f14c36cee974326c18801e0b8aa5cc2a4078555ad91a08f5f3291484d4d23',
    ],
    ['tui', 'cc1bcece2a66f20c5d3f65458c90b0e14fa23195e442ecc77e45a84aae368e9a'],
    [
      'river',
      'c4155b844fd00ec05d0192ce88f8772453ea201c01135cf83ab499df038f2483',
    ],
  ])
    assert.equal(
      (await generateWordPracticeCourse(`v2:${word}`)).trackHash,
      hash
    );
});
