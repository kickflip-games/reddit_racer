import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateBrakingCircuit,
  CURRENT_COURSE_RESERVE_SEED,
} from '../src/shared/braking-course-generator';
import { generateBrakeRhythmCandidate } from '../src/shared/brake-rhythm-generator';
import {
  assessTrackQuality,
  type QualityAssessment,
} from '../src/shared/circuit-quality';
import { hashTrack, type Track } from '../src/shared/track';
import {
  longestThrottleTicks,
  LINKED_COURSE_VERSION,
  LINKED_RHYTHM_LIMITS,
} from '../src/shared/course-rhythm';
import { drivePractice, replayPolicy } from './lib/braking-validation';

const output = process.argv[2] ?? '/tmp/racer-linked-courses';
mkdirSync(output, { recursive: true });
const seeds = [
  ...Array.from({ length: 100 }, (_, i) => `word-v2:evaluation-${i}`),
  ...Array.from(
    { length: 100 },
    (_, i) =>
      `daily:t5_rhythm:${new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10)}`
  ),
  'word-v2:banana',
  'word-v2:tui',
  'word-v2:river',
  'banana',
  CURRENT_COURSE_RESERVE_SEED,
];
const round = (n: number) => Math.round(n * 1000) / 1000;
function measurements(track: Track, quality: QualityAssessment) {
  const m = quality.metrics;
  return {
    valid: quality.valid,
    codes: quality.codes,
    length: round(track.totalLength),
    longestStraight: round(quality.structure.metrics.longestStraight),
    directionChanges: quality.structure.metrics.directionChanges,
    curvatureProfile: quality.structure.metrics.curvatureProfile,
    peakElevation: round(Math.max(...track.samples.map((p) => p.y ?? 0))),
    longestThrottleSeconds: quality.fastReplay
      ? round(longestThrottleTicks(quality.fastReplay) / 120)
      : null,
    brakesPerMinute: m?.fast.seconds
      ? round((m.meaningfulLifts * 60) / m.fast.seconds)
      : null,
    gainSeconds: m ? round(m.gainTicks / 120) : null,
    fast: m?.fast ?? null,
    hold: m?.hold ?? null,
    cautious: m?.cautious ?? null,
  };
}
function previous(seed: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { track } = generateBrakeRhythmCandidate(seed, attempt);
    const quality = assessTrackQuality(track, {
      thresholds: {
        minFastSeconds: 20,
        maxFastSeconds: 60,
        minGainTicks: 90,
        minMeaningfulLifts: 2,
        maxMeaningfulLifts: 8,
        maxFastOffRoadFraction: 0.15,
      },
    });
    if (quality.valid || attempt === 3) return { track, quality };
  }
  throw new Error('Missing previous candidate');
}
function map(track: Track, x: number, y: number, color: string) {
  const xs = track.samples.map((p) => p.x),
    zs = track.samples.map((p) => p.z);
  const minX = Math.min(...xs),
    minZ = Math.min(...zs);
  const scale = Math.min(
    205 / (Math.max(...xs) - minX),
    205 / (Math.max(...zs) - minZ)
  );
  const point = (p: Track['samples'][number]) =>
    `${round(x + 5 + (p.x - minX) * scale)},${round(y + 5 + (p.z - minZ) * scale)}`;
  const first = track.samples[0]!;
  return (
    `<polyline points="${[...track.samples, first].map(point).join(' ')}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>` +
    track.samples
      .filter((p, i) => (p.y ?? 0) > 0.75 && i % 3 === 0)
      .map(
        (p) =>
          `<circle cx="${round(x + 5 + (p.x - minX) * scale)}" cy="${round(y + 5 + (p.z - minZ) * scale)}" r="2" fill="#efaa43"/>`
      )
      .join('') +
    `<circle cx="${round(x + 5 + (first.x - minX) * scale)}" cy="${round(y + 5 + (first.z - minZ) * scale)}" r="4" fill="#162739"/>`
  );
}
const rows = [];
const gallery: string[] = [];
for (let i = 0; i < seeds.length; i++) {
  const seed = seeds[i]!;
  const started = performance.now();
  try {
    const result = generateBrakingCircuit(seed);
    const current = measurements(result.track, result.quality);
    const old = i < 12 ? previous(seed) : undefined;
    const baseline = old ? measurements(old.track, old.quality) : undefined;
    const m = result.quality.metrics,
      replay = result.quality.fastReplay;
    const practice =
      i < 12 && replay && m
        ? drivePractice(result.track, replayPolicy({ replay, summary: m.fast }))
        : undefined;
    const row = {
      seed,
      hash: await hashTrack(result.track),
      current,
      baseline,
      diagnostics: result.diagnostics,
      practiceParity: practice
        ? practice.ticks === m?.fast.finishTicks
        : undefined,
      wallMs: round(performance.now() - started),
    };
    rows.push(row);
    if (i < 12 && old && baseline) {
      const x = (i % 3) * 500,
        y = 70 + Math.floor(i / 3) * 325;
      gallery.push(
        `<g><rect x="${x + 5}" y="${y}" width="490" height="315" rx="12" fill="white"/><text x="${x + 20}" y="${y + 24}" font-size="16" font-weight="bold">evaluation-${i}</text><text x="${x + 20}" y="${y + 46}" font-size="13">Previous</text><text x="${x + 265}" y="${y + 46}" font-size="13">Linked corners + hills</text>${map(old.track, x + 20, y + 55, '#8f9ba6')}${map(result.track, x + 265, y + 55, '#20756b')}<text x="${x + 20}" y="${y + 282}" font-size="12">Straight ${baseline.longestStraight} m · hold ${baseline.longestThrottleSeconds} s</text><text x="${x + 265}" y="${y + 282}" font-size="12">Straight ${current.longestStraight} m · hold ${current.longestThrottleSeconds} s</text><text x="${x + 20}" y="${y + 301}" font-size="12">${baseline.brakesPerMinute} brakes/min · ${round(baseline.fast?.seconds ?? 0)} s lap</text><text x="${x + 265}" y="${y + 301}" font-size="12">${current.brakesPerMinute} brakes/min · ${round(current.fast?.seconds ?? 0)} s lap</text></g>`
      );
    }
  } catch (error) {
    rows.push({ seed, error: String(error) });
  }
  if ((i + 1) % 25 === 0) console.log(`Evaluated ${i + 1}/${seeds.length}`);
}
const failures = rows.filter(
  (row) => 'error' in row || !row.current.valid || row.practiceParity === false
);
const distinctProfiles = new Set(
  rows.flatMap((row) =>
    'error' in row ? [] : [JSON.stringify(row.current.curvatureProfile)]
  )
).size;
const report = {
  version: LINKED_COURSE_VERSION,
  limits: LINKED_RHYTHM_LIMITS,
  sourcePopulation:
    '100 development words, 100 previously untested sequential UTC daily seeds, three shared words, offline reference, reserve',
  count: rows.length,
  distinctProfiles,
  failures: failures.map((r) => r.seed),
  rows,
};
writeFileSync(
  join(output, 'report.json'),
  JSON.stringify(report, null, 2) + '\n'
);
writeFileSync(
  join(output, 'gallery.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1380" viewBox="0 0 1500 1380"><rect width="1500" height="1380" fill="#edf1f4"/><g font-family="Arial,sans-serif" fill="#162739"><text x="25" y="30" font-size="23" font-weight="bold">Shorter recovery, connected braking decisions</text><text x="25" y="53" font-size="14">Same requested seeds · independently fitted maps · amber marks elevation · dot is start · measured inputs use production physics</text>${gallery.join('')}</g></svg>`
);
console.log(
  JSON.stringify({ count: rows.length, failures: report.failures, output })
);
if (failures.length || distinctProfiles !== rows.length) process.exitCode = 1;
