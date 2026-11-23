import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateBrakingCircuit } from '../src/shared/braking-course-generator';
import { courseFamilyForSeed } from '../src/shared/course-families';
import { hashTrack } from '../src/shared/track';
import {
  crossingHeadroom,
  findTrackCrossings,
} from '../src/shared/track-crossings';

const output = process.argv[2] ?? 'docs/evidence/braking-rhythm/coverage.json';
const seeds = [
  ...Array.from({ length: 50 }, (_, i) => `word-v2:braking-holdout-${i}`),
  ...Array.from(
    { length: 50 },
    (_, i) =>
      `daily:t5_kyc33w:${new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10)}`
  ),
];
const rows = [];
for (const seed of seeds) {
  const start = performance.now();
  try {
    const r = generateBrakingCircuit(seed);
    const row = {
      seed,
      family: courseFamilyForSeed(seed),
      valid: r.quality.valid,
      codes: r.quality.codes,
      attempts: r.diagnostics.attempts,
      qualityAttempts: r.diagnostics.qualityAttempts,
      hash: await hashTrack(r.track),
      length: r.track.totalLength,
      peakElevation: Math.max(...r.track.samples.map((p) => p.y ?? 0)),
      crossings: findTrackCrossings(r.track).length,
      headroom: crossingHeadroom(r.track),
      jumps: r.track.jumps?.length ?? 0,
      fast: r.quality.metrics?.fast,
      cautious: r.quality.metrics?.cautious,
      wallMs: performance.now() - start,
    };
    rows.push(row);
    console.log(JSON.stringify({ seed, valid: row.valid, codes: row.codes }));
  } catch (error) {
    rows.push({ seed, valid: false, error: String(error) });
    console.log(JSON.stringify(rows.at(-1)));
  }
}
mkdirSync(dirname(output), { recursive: true });
const failed = rows.filter((r) => !r.valid);
writeFileSync(
  output,
  JSON.stringify(
    { count: rows.length, passed: rows.length - failed.length, rows },
    null,
    2
  )
);
console.log(
  JSON.stringify({
    count: rows.length,
    passed: rows.length - failed.length,
    failed,
  })
);
if (failed.length) process.exitCode = 1;
