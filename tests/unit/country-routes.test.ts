import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import {
  assessTrackStructure,
  segmentsIntersect,
} from '../../src/shared/circuit-validation.ts';
import {
  createSimulationState,
  stepSimulation,
} from '../../src/shared/simulation.ts';
import {
  sampleTrack,
  parseTrack,
  serializeTrack,
  hashTrack,
  type Track,
} from '../../src/shared/track.ts';
import { runReplay } from '../../src/shared/replay.ts';
import { holdBot } from '../../src/shared/driving-bots.ts';

const bridge = generateElevatedCircuit('country-4');
const jump = generateElevatedCircuit('country-1');
function crossings(track: Track) {
  const pairs = [];
  for (let i = 0; i < track.samples.length - 1; i++)
    for (let j = i + 30; j < track.samples.length - 1; j++) {
      const a = track.samples[i],
        b = track.samples[i + 1],
        c = track.samples[j],
        d = track.samples[j + 1];
      if (
        a &&
        b &&
        c &&
        d &&
        track.totalLength - (c.s - a.s) > 30 &&
        segmentsIntersect(a, b, c, d)
      )
        pairs.push({ a, b, c, d });
    }
  return pairs;
}
void test('ordinary seeds compose repeatable gap and overpass routes in one countryside generator', () => {
  assert.deepEqual(generateElevatedCircuit('country-4'), bridge);
  assert.deepEqual(generateElevatedCircuit('country-1'), jump);
  assert.notEqual(serializeTrack(bridge.track), serializeTrack(jump.track));
  assert.ok(jump.track.jumps?.length);
  assert.ok(crossings(bridge.track).length > 0);
  assert.ok(bridge.quality.valid && jump.quality.valid);
});
void test('overlapping roads have full deck clearance; a low bridge or same-level crossing rejects', () => {
  const pairs = crossings(bridge.track);
  assert.ok(pairs.length > 0);
  for (const { a, b, c, d } of pairs)
    assert.ok(
      Math.max(
        Math.min(a.y ?? 0, b.y ?? 0) - Math.max(c.y ?? 0, d.y ?? 0),
        Math.min(c.y ?? 0, d.y ?? 0) - Math.max(a.y ?? 0, b.y ?? 0)
      ) >= 3.5
    );
  for (const factor of [0, 0.5]) {
    const low = {
      ...bridge.track,
      samples: bridge.track.samples.map((p) => ({
        ...p,
        y: (p.y ?? 0) * factor,
        grade: (p.grade ?? 0) * factor,
        verticalCurvature: (p.verticalCurvature ?? 0) * factor,
      })),
    };
    const assessment = assessTrackStructure(low);
    assert.ok(assessment.codes.includes('centerline-intersection'));
  }
});
void test('car follows its progress through both crossing levels without deck snapping', () => {
  const track = bridge.track;
  let state = createSimulationState(track);
  while (state.status === 'running') {
    state = stepSimulation(track, state, true);
    assert.ok(Number.isFinite(state.lateralOffset));
    assert.ok(Number.isFinite(state.lateralVelocity));
    assert.equal(state.vertical?.airborne, false);
    assert.ok(
      Math.abs(
        (state.vertical?.height ?? 0) -
          (sampleTrack(track, state.distance).y ?? 0)
      ) < 1e-6
    );
  }
});
void test('a timely brake genuinely wins time while both controls follow the same fixed route', () => {
  for (const result of [bridge, jump]) {
    const tape = result.quality.fastReplay;
    assert.ok(tape && result.quality.metrics);
    const hold = holdBot(result.track);
    const verified = runReplay(result.track, tape);
    assert.ok(
      hold.summary.finishTicks !== null &&
        hold.summary.finishTicks - verified.finishTicks >= 60
    );
    assert.ok(result.quality.metrics.meaningfulLifts >= 2);
    assert.ok(
      result.quality.metrics.fast.offRoadTicks < hold.summary.offRoadTicks
    );
    assert.equal(result.quality.metrics.fast.recoveryCount, 0);
  }
});
void test('canonical gaps survive transport/hash and reject unsafe or overlapping edits', async () => {
  const track = jump.track;
  assert.deepEqual(parseTrack(JSON.parse(serializeTrack(track))), track);
  const gap = track.jumps?.[0];
  assert.ok(gap);
  for (const edited of [
    { ...gap, landing: gap.takeoff },
    { ...gap, height: 0 },
    { ...gap, landing: gap.takeoff + 20 },
  ])
    assert.throws(() => parseTrack({ ...track, jumps: [edited] }));
  assert.throws(() => parseTrack({ ...track, jumps: [gap, gap] }));
  assert.notEqual(
    await hashTrack(track),
    await hashTrack({
      ...track,
      jumps: [{ ...gap, landing: gap.landing + 0.5 }],
    })
  );
});
