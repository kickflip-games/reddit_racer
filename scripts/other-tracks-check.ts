import { generateOtherTracksCircuit } from '../src/shared/other-tracks-generator';
import { generateElevatedCircuit } from '../src/shared/elevated-generator';
import { hashTrack } from '../src/shared/track';
const count = Number(process.argv[2] ?? 100);
if (!Number.isInteger(count) || count < 1 || count > 200)
  throw new Error('Count must be 1–200');
const rows = [];
for (let i = 0; i < count; i++) {
  const seed = `word-v1:other-evaluation-${i}`;
  for (const [method, generate] of [
    ['legacy', generateElevatedCircuit],
    ['other', generateOtherTracksCircuit],
  ] as const) {
    const start = performance.now();
    const r = generate(seed);
    const m = r.diagnostics.accepted;
    rows.push({
      seed,
      method,
      ms: performance.now() - start,
      valid: r.quality.valid,
      motifs: m.motifs,
      directionChanges: m.directionChanges,
      minRadius: m.minRadius,
      clearance: m.minClearance,
      length: r.track.totalLength,
      fallback: r.diagnostics.fallbackUsed,
      attempts: r.diagnostics.attempts,
      controllerRuns: r.quality.work.controllerRuns,
      metrics: r.quality.metrics,
      hash: await hashTrack(r.track),
    });
  }
}
console.log(JSON.stringify(rows, null, 2));
