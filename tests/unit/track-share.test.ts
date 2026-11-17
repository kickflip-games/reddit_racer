import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTrackShare,
  parseTrackShare,
  verifySharedTrack,
} from '../../src/shared/track-share.ts';
import { generateWordPracticeCourse } from '../../src/client/practice-course.ts';
import { LINKED_COURSE_VERSION } from '../../src/shared/course-rhythm.ts';
const valid = {
  type: 'racer-track',
  version: 1,
  generator: LINKED_COURSE_VERSION,
  seed: 'banana',
  trackHash: 'a'.repeat(64),
};
test('shared payload is bounded, versioned, normalized and strictly shaped', () => {
  assert.deepEqual(parseTrackShare(JSON.stringify(valid)), valid);
  for (const value of [
    null,
    [],
    {},
    { ...valid, version: 2 },
    { ...valid, generator: 'old' },
    { ...valid, seed: 'BANANA' },
    { ...valid, seed: 'v2:banana' },
    { ...valid, seed: '<script>' },
    { ...valid, seed: 'a\u202eb' },
    { ...valid, trackHash: 'practice-abc' },
    { ...valid, ranked: true },
  ])
    assert.throws(() => parseTrackShare(JSON.stringify(value)));
  assert.throws(() => parseTrackShare('x'.repeat(1025)));
  assert.throws(() => parseTrackShare('{'));
});
test('canonical share hash roundtrips exact seed and rejects different geometry', async () => {
  const a = await generateWordPracticeCourse('banana');
  const share = await createTrackShare('banana', a.track);
  assert.equal(share.trackHash, a.trackHash);
  assert.ok(JSON.stringify(share).length <= 1024);
  const roundtrip = await generateWordPracticeCourse(
    parseTrackShare(JSON.stringify(share)).seed
  );
  await verifySharedTrack(share, roundtrip.track);
  const b = await generateWordPracticeCourse('apple');
  await assert.rejects(verifySharedTrack(share, b.track), /no longer matches/);
  await assert.rejects(
    verifySharedTrack({ ...share, trackHash: '0'.repeat(64) }, a.track)
  );
  await assert.rejects(createTrackShare(' BANANA ', a.track));
});
