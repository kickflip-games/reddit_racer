import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateCurrentDailyCircuit,
  generateBrakingCircuit,
  CURRENT_COURSE_RESERVE_SEED,
} from '../src/shared/braking-course-generator';
import { courseFamilyForSeed } from '../src/shared/course-families';
import {
  findTrackCrossings,
  crossingHeadroom,
  type TrackCrossing,
} from '../src/shared/track-crossings';
import {
  LINKED_COURSE_VERSION,
  longestThrottleTicks,
} from '../src/shared/course-rhythm';
import { createDailyChallengeService } from '../src/server/core/daily-challenges';
import { hashTrack, serializeTrack } from '../src/shared/track';
import { runReplay } from '../src/shared/replay';
import { drivePractice, replayPolicy } from './lib/braking-validation';
import type { ValidatedCircuit } from '../src/shared/circuit-quality';
const output = process.argv[2] ?? '/tmp/daily-variety';
const longCount = Number(process.argv[3] ?? 200);
mkdirSync(output, { recursive: true });
const source = {
  base: 'e049da7854a141c536f5b027c50a69db93e5650d',
  status: 'DRAFT / NOT DEPLOYED',
  path: 'createDailyChallengeService.getOrCreate -> generateCurrentDailyCircuit -> createDailyChallengeRecord (independent revalidation)',
  firstDay: '2026-11-23',
  lastDay: '2026-12-22',
};
type ForecastRow = {
  day: string;
  seed: string;
  family: ReturnType<typeof courseFamilyForSeed>;
  trackHash: string;
  track: ValidatedCircuit['track'];
  crossings: TrackCrossing[];
  peakElevation: number;
  ascent: number;
  maxGrade: number;
  quality: ValidatedCircuit['quality'];
  diagnostics: ValidatedCircuit['diagnostics'];
  rankedTicks: number;
  practiceTicks: number | null;
  audit: import('../src/shared/daily-challenge').DailyChallengeAudit;
  baseline: {
    track: ValidatedCircuit['track'];
    metrics: ValidatedCircuit['quality']['metrics'];
    structure: ValidatedCircuit['quality']['structure']['metrics'];
    longestThrottleSeconds: number | null;
  };
  longestThrottleSeconds: number;
};
const rows: ForecastRow[] = [];
const store = new Map<string, Map<string, string>>();
let latest: ValidatedCircuit | undefined,
  reserveCalls = 0,
  generationCalls = 0;
