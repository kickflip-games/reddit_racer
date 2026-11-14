import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPracticeBestStore,
  practiceBestKey,
} from '../../src/client/practice-best.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
void test('practice bests survive reload, preserve faster times and distinguish ties', () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
  };
  const store = createPracticeBestStore(storage),
    key = 'persistent-fixture';
  assert.equal(store.best(key), null);
  assert.equal(store.record(key, 1800).isNewBest, true);
  assert.equal(store.record(key, 1900).bestTicks, 1800);
  assert.equal(store.record(key, 1800).tied, true);
  const improvement = store.record(key, 1700);
  assert.equal(improvement.previousBestTicks, 1800);
  assert.equal(createPracticeBestStore(storage).best(key), 1700);
  for (const ticks of [0, -1, NaN, 1.5])
    assert.throws(() => store.record(key, ticks));
});
void test('course, handling, lap mode and surface profiles have separate personal bests', () => {
  const a = createOvalTrack(),
    b = createOvalTrack({ radiusX: 40 });
  const keys = [
    practiceBestKey(a, {}),
    practiceBestKey(b, {}),
    practiceBestKey(a, { dynamicGrip: true }),
    practiceBestKey(a, { continuousPractice: true }),
    practiceBestKey(a, {
      gripZones: [{ startS: 1, endS: 20, surface: 'wet', bank: 0 }],
    }),
  ];
  assert.equal(new Set(keys).size, keys.length);
});
void test('storage failures keep session bests and unknown versions are not overwritten', () => {
  let writes = 0;
  const future = createPracticeBestStore({
    getItem: () => '{"version":2}',
    setItem: () => writes++,
  });
  future.record('future-fixture', 1000);
  assert.equal(writes, 0);
  assert.equal(future.persistent, false);
  const failed = createPracticeBestStore({
    getItem: () => null,
    setItem: () => {
      throw new Error('blocked');
    },
  });
  failed.record('blocked-fixture', 1200);
  assert.equal(failed.best('blocked-fixture'), 1200);
  assert.equal(failed.persistent, false);
  assert.equal(createPracticeBestStore().best('blocked-fixture'), 1200);
});

void test('elevated personal bests identify the authoritative runtime without changing retained flat keys', () => {
  const elevated = generateElevatedCircuit('flow-probe-21').track;
  const key = practiceBestKey(elevated, {});
  assert.match(key, /fixed-step-v4/);
  assert.match(key, /centreline-v1/);
  const flat = practiceBestKey(createOvalTrack(), {});
  assert.match(flat, /fixed-step-v2/);
  assert.match(flat, /arcade-v1/);
});
