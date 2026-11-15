import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAKE_RHYTHM_VERSION,
  createBrakeMotif,
  generateBrakeRhythmCandidate,
  generateFixedBrakeMotifCourse,
  type BrakeMotifKind,
} from '../../src/shared/brake-rhythm-generator';
import { serializeTrack, hashTrack } from '../../src/shared/track';

const kinds: BrakeMotifKind[] = [
  'fast-straight',
  'hairpin',
  'double-hairpin',
  'flowing-s',
  'chicane',
  'switchback',
  'tightening-corner',
  'sweeper',
  'recovery',
];
test('authored motifs have explicit endpoint tangents, finite curvature and no instantaneous heading jumps', () => {
  for (const kind of kinds) {
    const p = createBrakeMotif(kind);
    const angle =
      kind === 'tightening-corner' || kind === 'sweeper' ? Math.PI / 2 : 0;
    assert.ok(Math.abs(p.heading - angle) < 1e-9, kind);
    if (angle === 0) assert.ok(Math.abs(p.z) < 1e-8, kind);
    assert.ok(p.length > 0);
    let last: number | undefined;
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1]!,
        b = p.points[i]!;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      assert.ok(d > 0 && d < 0.21, kind);
      const heading = Math.atan2(b.z - a.z, b.x - a.x);
      if (last !== undefined) {
        const turn = Math.atan2(
          Math.sin(heading - last),
          Math.cos(heading - last)
        );
        assert.ok(Math.abs(turn) < 0.025, kind);
      }
      last = heading;
    }
  }
});
test('100 consecutive rhythm seeds preserve structural safety and composed pacing', () => {
  const found = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const r = generateBrakeRhythmCandidate('word-v2:evaluation-' + i);
    assert.equal(r.track.generatorVersion, BRAKE_RHYTHM_VERSION);
    assert.equal(r.track.schemaVersion, 2);
    assert.ok(
      r.structure.valid,
      JSON.stringify({ i, codes: r.structure.codes })
    );
    assert.ok(r.structure.metrics.minRadius >= 10);
    assert.ok(r.track.totalLength < 2200);
    assert.equal(r.motifs[0]?.kind, 'fast-straight');
    assert.ok(['hairpin', 'double-hairpin'].includes(r.motifs[1]!.kind));
    assert.equal(r.motifs[2]?.kind, 'recovery');
    if (!r.motifs.some((m) => m.kind === 'double-hairpin'))
      assert.ok(r.motifs.some((m) => m.kind === 'flowing-s'));
    for (const m of r.motifs) {
      assert.ok(m.end > m.start);
      found.add(m.kind);
    }
    assert.ok(
      r.track.samples.every(
        (s) => s.y === 0 && s.grade === 0 && s.verticalCurvature === 0
      )
    );
  }
  for (const kind of kinds) assert.ok(found.has(kind), kind);
});
test('rhythm generation deterministic, finite and bounded options', () => {
  assert.equal(
    serializeTrack(generateBrakeRhythmCandidate('word-v2:banana').track),
    serializeTrack(generateBrakeRhythmCandidate('word-v2:banana').track)
  );
  assert.throws(() => generateBrakeRhythmCandidate(''));
  assert.throws(() => generateBrakeRhythmCandidate('x', 33));
  assert.throws(() => createBrakeMotif('hairpin', { hairpinRadius: 2 }));
  assert.throws(() => createBrakeMotif('chicane', { technicalRadius: NaN }));
});

test('seven isolated motif courses close safely without an unlabelled technical detour', () => {
  for (const kind of kinds.filter(
    (k) => k !== 'fast-straight' && k !== 'recovery'
  )) {
    const result = generateFixedBrakeMotifCourse(kind);
    assert.ok(
      result.structure.valid,
      kind + ':' + result.structure.codes.join(',')
    );
    assert.ok(result.motifs.some((m) => m.kind === kind));
    assert.ok(
      result.motifs.every((m) =>
        [kind, 'fast-straight', 'recovery', 'sweeper'].includes(m.kind)
      ),
      kind
    );
    const configured = createBrakeMotif(kind, { straightLength: 100 });
    assert.ok(configured.points.length > 10);
  }
});

test('v2 geometry candidates stay frozen under their explicit version', async () => {
  const hashes = {
    banana: 'b5880d7a769740b8c2af4d0744a67c36e91bd6c27b942dacf81b9e000baf21d8',
    tui: 'cc1bcece2a66f20c5d3f65458c90b0e14fa23195e442ecc77e45a84aae368e9a',
    river: '45f87b0f15e6ff5a9e0fdb596551db486e2f47cb92a3df3218fafe13001a3798',
  };
  for (const [word, hash] of Object.entries(hashes))
    assert.equal(
      await hashTrack(generateBrakeRhythmCandidate('word-v2:' + word).track),
      hash
    );
});
