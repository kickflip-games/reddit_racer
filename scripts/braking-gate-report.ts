import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { generateBrakingCircuit } from '../src/shared/braking-course-generator.ts';
const count = Number(process.argv[2] ?? 30);
if (!Number.isInteger(count) || count < 1 || count > 100)
  throw new Error('Count must be1–100');
const rows = [];
for (let i = 0; i < count; i++) {
  const seed = `word-v2:evaluation-${i}`,
    start = performance.now();
  try {
    const r = generateBrakingCircuit(seed),
      m = r.quality.metrics;
    const row = {
      seed,
      valid: r.quality.valid,
      codes: r.quality.codes,
      length: r.track.totalLength,
      seconds: m?.fast.seconds,
      gainTicks: m?.gainTicks,
      grassFraction: m?.fast.finishTicks
        ? m.fast.offRoadTicks / m.fast.finishTicks
        : null,
      lifts: m?.fast.meaningfulLifts,
      diagnostics: r.diagnostics,
      wallMs: performance.now() - start,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  } catch (error) {
    const row = {
      seed,
      valid: false,
      error: String(error),
      wallMs: performance.now() - start,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
const times = rows.map((r) => r.wallMs).sort((a, b) => a - b);
const summary = {
  count,
  accepted: rows.filter((r) => r.valid).length,
  p95Ms: times[Math.ceil(times.length * 0.95) - 1],
  worstMs: times.at(-1),
};
mkdirSync('/tmp/racer-braking-validation', { recursive: true });
writeFileSync(
  '/tmp/racer-braking-validation/gates.json',
  JSON.stringify(
    {
      summary,
      environment: {
        node: process.version,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        memoryBytes: totalmem(),
        workers: 1,
      },
      geometrySha256: createHash('sha256')
        .update(
          readFileSync(
            new URL('../src/shared/brake-rhythm-generator.ts', import.meta.url)
          )
        )
        .digest('hex'),
      rows,
    },
    null,
    2
  )
);
console.log(JSON.stringify(summary));
