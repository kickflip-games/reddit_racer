/** Reconstruct all public dates and a representative mix of the extra sweep. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateCurrentDailyCircuit } from '../src/shared/braking-course-generator';
import { hashTrack } from '../src/shared/track';
const directory = process.argv[2];
if (!directory) throw new Error('Pass forecast output directory');
const forecast: {
  rows: { seed: string; trackHash: string; rankedTicks: number }[];
} = JSON.parse(readFileSync(join(directory, 'forecast.json'), 'utf8'));
const longRun: {
  rows: {
    seed: string;
    hash: string;
    family: string;
    fast: { finishTicks: number };
  }[];
} = JSON.parse(readFileSync(join(directory, 'long-run.json'), 'utf8'));
const cases = [
  ...forecast.rows.map((r) => ({
    seed: r.seed,
    hash: r.trackHash,
    ticks: r.rankedTicks,
  })),
  ...longRun.rows
    .filter((r, i) => r.family === 'crossover' || i % 10 === 0)
    .map((r) => ({ seed: r.seed, hash: r.hash, ticks: r.fast.finishTicks })),
];
const rows = [];
for (const c of cases) {
  const result = generateCurrentDailyCircuit(c.seed),
    hash = await hashTrack(result.track);
  assert(result.quality.valid);
  assert.equal(hash, c.hash);
  assert.equal(result.quality.metrics?.fast.finishTicks, c.ticks);
  assert.equal(result.track.seed, c.seed);
  rows.push({
    seed: c.seed,
    hash,
    ticks: c.ticks,
    acceptedAttempt: result.diagnostics.attempts,
  });
  if (rows.length % 10 === 0)
    console.log(`Reconstructed ${rows.length}/${cases.length}`);
}
const report = { cases: rows.length, exactGeometryAndRankedTicks: true, rows };
writeFileSync(
  join(directory, 'determinism.json'),
  JSON.stringify(report, null, 2) + '\n'
);
console.log(
  JSON.stringify({ cases: rows.length, exactGeometryAndRankedTicks: true })
);
