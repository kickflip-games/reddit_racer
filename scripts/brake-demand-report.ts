import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { generateBrakingCircuit } from '../src/shared/braking-course-generator';
import { courseFamilyForSeed } from '../src/shared/course-families';
import {
  crossingHeadroom,
  findTrackCrossings,
} from '../src/shared/track-crossings';
import { hashTrack } from '../src/shared/track';
import { referenceDemand, runDemand, releaseZones } from './lib/brake-demand';

const phase = process.argv[2] ?? 'baseline',
  output = process.argv[3] ?? 'docs/evidence/braking-rhythm';
const count = Number(process.argv[4] ?? 30);
if (
  !['baseline', 'tuned'].includes(phase) ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 100
)
  throw new Error('Use baseline|tuned and a count from 1 to 100');
mkdirSync(output, { recursive: true });
type Row = Awaited<ReturnType<typeof measure>>;
const rows: Row[] = [];
async function measure(day: string, seed: string) {
  const started = performance.now(),
    generated = generateBrakingCircuit(
      seed,
      undefined,
      phase === 'baseline' ? 'linked-circuits-v6' : 'linked-circuits-v7'
    );
  if (!generated.quality.fastReplay || !generated.quality.valid)
    throw new Error(`Unapproved ${seed}`);
  const transitions = generated.quality.fastReplay.transitions;
  const searched = runDemand(generated.track, (state) => {
    let held = true;
    for (const t of transitions) {
      if (t.tick > state.tick) break;
      held = t.held;
    }
    return held;
  });
  const demand = referenceDemand(generated.track, releaseZones(searched));
  const row = {
    day,
    seed,
    family: courseFamilyForSeed(seed),
    hash: await hashTrack(generated.track),
    length: generated.track.totalLength,
    peakElevation: Math.max(...generated.track.samples.map((p) => p.y ?? 0)),
    jumps: generated.track.jumps,
    crossings: findTrackCrossings(generated.track),
    headroom: crossingHeadroom(generated.track),
    quality: {
      valid: generated.quality.valid,
      attempt: generated.diagnostics.attempts,
      metrics: generated.quality.metrics,
    },
    demand: {
      ...demand,
      run: {
        ...demand.run,
        trace: demand.run.trace
          .filter((p) => p.tick % 12 === 0)
          .map((p) => ({ tick: p.tick, s: p.s, speed: p.speed, held: p.held })),
      },
    },
    wallMs: performance.now() - started,
    samples: generated.track.samples
      .filter((_, index) => index % 2 === 0)
      .map((p) => ({ x: p.x, z: p.z, s: p.s, y: p.y })),
  };
  return row;
}
for (let i = 0; i < count; i++) {
  const day = new Date(Date.UTC(2026, 10, 24 + i)).toISOString().slice(0, 10),
    seed = `daily:t5_kyc33w:${day}`;
  const row = await measure(day, seed),
    demand = row.demand;
  rows.push(row);
  writeFileSync(
    join(output, `${phase}.json`),
    JSON.stringify({
      phase,
      baselineSha: 'c155dce88db80e011b2c102c4f55fd086661f6b8',
      generatorVersion:
        phase === 'baseline' ? 'linked-circuits-v6' : 'linked-circuits-v7',
      workingTreeDirty:
        execFileSync('git', ['status', '--porcelain'], {
          encoding: 'utf8',
        }).trim().length > 0,
      measurementCodeSha256: createHash('sha256')
        .update(readFileSync('scripts/lib/brake-demand.ts'))
        .update(readFileSync('scripts/brake-demand-report.ts'))
        .digest('hex'),
      checkoutHeadSha: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      node: process.version,
      rows,
    })
  );
  console.log(
    JSON.stringify({
      day,
      family: row.family,
      seconds: demand.run.seconds,
      longest: demand.longest,
      excess: demand.excess,
      events: demand.events.length,
      validated: demand.validated.length,
      offRoad: demand.run.offRoadTicks,
      recovery: demand.run.recoveryTicks,
      brakeFraction: demand.brakeFraction,
      wallMs: row.wallMs,
    })
  );
}
const summary = (
  key: 'longest' | 'excess' | 'repeatedExcess' | 'brakeFraction'
) => {
  const values = rows.map((r) => r.demand[key]).sort((a, b) => a - b);
  return {
    median:
      (values[Math.floor((values.length - 1) / 2)]! +
        values[Math.floor(values.length / 2)]!) /
      2,
    p90: values[Math.ceil(values.length * 0.9) - 1],
    max: values.at(-1),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
};
console.log(
  JSON.stringify({
    phase,
    count,
    longest: summary('longest'),
    excess: summary('excess'),
    repeatedExcess: summary('repeatedExcess'),
    brakeFraction: summary('brakeFraction'),
  })
);
