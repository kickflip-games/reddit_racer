import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseWord, normalizeCourseWord } from '../../src/shared/word-seed.ts';
void test('course words normalize reproducibly and old codes alias the current generator', () => {
  assert.deepEqual(courseWord('  ＢＡＮＡＮＡ '), courseWord('banana'));
  assert.equal(courseWord('v1: Banana').code, 'banana');
  assert.equal(normalizeCourseWord('Café   au lait'), 'café au lait');
  assert.equal(courseWord('banana').seed, 'word-v2:banana');
  assert.deepEqual(courseWord('v1:banana'), courseWord('v2:banana'));
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
  assert.equal(normalizeCourseWord('a'.repeat(48)).length, 48);
});
void test('word courses reproduce geometry and isolate actual track ghost identities', async () => {
  const { generateWordPracticeCourse } =
    await import('../../src/client/practice-course.ts');
  const { practiceBestKey } = await import('../../src/client/practice-best.ts');
  const a = await generateWordPracticeCourse('BANANA'),
    b = await generateWordPracticeCourse('v1:banana'),
    c = await generateWordPracticeCourse('apple');
  assert.equal(a.trackHash, b.trackHash);
  assert.notEqual(a.trackHash, c.trackHash);
  assert.equal(a.track.generatorVersion, 'linked-circuits-v6');
  assert.equal(
    practiceBestKey(a.track, { continuousPractice: true }),
    practiceBestKey(b.track, { continuousPractice: true })
  );
  assert.notEqual(
    practiceBestKey(a.track, { continuousPractice: true }),
    practiceBestKey(c.track, { continuousPractice: true })
  );
});
void test('random Other tracks also expose a reproducible plain word', async () => {
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

void test('old short codes remap to the current course, not historical geometry', async () => {
  const { generateWordPracticeCourse } =
    await import('../../src/client/practice-course.ts');
  const { practiceBestKey } = await import('../../src/client/practice-best.ts');
  const a = await generateWordPracticeCourse('v2:banana');
  const b = await generateWordPracticeCourse('BANANA');
  const old = await generateWordPracticeCourse('v1:banana');
  assert.equal(a.trackHash, b.trackHash);
  assert.equal(a.trackHash, old.trackHash);
  const { generateOtherTracksCircuit } =
    await import('../../src/shared/other-tracks-generator.ts');
  const historical = generateOtherTracksCircuit('word-v1:banana').track;
  assert.notEqual(
    practiceBestKey(a.track, { continuousPractice: true }),
    practiceBestKey(historical, { continuousPractice: true })
  );
  assert.equal(
    practiceBestKey(a.track, { continuousPractice: true }),
    practiceBestKey(old.track, { continuousPractice: true })
  );
});
void test('accepted v8 linked course hashes freeze quality selection as well as candidate geometry', async () => {
  const { generateWordPracticeCourse } =
    await import('../../src/client/practice-course.ts');
  for (const [word, hash] of [
    [
      'banana',
      '6529d38eacfd7421dc7d6cdd8f47af9df6ca090a05d85551ec71abd322133ee6',
    ],
    ['tui', '5423991a1a0e76c3127d911d3a53bc4c42e09147abc7544197f05d945eb2cbaf'],
    [
      'river',
      '587ae0739901013d65910874afdedb1cfe61a4511dbc7eb424e805e059709716',
    ],
  ])
    assert.equal(
      (await generateWordPracticeCourse(`v2:${word}`, 'linked-circuits-v3'))
        .trackHash,
      hash
    );
});
