import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  noBrakeIntervals,
  releaseZones,
  referenceDemand,
  zonePolicy,
  type DemandRun,
} from '../../scripts/lib/brake-demand';
import { generateBrakingCircuit } from '../../src/shared/braking-course-generator';
import { hashTrack } from '../../src/shared/track';
import { runReplay } from '../../src/shared/replay';
import {
  createTrackShare,
  parseTrackShare,
  verifySharedTrack,
} from '../../src/shared/track-share';

void test('demand intervals include GO and finish without joining across a standing-lap boundary', () => {
  assert.deepEqual(
    noBrakeIntervals(30, [
      { start: 5, end: 6 },
      { start: 20, end: 21 },
    ]),
    [
      { start: 0, end: 5 },
      { start: 6, end: 20 },
      { start: 21, end: 30 },
    ]
  );
  assert.deepEqual(noBrakeIntervals(30, []), [{ start: 0, end: 30 }]);
});

void test('tiny releases and airborne input cannot fabricate brake demand', () => {
  const run: DemandRun = {
    finished: true,
    seconds: 5,
    offRoadTicks: 0,
    recoveryTicks: 0,
    checkpoints: 8,
    trace: Array.from({ length: 600 }, (_, tick) => ({
      tick,
      s: tick / 6,
      speed: 20,
      held:
        !(tick >= 100 && tick < 112) &&
        !(tick >= 200 && tick < 224) &&
        !(tick >= 400 && tick < 450),
      airborne: tick >= 400 && tick < 450,
      offRoad: false,
      lateral: 0,
    })),
  };
  const zones = releaseZones(run);
  assert.equal(zones.length, 1);
  assert.equal(zones[0]?.from, 200 / 6);
  assert.equal(zones[0]?.to, 224 / 6);
  const policy = zonePolicy([{ from: 10, to: 20, floor: 15 }]);
  // A slower counterfactual must never get trapped at zero speed in a spatial release window.
  assert.equal(
    policy({
      tick: 100,
      distance: 12,
      speed: 2,
      lateralOffset: 0,
      lateralVelocity: 0,
      slip: 0,
      offRoad: false,
      recovering: false,
      recoveryTicksRemaining: 0,
      recoveryCount: 0,
      finishedTick: null,
      status: 'running',
    }),
    true
  );
});

void test('retained V6 geometry, candidate selection, replays and share identities remain frozen', async () => {
  const fixtures = [
    {
      day: '2026-11-24',
      hash: '38fc298e5f633a0319ea5cb1a89e3b286eaa76536d43a0084c8dda6459fb913d',
      ticks: 3079,
      attempt: 2,
    },
    {
      day: '2026-11-25',
      hash: '975e4c9fc0f17dd4da407c7f98016934445f75c32f24a43f5834ef61e051626a',
      ticks: 3533,
      attempt: 1,
    },
    {
      day: '2026-11-27',
      hash: '0c8b220d0a8474c738028914cf184c3a0ea92112a34868587a2f60929ed8ef33',
      ticks: 4719,
      attempt: 1,
    },
    {
      day: '2026-11-28',
      hash: 'daa247fafb9382c7c39994b800439ed645f1a010101b622a85654d2ae472831d',
      ticks: 3697,
      attempt: 1,
    },
  ];
  for (const f of fixtures) {
    const old = generateBrakingCircuit(
      `daily:t5_kyc33w:${f.day}`,
      undefined,
      'linked-circuits-v6'
    );
    assert.equal(await hashTrack(old.track), f.hash);
    assert.equal(old.diagnostics.acceptedAttempt, f.attempt);
    assert.equal(old.quality.metrics?.fast.finishTicks, f.ticks);
    assert(old.quality.fastReplay);
    assert.equal(
      runReplay(old.track, old.quality.fastReplay).finishTicks,
      f.ticks
    );
  }
  const old = generateBrakingCircuit(
    'word-v2:banana',
    undefined,
    'linked-circuits-v6'
  );
  const share = parseTrackShare(
    JSON.stringify(await createTrackShare('banana', old.track))
  );
  await verifySharedTrack(
    share,
    generateBrakingCircuit(
      'word-v2:banana',
      undefined,
      share.generator === 'linked-circuits-v3'
        ? 'linked-circuits-v4'
        : share.generator
    ).track
  );
  await assert.rejects(
    verifySharedTrack(share, generateBrakingCircuit('word-v2:banana').track)
  );
});

void test('independent reference completes the actual road finish and every counted brake has physical evidence', () => {
  const track = generateBrakingCircuit('daily:t5_kyc33w:2026-11-25').track;
  const demand = referenceDemand(track);
  assert(demand.run.finished);
  assert.equal(demand.run.checkpoints, track.checkpoints.length);
  assert.equal(demand.run.recoveryTicks, 0);
  assert(demand.validated.length >= 3);
  assert(demand.brakeFraction < 0.25);
  for (const event of demand.validated)
    assert((event.savedSeconds ?? 0) >= 0.05 || event.destabilizes);
});
