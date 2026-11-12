import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessTrackStructure,
  segmentDistance,
  segmentsIntersect,
} from './circuit-validation.ts';
import { createOvalTrack, createTrackFromPoints } from './track-authoring.ts';

void test('segment clearance handles crossings, parallel returns and disjoint collinear edges', () => {
  assert.equal(
    segmentsIntersect(
      { x: -1, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: -1 },
      { x: 0, z: 1 }
    ),
    true
  );
  assert.equal(
    segmentDistance(
      { x: -1, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: -1 },
      { x: 0, z: 1 }
    ),
    0
  );
  assert.equal(
    segmentDistance(
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 1, z: 2 },
      { x: 3, z: 2 }
    ),
    2
  );
  assert.equal(
    segmentDistance(
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 2, z: 0 },
      { x: 3, z: 0 }
    ),
    1
  );
});

void test('structural options fail closed and actual geometry constrains offset shoulders', () => {
  const track = createOvalTrack();
  for (const options of [
    { minRadius: NaN, clearance: 2, shoulder: 0.8 },
    { minRadius: 10, clearance: -1, shoulder: 0.8 },
    { minRadius: 10, clearance: 2, shoulder: Infinity },
    { minRadius: 0, clearance: 2, shoulder: 0.8 },
  ]) {
    const result = assessTrackStructure(track, options);
    assert.equal(result.valid, false);
    assert.ok(result.codes.includes('invalid-options'));
  }
  assert.equal(
    assessTrackStructure(track, JSON.parse('{"minRadius":10,"clearance":2}'))
      .valid,
    false
  );
  const folded = assessTrackStructure(
    createOvalTrack({ radiusX: 10, radiusZ: 10 }),
    { minRadius: 7, clearance: 2, shoulder: 7 }
  );
  assert.equal(folded.valid, false);
  assert.ok(folded.codes.includes('corridor-fold'));
  const noRoom = assessTrackStructure(track, {
    minRadius: 10,
    clearance: 50,
    shoulder: 0.8,
  });
  assert.equal(noRoom.valid, false);
  assert.ok(noRoom.codes.includes('road-clearance'));
});

void test('nonadjacent crossing and forged curvature cannot pass structural checks', () => {
  const figureEight = createTrackFromPoints(
    Array.from({ length: 2048 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 2048;
      return { x: 40 * Math.sin(angle), z: 20 * Math.sin(2 * angle) };
    }),
    { seed: 'broken-crossing', generatorVersion: 'broken-fixture', width: 1 }
  );
  const crossing = assessTrackStructure(figureEight, {
    minRadius: 1,
    clearance: 1,
    shoulder: 0,
  });
  assert.equal(crossing.valid, false);
  assert.ok(crossing.codes.includes('centerline-intersection'));
  assert.ok(crossing.codes.includes('road-clearance'));
  const forged = createOvalTrack();
  const first = forged.samples[0];
  if (!first) throw new Error('Missing fixture point');
  first.curvature = 0;
  const result = assessTrackStructure(forged);
  assert.equal(result.valid, false);
  assert.ok(result.codes.includes('frame-consistency'));
});
