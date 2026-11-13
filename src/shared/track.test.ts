import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOvalTrack, createTrackFromPoints } from './track-authoring.ts';
import {
  hashTrack,
  parseTrack,
  roadPointAt,
  sampleTrack,
  serializeTrack,
  validateTrack,
} from './track.ts';
import type { Track, TrackSample } from './track.ts';

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`
  );
}

void test('reference oval is quantized, closed, arc-length sampled and deterministic', () => {
  const track = createOvalTrack();
  const next = createOvalTrack();
  assert.deepEqual(track, next);
  assert.ok(track.samples.length > 200 && track.samples.length < 250);
  assert.ok(track.totalLength > 220 && track.totalLength < 230);
  assert.notDeepEqual(track.samples[0], track.samples.at(-1));
  assert.equal(track.startS, 0);
  for (const sample of track.samples) {
    close(sample.x * 10_000, Math.round(sample.x * 10_000), 1e-7);
    close(sample.z * 10_000, Math.round(sample.z * 10_000), 1e-7);
    close(sample.s * 10_000, Math.round(sample.s * 10_000), 1e-7);
    assert.ok(sample.curvature < 0, 'consistent signed turn on this oval');
  }
});

void test('start/finish and negative or multi-lap distances sample the same geometry', () => {
  const track = createOvalTrack();
  const start = sampleTrack(track, 0);
  assert.deepEqual(sampleTrack(track, track.totalLength), start);
  assert.deepEqual(sampleTrack(track, track.totalLength * 5), start);
  const before = sampleTrack(track, -0.0001);
  const after = sampleTrack(track, 0.0001);
  close(before.x, after.x, 0.0003);
  close(before.z, after.z, 0.0003);
  close(before.tx, after.tx, 0.00002);
  close(before.tz, after.tz, 0.00002);
  close(before.curvature, after.curvature, 0.00001);
  close(before.halfWidth, after.halfWidth, 0.00001);
  assert.throws(() => sampleTrack(track, Number.NaN), /finite/);
});

void test('lookup uses actual distance rather than equal index intervals', () => {
  const positions = [
    { x: 0, z: 0 },
    { x: 2, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 3 },
    { x: 10, z: 10 },
    { x: 4, z: 10 },
    { x: 0, z: 10 },
    { x: 0, z: 6 },
  ];
  let length = 0;
  const samples: TrackSample[] = positions.map((point, index) => {
    const next = positions[(index + 1) % positions.length];
    if (!next) throw new Error('Missing fixture point');
    const chord = Math.hypot(next.x - point.x, next.z - point.z);
    const sample = {
      ...point,
      s: length,
      tx: (next.x - point.x) / chord,
      tz: (next.z - point.z) / chord,
      curvature: 0,
      width: 2,
    };
    length += chord;
    return sample;
  });
  const track: Track = {
    schemaVersion: 1,
    generatorVersion: 'nonuniform-test',
    seed: 'fixture',
    totalLength: length,
    startS: 0,
    samples,
    checkpoints: [],
  };
  validateTrack(track);
  const frame = sampleTrack(track, 6);
  assert.equal(frame.x, 6);
  assert.equal(frame.z, 0);
  const closing = sampleTrack(track, 37);
  assert.equal(closing.x, 0);
  assert.equal(closing.z, 3);
});

void test('interpolated physical edges exactly match the linear road cross-section', () => {
  const track = createOvalTrack();
  for (let index = 0; index < track.samples.length; index += 7) {
    const current = track.samples[index];
    const next = track.samples[(index + 1) % track.samples.length];
    if (!current || !next) throw new Error('Missing fixture sample');
    const endS =
      index + 1 === track.samples.length ? track.totalLength : next.s;
    const blend = 0.37;
    const distance = current.s + (endS - current.s) * blend;
    const frame = sampleTrack(track, distance);
    for (const side of [-1, 1]) {
      const edge = roadPointAt(track, distance, side * frame.halfWidth);
      const ax = current.x - ((current.tz * current.width) / 2) * side;
      const az = current.z + ((current.tx * current.width) / 2) * side;
      const bx = next.x - ((next.tz * next.width) / 2) * side;
      const bz = next.z + ((next.tx * next.width) / 2) * side;
      close(edge.x, ax + (bx - ax) * blend);
      close(edge.z, az + (bz - az) * blend);
    }
  }
  const wider = createOvalTrack({ width: 9 });
  const frame = sampleTrack(track, 40.5);
  const wideFrame = sampleTrack(wider, 40.5);
  close(frame.x, wideFrame.x);
  close(frame.z, wideFrame.z);
  close(wideFrame.halfWidth / frame.halfWidth, 9 / 7);
  assert.throws(() => roadPointAt(track, 0, Infinity), /finite/);
});

void test('canonical serialization and SHA-256 survive JSON and object order changes', async () => {
  const track = createOvalTrack();
  const json = serializeTrack(track);
  const reconstructed = parseTrack(JSON.parse(json));
  assert.equal(serializeTrack(reconstructed), json);
  const reordered: Track = {
    checkpoints: track.checkpoints,
    samples: track.samples,
    startS: 0,
    seed: track.seed,
    totalLength: track.totalLength,
    generatorVersion: track.generatorVersion,
    schemaVersion: 1,
  };
  const hash = await hashTrack(track);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(await hashTrack(reconstructed), hash);
  assert.equal(await hashTrack(reordered), hash);
  assert.notEqual(await hashTrack(createOvalTrack({ width: 8 })), hash);
  assert.notEqual(await hashTrack(createOvalTrack({ radiusX: 29 })), hash);
});

void test('malformed geometry fails before reaching sampling or persistence', () => {
  const track = createOvalTrack();
  const mutate = (fn: (value: Track) => void): Track => {
    const copy = parseTrack(JSON.parse(serializeTrack(track)));
    fn(copy);
    return copy;
  };
  assert.throws(
    () =>
      validateTrack(
        mutate((value) => {
          value.totalLength += 1;
        })
      ),
    /length/
  );
  assert.throws(
    () =>
      validateTrack(
        mutate((value) => {
          const sample = value.samples[1];
          if (sample) sample.s = 0;
        })
      ),
    /arc length|increasing/
  );
  assert.throws(
    () =>
      validateTrack(
        mutate((value) => {
          const sample = value.samples[0];
          if (sample) sample.tx = 0;
        })
      ),
    /unit length/
  );
  assert.throws(
    () =>
      validateTrack(
        mutate((value) => {
          const sample = value.samples[0];
          if (sample) sample.width = 0;
        })
      ),
    /width/
  );
  assert.throws(
    () =>
      validateTrack(
        mutate((value) => {
          const sample = value.samples[0];
          if (sample) sample.curvature = 1;
        })
      ),
    /corner radius/
  );
  assert.throws(
    () =>
      validateTrack(
        mutate((value) => {
          const first = value.samples[0];
          const last = value.samples.at(-1);
          if (first && last) {
            last.x = first.x;
            last.z = first.z;
          }
        })
      ),
    /arc length|duplicate/
  );
  assert.throws(
    () =>
      validateTrack(
        mutate((value) => {
          value.checkpoints = [
            { id: 'same', s: 2 },
            { id: 'same', s: 4 },
          ];
        })
      ),
    /Checkpoints/
  );
  assert.throws(() => parseTrack({ ...track, samples: [{ x: 0 }] }), /finite/);
  assert.throws(
    () => parseTrack({ ...track, schemaVersion: 3 }),
    /Unsupported/
  );
  assert.throws(
    () => createOvalTrack({ radiusX: 5, radiusZ: 100 }),
    /corner radius/
  );
  assert.throws(
    () => createOvalTrack({ sampleSpacing: 0 }),
    /authoring options/
  );
  assert.throws(
    () =>
      createTrackFromPoints(
        Array.from({ length: 8 }, () => ({ x: 0, z: 0 })),
        { seed: 'bad', generatorVersion: 'bad' }
      ),
    /duplicate/
  );
});