const service = createDailyChallengeService({
  store: {
    hGet: async (k, f) => store.get(k)?.get(f),
    hSetNX: async (k, f, v) => {
      let m = store.get(k);
      if (!m) {
        m = new Map();
        store.set(k, m);
      }
      if (m.has(f)) return 0;
      m.set(f, v);
      return 1;
    },
  },
  now: () => Date.parse('2026-11-22T12:00:00Z'),
  getPost: async () => {
    throw new Error('unused');
  },
  generate: (seed) => {
    generationCalls++;
    latest = generateCurrentDailyCircuit(seed);
    return latest;
  },
  reserve: () => {
    reserveCalls++;
    return generateCurrentDailyCircuit(CURRENT_COURSE_RESERVE_SEED);
  },
});
for (let i = 0; i < 30; i++) {
  const day = new Date(Date.UTC(2026, 10, 23 + i)).toISOString().slice(0, 10),
    seed = `daily:t5_kyc33w:${day}`;
  const record = await service.getOrCreate({ subredditId: 't5_kyc33w', day });
  assert(latest);
  assert.equal(record.track.seed, seed);
  assert.equal(record.audit.generatorFallback, false);
  assert.equal(record.generatorVersion, LINKED_COURSE_VERSION);
  const encoded = serializeTrack(record.track);
  const calls = generationCalls;
  assert.equal(
    serializeTrack(
      (await service.getOrCreate({ subredditId: 't5_kyc33w', day })).track
    ),
    encoded
  );
  assert.equal(generationCalls, calls);
  const q = latest.quality,
    m = q.metrics,
    replay = q.fastReplay;
  assert(m && replay && q.valid);
  const ranked = runReplay(record.track, replay);
  assert.equal(ranked.finishTicks, m.fast.finishTicks);
  const practice = drivePractice(
    record.track,
    replayPolicy({ replay, summary: m.fast })
  );
  assert.equal(practice.ticks, m.fast.finishTicks);
  const old = generateBrakingCircuit(seed, undefined, 'linked-circuits-v5');
  assert(old.quality.valid, `${day}: baseline failed`);
  const elevations = record.track.samples.map((p) => p.y ?? 0);
  const ascent = record.track.samples.reduce(
    (a, p, j) =>
      a +
      Math.max(
        0,
        (record.track.samples[(j + 1) % record.track.samples.length]?.y ?? 0) -
          (p.y ?? 0)
      ),
    0
  );
  rows.push({
    day,
    seed,
    family: courseFamilyForSeed(seed),
    trackHash: record.trackHash,
    track: record.track,
    crossings: findTrackCrossings(record.track),
    peakElevation: Math.max(...elevations),
    ascent,
    maxGrade: Math.max(
      ...record.track.samples.map((p) => Math.abs(p.grade ?? 0))
    ),
    quality: q,
    diagnostics: latest.diagnostics,
    rankedTicks: ranked.finishTicks,
    practiceTicks: practice.ticks,
    audit: record.audit,
    baseline: {
      track: old.track,
      metrics: old.quality.metrics,
      structure: old.quality.structure.metrics,
      longestThrottleSeconds: old.quality.fastReplay
        ? longestThrottleTicks(old.quality.fastReplay) / 120
        : null,
    },
    longestThrottleSeconds: longestThrottleTicks(replay) / 120,
  });
  console.log(
    `Public ${i + 1}/30 ${day} ${courseFamilyForSeed(seed)} accepted`
  );
}
assert.equal(reserveCalls, 0);
assert.equal(new Set(rows.map((r) => r.trackHash)).size, 30);
const forecast = {
  source,
  scope: {
    subredditId: 't5_kyc33w',
    seedPattern: 'daily:t5_kyc33w:YYYY-MM-DD',
  },
  generatorVersion: LINKED_COURSE_VERSION,
  rows,
};
writeFileSync(join(output, 'forecast.json'), JSON.stringify(forecast));
const longRows = [];
for (let i = 0; i < longCount; i++) {
  const seed =
    i < 100
      ? `word-v2:variety-evaluation-${i}`
      : `daily:t5_kyc33w:${new Date(Date.UTC(2027, 0, 1 + i - 100)).toISOString().slice(0, 10)}`;
  try {
    const r = generateCurrentDailyCircuit(seed);
    assert.equal(r.track.seed, seed);
    assert(r.quality.valid);
    assert(r.quality.metrics && r.quality.fastReplay);
    const crossings = findTrackCrossings(r.track);
    if (crossings.length) {
      assert.equal(crossings.length, 1);
      assert(crossingHeadroom(r.track) >= 10);
      assert.equal(r.quality.metrics.fast.airborneTicks, 0);
      assert.equal(r.quality.metrics.cautious.airborneTicks, 0);
    }
    assert.equal(
      runReplay(r.track, r.quality.fastReplay).finishTicks,
      r.quality.metrics.fast.finishTicks
    );
    longRows.push({
      seed,
      hash: await hashTrack(r.track),
      family: courseFamilyForSeed(seed),
      attempt: r.diagnostics.attempts,
      lifts: r.quality.metrics.meaningfulLifts,
      jumps: r.track.jumps?.length ?? 0,
      crossings,
      headroom: crossings.length ? crossingHeadroom(r.track) : null,
      fast: r.quality.metrics.fast,
    });
  } catch (e) {
    longRows.push({ seed, error: String(e) });
  }
  if ((i + 1) % 20 === 0) console.log(`Long run ${i + 1}/${longCount}`);
}
writeFileSync(
  join(output, 'long-run.json'),
  JSON.stringify(
    {
      source: '100 development word seeds + 100 sequential 2027 public dates',
      count: longCount,
      rows: longRows,
    },
    null,
    2
  )
);
const summary = {
  publicDates: rows.length,
  publicReserveCalls: reserveCalls,
  publicUniqueHashes: new Set(rows.map((r) => r.trackHash)).size,
  families: Object.fromEntries(
    ['sweeping', 'switchbacks', 'technical', 'ridge', 'crossover'].map((f) => [
      f,
      rows.filter((r) => r.family === f).length,
    ])
  ),
  jumpDays: rows.filter((r) => r.track.jumps?.length).length,
  bridgeDays: rows.filter((r) => r.crossings.length).length,
  minimumBridgeHeadroom: Math.min(
    ...rows
      .filter((r) => r.crossings.length)
      .map((r) => crossingHeadroom(r.track))
  ),
  lifts: Object.fromEntries(
    [3, 4, 5, 6, 7, 8].map((n) => [
      n,
      rows.filter((r) => r.quality.metrics?.meaningfulLifts === n).length,
    ])
  ),
  oldSixOrSeven: rows.filter((r) =>
    [6, 7].includes(r.baseline.metrics?.meaningfulLifts ?? 0)
  ).length,
  newSixOrSeven: rows.filter((r) =>
    [6, 7].includes(r.quality.metrics?.meaningfulLifts ?? 0)
  ).length,
  longRunCount: longRows.length,
  longRunFailures: longRows.filter((r) => 'error' in r),
  longRunUniqueHashes: new Set(
    longRows.flatMap((r) => ('error' in r ? [] : [r.hash]))
  ).size,
};
writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
assert.equal(summary.longRunFailures.length, 0);
