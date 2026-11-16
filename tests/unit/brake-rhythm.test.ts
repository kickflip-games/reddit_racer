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
        (s) => Number.isFinite(s.y) && (s.y ?? 0) >= 0 && (s.y ?? 0) <= 7.4
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

test('v3 elevated geometry candidates stay frozen under their explicit version', async () => {
  const hashes = {
    banana: '4cd98c1d3aa35802e0f7c0d41a4b29d1e5f0d97e13988f1ddb291cada4481022',
    tui: '24d0ad8f91151a67356b6979c933ea43620a3efca00fa15db481a398cd1a8393',
    river: '29fc948d6d95b32eea8b57b311641dcaa2af3d919b53fff8909a11aef6ad7579',
  };
  for (const [word, hash] of Object.entries(hashes))
    assert.equal(
      await hashTrack(generateBrakeRhythmCandidate('word-v2:' + word).track),
      hash
    );
});
