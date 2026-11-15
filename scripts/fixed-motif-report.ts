import { writeFileSync, mkdirSync } from 'node:fs';
import {
  generateFixedBrakeMotifCourse,
  type BrakeMotifKind,
} from '../src/shared/brake-rhythm-generator.ts';
import { evaluateBraking } from './lib/braking-validation.ts';
const kinds: BrakeMotifKind[] = [
  'hairpin',
  'tightening-corner',
  'flowing-s',
  'chicane',
  'double-hairpin',
  'sweeper',
  'switchback',
];
const rows = [];
for (const kind of kinds) {
  const candidate = generateFixedBrakeMotifCourse(kind);
  const r = evaluateBraking(candidate.track);
  const row = {
    kind,
    length: candidate.track.totalLength,
    structure: candidate.structure,
    ...r,
  };
  rows.push(row);
  console.log(
    JSON.stringify({
      kind,
      length: row.length,
      hold: r.fullHold.seconds,
      fast: r.searched.seconds,
      gain: r.gainSeconds,
      grass: r.searched.offRoadTicks / (r.searched.ticks ?? 1),
      holdGrass: r.fullHold.offRoadTicks,
      lifts: r.searched.lifts,
      early: r.early.seconds,
      earlyRecovery: r.early.recoveryCount,
      late: r.late.seconds,
    })
  );
}
mkdirSync('/tmp/racer-braking-validation', { recursive: true });
writeFileSync(
  '/tmp/racer-braking-validation/fixed.json',
  JSON.stringify(rows, null, 2)
);
