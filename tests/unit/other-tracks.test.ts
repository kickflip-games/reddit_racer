import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOtherTracksCircuit,
  OTHER_TRACKS_GENERATOR_VERSION,
} from '../../src/shared/other-tracks-generator';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator';
import { hashTrack, serializeTrack } from '../../src/shared/track';

test('Other tracks use an explicit version, measured direction changes and unchanged safety gates across consecutive seeds', () => {
  for (let i = 0; i < 20; i++) {
    const result = generateOtherTracksCircuit(`other-test-${i}`);
    assert.equal(result.track.generatorVersion, OTHER_TRACKS_GENERATOR_VERSION);
    assert.equal(result.diagnostics.version, OTHER_TRACKS_GENERATOR_VERSION);
    assert.ok(result.quality.valid);
    assert.ok(
      result.diagnostics.accepted.directionChanges >=
        (result.diagnostics.accepted.motifs.includes('overpass') ||
        result.diagnostics.accepted.motifs.includes('hairpin')
          ? 2
          : 4)
    );
    assert.ok(result.diagnostics.accepted.minRadius >= 10);
    assert.ok(result.diagnostics.attempts <= 32);
    for (const name of ['hold', 'cautious', 'fast'] as const)
      assert.ok(result.quality.metrics?.[name].finished);
  }
});
test('word namespace is deterministic and does not change the old generator', async () => {
  const a = generateOtherTracksCircuit('word-v1:banana');
  const b = generateOtherTracksCircuit('word-v1:banana');
  assert.equal(serializeTrack(a.track), serializeTrack(b.track));
  const oldHashes = [
    'a69a25f9f203a90697289c390a2afa797fa1e9dbd73f265517645de987c00a01',
    '473439db4c796893a0e4fcba17fc282f935bbb51ffd23bed2c2a2f29dfc55693',
    'b2859118915b0bd6c1637279dec09ccd01ea90b4cadf66a07ee8a54fe847e7fb',
  ];
  for (let i = 0; i < oldHashes.length; i++)
    assert.equal(
      await hashTrack(generateElevatedCircuit(`legacy-unchanged-${i}`).track),
      oldHashes[i]
    );
});
test('Other tracks reject malformed seeds before candidate work', () => {
  assert.throws(() => generateOtherTracksCircuit(''));
  assert.throws(() => generateOtherTracksCircuit('a'.repeat(97)));
});

test('version-one word routes have frozen canonical geometry', async () => {
  const signatures = {
    banana: '685cab40acc828760ee4171efc93388362bd762cbc78b83afb0f2744e3dee7ad',
    tui: '0b5e82535a3e1aa52123682fc2b8c1f470ebe27fc9fbf99b9ade2e652ee49a26',
    river: '6d2536838b43fef630af53e31b7c18ab6e324bbce404e3b466cf44c1d28feb80',
  };
  for (const [word, signature] of Object.entries(signatures))
    assert.equal(
      await hashTrack(generateOtherTracksCircuit('word-v1:' + word).track),
      signature
    );
});

test('bounded Other tracks exhaustion validates and reports its reserve', () => {
  const result = generateElevatedCircuit(
    'reserve-test-0',
    { lengthMin: 730, lengthMax: 800, maxAttempts: 1 },
    'other-tracks-v1'
  );
  assert.ok(result.diagnostics.fallbackUsed);
  assert.equal(result.diagnostics.attempts, 1);
  assert.equal(result.diagnostics.validationWork.reserveAssessments, 1);
  assert.ok(result.quality.valid);
  for (const name of ['hold', 'cautious', 'fast'] as const)
    assert.ok(result.quality.metrics?.[name].finished);
});
