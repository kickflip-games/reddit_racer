import { writeFileSync, mkdirSync } from 'node:fs';
import { generateBrakingCircuit } from '../src/shared/braking-course-generator.ts';
import { generateOtherTracksCircuit } from '../src/shared/other-tracks-generator.ts';
import { evaluateBraking } from './lib/braking-validation.ts';
const seeds = process.argv.slice(2);
if (!seeds.length) seeds.push('banana', 'apple', 'orange');
const rows = [];
for (const seed of seeds) {
  for (const version of ['v1', 'v2']) {
    const candidate =
      version === 'v2' ? generateBrakingCircuit(`word-v2:${seed}`) : null;
    const track =
      candidate?.track ?? generateOtherTracksCircuit(`word-v1:${seed}`).track;
    const result = evaluateBraking(track);
    const row = {
      seed,
      version,
      length: track.totalLength,
      motifs: candidate?.motifs,
      accepted: candidate?.quality.valid ?? true,
      attempts: candidate?.diagnostics.attempts ?? null,
      ...result,
    };
    rows.push(row);
    console.log(
      JSON.stringify({
        seed,
        version,
        length: track.totalLength,
        hold: result.fullHold.seconds,
        searched: result.searched.seconds,
        timed: result.timed.seconds,
        early: result.early.seconds,
        late: result.late.seconds,
        gain: result.gainSeconds,
        recoveries: result.fullHold.recoveryCount,
        parity: result.searchParity,
        ms: result.wallMs,
      })
    );
  }
}
mkdirSync('/tmp/racer-braking-validation', { recursive: true });
writeFileSync(
  '/tmp/racer-braking-validation/report.json',
  JSON.stringify({ date: new Date().toISOString(), seeds, rows }, null, 2)
);
