import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  generateBrakingCircuit,
  generateCurrentDailyCircuit,
} from '../src/shared/braking-course-generator';
import { courseFamilyForSeed } from '../src/shared/course-families';
import {
  DAY_MILLISECONDS,
  utcDay,
  utcDayWindow,
} from '../src/shared/daily-challenge';
import { runtimeForTrack } from '../src/shared/scored-runtime';
import {
  findTrackCrossings,
  crossingHeadroom,
} from '../src/shared/track-crossings';
import { hashTrack, serializeTrack, type Track } from '../src/shared/track';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function expectedHashes(file: string) {
  const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
  assert(record(value) && Array.isArray(value.rows));
  const hashes = new Map<string, string>();
  for (const row of value.rows) {
    assert(
      record(row) &&
        typeof row.seed === 'string' &&
        typeof row.hash === 'string'
    );
    hashes.set(row.seed, row.hash);
  }
  return hashes;
}
const expectedOld = expectedHashes(
  'docs/evidence/braking-rhythm/baseline.json'
);
const expectedNew = expectedHashes('docs/evidence/braking-rhythm/tuned.json');
async function mapData(track: Track) {
  const geometryHash = createHash('sha256')
    .update(
      JSON.stringify({
        samples: track.samples,
        totalLength: track.totalLength,
        checkpoints: track.checkpoints,
        jumps: track.jumps,
      })
    )
    .digest('hex');
  const crossings = findTrackCrossings(track);
  return {
    track: JSON.parse(serializeTrack(track)),
    trackHash: await hashTrack(track),
    geometryHash,
    crossings,
    headroom: crossings.length ? crossingHeadroom(track) : null,
    runtime: runtimeForTrack(track),
  };
}
const output = process.argv[2] ?? '/tmp/daily-lap-course-gallery.json';
const firstDay = '2026-11-24',
  subredditId = 't5_kyc33w';
const firstMs = utcDayWindow(firstDay).startsAtMs;
const pairs = [];
for (let i = 0; i < 30; i++) {
  const day = utcDay(firstMs + i * DAY_MILLISECONDS);
  // Same namespace and UTC day boundary as core/daily-challenges.ts. No stored
  // record is created or read; persisted courses can differ from this preview.
  const seed = `daily:${subredditId}:${day}`;
  const old = generateBrakingCircuit(seed, undefined, 'linked-circuits-v6');
  const current = generateCurrentDailyCircuit(seed);
  assert(old.quality.valid && current.quality.valid);
  const oldMap = await mapData(old.track),
    newMap = await mapData(current.track);
  assert.equal(oldMap.trackHash, expectedOld.get(seed), `V6 changed: ${day}`);
  assert.equal(newMap.trackHash, expectedNew.get(seed), `V7 changed: ${day}`);
  assert.equal(
    oldMap.runtime.simulationVersion,
    newMap.runtime.simulationVersion
  );
  const pair = {
    day,
    seed,
    family: courseFamilyForSeed(seed),
    status: 'offline-preview',
    unchangedGeometry: oldMap.geometryHash === newMap.geometryHash,
    old: oldMap,
    new: newMap,
  };
  pairs.push(pair);
  console.log(
    JSON.stringify({ day, unchangedGeometry: pair.unchangedGeometry })
  );
}
assert.equal(new Set(pairs.map((p) => p.day)).size, 30);
assert.equal(pairs.at(-1)?.day, '2026-12-23');
const document = {
  title: 'The Daily Lap - V6 and V7 course previews',
  sourceV7Commit: 'b7d0f862250675bc707cf382f34862056df3fab8',
  sourceV6Commit: 'c155dce88db80e011b2c102c4f55fd086661f6b8',
  subredditId,
  firstDay,
  lastDay: pairs.at(-1)?.day,
  count: pairs.length,
  unchangedCount: pairs.filter((p) => p.unchangedGeometry).length,
  verifiedAgainstOriginalThirtyDayCampaign: true,
  note: 'Exact canonical sampled geometry. Upcoming dates are previews, not confirmed live records. Existing stored daily courses are immutable.',
  pairs,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(document));
console.log(
  JSON.stringify({
    output,
    pairs: pairs.length,
    unchanged: document.unchangedCount,
  })
);
