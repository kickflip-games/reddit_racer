import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateElevatedCandidate,
  generateElevatedCircuit,
  ELEVATED_RESERVE_SEED,
  ELEVATED_RESERVE_ATTEMPT,
} from '../../src/shared/elevated-generator.ts';
import {
  createSimulationState,
  stepSimulation,
  type SimulationState,
} from '../../src/shared/simulation.ts';
import { createRacingState, stepRace } from '../../src/shared/race-rules.ts';
import {
  scoredRuntime,
  runtimeForTrack,
  FLIGHT_GRAVITY,
} from '../../src/shared/scored-runtime.ts';
import {
  parseTrack,
  serializeTrack,
  sampleTrack,
  hashTrack,
} from '../../src/shared/track.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { runReplay } from '../../src/shared/replay.ts';
import {
  createDailyChallengeRecord,
  parseDailyChallengeRecord,
  serializeDailyChallengeRecord,
} from '../../src/shared/daily-challenge.ts';
import { buildRoadStripVertices } from '../../src/client/track-renderer.ts';
import { createRaceCamera } from '../../src/client/race-camera.ts';
import { Vector3 } from 'three';
import { circuitTerrainHeight } from '../../src/client/circuit-terrain.ts';

const generated = generateElevatedCircuit('country-1');
const track = generated.track;

void test('complete runtime pairs are retained, cross-pairs and unknown frequencies reject', () => {
  assert.equal(runtimeForTrack(createOvalTrack()).handling.maximumSpeed, 22);
  assert.equal(runtimeForTrack(track).handling.maximumSpeed, 30);
  assert.throws(() => scoredRuntime('fixed-step-v4', 'arcade-v1'));
  assert.throws(() => scoredRuntime('fixed-step-v2', 'centreline-v1'));
  assert.throws(() => scoredRuntime('fixed-step-v4', 'centreline-v1', 60));
});

void test('elevated seeds reconstruct full canonical height profiles with finite closed seams', async () => {
  assert.deepEqual(generateElevatedCircuit('country-1'), generated);
  assert.deepEqual(parseTrack(JSON.parse(serializeTrack(track))), track);
  assert.equal(
    await hashTrack(parseTrack(JSON.parse(serializeTrack(track)))),
    await hashTrack(track)
  );
  assert.ok(track.samples.some((p) => (p.y ?? 0) > 2.9));
  for (const s of [0, 19, track.totalLength - 19, track.totalLength]) {
    const p = sampleTrack(track, s);
    assert.equal(p.y, 0);
    assert.equal(p.grade, 0);
    assert.equal(p.verticalCurvature, 0);
  }
});

void test('malformed, missing and inconsistent elevation reject before racing', () => {
  for (const y of [undefined, NaN, Infinity, -1, 9]) {
    const broken = structuredClone(track);
    const p = broken.samples[40];
    assert.ok(p);
    if (y === undefined) delete p.y;
    else p.y = y;
    assert.throws(() => parseTrack(broken));
  }
  const broken = structuredClone(track);
  const p = broken.samples[40];
  assert.ok(p);
  p.grade = 0.49;
  assert.throws(() => parseTrack(broken), /derivatives/);
});

void test('faster acceleration and progressive release use fresh vertical initial conditions', () => {
  let old = createSimulationState(),
    next = createSimulationState(track);
  const flat = createOvalTrack();
  for (let i = 0; i < 120; i++) {
    old = stepSimulation(flat, old, true);
    next = stepSimulation(track, next, true);
  }
  assert.ok(next.speed > old.speed * 1.5);
  const released = stepSimulation(track, next, false);
  assert.ok(released.speed < next.speed && released.speed > next.speed - 0.2);
  const another = createSimulationState(track);
  assert.deepEqual(another.vertical, {
    height: 0,
    velocity: 0,
    airborne: false,
    landings: 0,
    impact: 0,
  });
});

void test('gap launch and flight follow gravity without mid-air tyre braking', () => {
  const frame = sampleTrack(track, 46);
  const initial = {
    ...createSimulationState(track),
    distance: 46,
    speed: 30,
    vertical: {
      height: frame.y ?? 0,
      velocity: 0,
      airborne: false,
      landings: 0,
      impact: 0,
    },
  };
  const fast = stepSimulation(track, initial, true),
    slow = stepSimulation(
      track,
      {
        ...initial,
        distance: 30,
        speed: 7,
        vertical: {
          ...initial.vertical,
          height: sampleTrack(track, 30).y ?? 0,
        },
      },
      true
    );
  assert.equal(fast.vertical?.airborne, true);
  assert.equal(slow.vertical?.airborne, false);
  assert.ok(
    Math.abs(
      (slow.vertical?.height ?? 0) - (sampleTrack(track, slow.distance).y ?? 0)
    ) < 0.000001
  );
  const flight = {
    ...fast,
    vertical: {
      height: 8,
      velocity: 3,
      airborne: true,
      landings: 0,
      impact: 0,
    },
  };
  const held = stepSimulation(track, flight, true),
    released = stepSimulation(track, flight, false);
  assert.deepEqual(held, released);
  assert.ok(
    Math.abs((held.vertical?.velocity ?? 0) - (3 - FLIGHT_GRAVITY / 120)) <
      0.000001
  );
  assert.ok(
    Math.abs(
      (held.vertical?.height ?? 0) -
        (8 + 3 / 120 - FLIGHT_GRAVITY / (2 * 120 * 120))
    ) < 0.000001
  );
});

void test('a complete elevated lap lands, validates all checkpoints and replays exactly', () => {
  const replay = generated.quality.fastReplay;
  assert.ok(replay);
  let race = createRacingState(track),
    held = false,
    index = 0,
    airborne = 0,
    groundedLandings = 0;
  for (let tick = 0; tick < replay.endTick; tick++) {
    const input = replay.transitions[index];
    if (input?.tick === tick) {
      held = input.held;
      index++;
    }
    const prior = race.simulation.vertical;
    race = stepRace(track, race, held);
    if (race.simulation.vertical?.airborne) airborne++;
    if (prior?.airborne && !race.simulation.vertical?.airborne)
      groundedLandings++;
  }
  assert.equal(race.phase, 'finished');
  assert.ok(airborne >= 12);
  assert.ok(groundedLandings >= 1);
  assert.deepEqual(runReplay(track, replay).state, race.simulation);
  assert.equal(race.simulation.vertical?.height, 0);
  assert.throws(
    () =>
      runReplay(track, {
        ...replay,
        simulationVersion: 'fixed-step-v2',
        handlingVersion: 'arcade-v1',
      }),
    /version|rules|match/i
  );
});

void test('a slow missed gap rescues to the landing with an exact stationary penalty', () => {
  const jump = track.jumps?.[0];
  assert.ok(jump);
  let state: SimulationState = {
    ...createSimulationState(track),
    distance: jump.takeoff + 1,
    speed: 2,
    vertical: {
      height: 0.01,
      velocity: -4,
      airborne: true,
      landings: 0,
      impact: 0,
    },
  };
  state = stepSimulation(track, state, true);
  assert.equal(state.recovering, true);
  assert.equal(state.distance, jump.landing);
  assert.equal(state.recoveryCount, 1);
  for (let i = 0; i < 89; i++) {
    state = stepSimulation(track, state, true);
    assert.equal(state.distance, jump.landing);
    assert.equal(state.lateralOffset, 0);
  }
  assert.equal(state.recovering, false);
  assert.ok(stepSimulation(track, state, true).distance > jump.landing);
});

void test('canonical elevated mesh and camera include road height and airborne car across phone viewports', () => {
  const vertices = buildRoadStripVertices(
    track,
    { side: -1, offset: 0 },
    { side: 1, offset: 0 },
    0.03
  );
  for (const [i, p] of track.samples.entries())
    assert.equal(vertices.positions[i * 6 + 1], (p.y ?? 0) + 0.03);
  const frame = sampleTrack(track, 46);
  for (const [width, height] of [
    [320, 568],
    [640, 360],
  ]) {
    assert.ok(width && height);
    const view = createRaceCamera(track);
    view.resize({
      width,
      height,
      insets: { top: 70, right: 12, bottom: 40, left: 12 },
    });
    view.update(
      {
        distance: 46,
        lateralOffset: 0,
        heading: Math.atan2(frame.tx, frame.tz),
        elevation: 5,
      },
      { mode: 'chase', deltaSeconds: 0, reset: true }
    );
    const p = new Vector3(frame.x, 6.8, frame.z).project(view.camera);
    assert.ok(Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1);
    assert.equal(
      circuitTerrainHeight(
        track,
        frame.x + frame.nx * 11,
        frame.z + frame.nz * 11
      ),
      0
    );
  }
});

void test('bounded generation reports every search and explicitly revalidates its procedural reserve', () => {
  const result = generateElevatedCircuit('bounded-probe', { maxAttempts: 1 });
  assert.ok(result.diagnostics.attempts <= 1);
  assert.ok(result.diagnostics.validationWork.qualityAssessments <= 2);
  assert.equal(result.quality.valid, true);
  const reserve = generateElevatedCandidate(
    ELEVATED_RESERVE_SEED,
    ELEVATED_RESERVE_ATTEMPT
  );
  assert.ok(reserve.track);
  assert.throws(() => generateElevatedCircuit('bad', { maxAttempts: 33 }));
  assert.throws(() => generateElevatedCircuit('bad', { lengthMin: 400 }));
});

void test('immutable daily storage binds the complete elevated course and new handling; a legacy tuple cannot reinterpret it', async () => {
  const stored = await createDailyChallengeRecord({
    subredditId: 't5_hills',
    day: '2026-11-13',
    createdAtMs: Date.parse('2026-11-13T12:00:00Z'),
    requestedSeed: 'country-1',
    generated,
  });
  assert.equal(stored.simulationVersion, 'fixed-step-v4');
  assert.equal(stored.handlingVersion, 'centreline-v1');
  assert.deepEqual(
    await parseDailyChallengeRecord(
      JSON.parse(serializeDailyChallengeRecord(stored))
    ),
    stored
  );
  await assert.rejects(
    parseDailyChallengeRecord({
      ...stored,
      simulationVersion: 'fixed-step-v2',
      handlingVersion: 'arcade-v1',
    }),
    /rules/
  );
  const broken = structuredClone(stored);
  const p = broken.track.samples[40];
  assert.ok(p);
  p.y = (p.y ?? 0) + 0.00001;
  await assert.rejects(parseDailyChallengeRecord(broken), /hash/);
});

void test('a frozen elevated daily replays every recorded grounded, airborne and finish state without regenerating geometry', async () => {
  const { readFile } = await import('node:fs/promises');
  const { validateReplay } = await import('../../src/shared/replay.ts');
  const raw: unknown = JSON.parse(
    await readFile(
      new URL('../fixtures/elevated/scored-course.json', import.meta.url),
      'utf8'
    )
  );
  assert.ok(
    typeof raw === 'object' &&
      raw !== null &&
      'track' in raw &&
      'replay' in raw &&
      'states' in raw &&
      'trackHash' in raw
  );
  const frozen = parseTrack(raw.track),
    tape = validateReplay(raw.replay);
  assert.equal(
    await hashTrack(frozen),
    '2bed0025e4cfed6d3dbfc5fce293adbae886123c49c4148387c60fcb96083b43'
  );
  assert.equal(await hashTrack(frozen), raw.trackHash);
  assert.ok(Array.isArray(raw.states));
  const wanted = new Set(
    raw.states.map((value: unknown) => {
      assert.ok(
        typeof value === 'object' &&
          value !== null &&
          'tick' in value &&
          typeof value.tick === 'number'
      );
      return value.tick;
    })
  );
  let race = createRacingState(frozen),
    held = false,
    index = 0;
  const actual = [];
  for (let tick = 0; tick < tape.endTick; tick++) {
    const change = tape.transitions[index];
    if (change?.tick === tick) {
      held = change.held;
      index++;
    }
    race = stepRace(frozen, race, held);
    if (wanted.has(race.simulation.tick)) actual.push(race.simulation);
  }
  assert.equal(race.phase, 'finished');
  assert.equal(race.simulation.finishedTick, 3451);
  assert.ok(actual.some((state) => state.vertical?.airborne));
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), raw.states);
});

void test('centreline handling corrects lateral state without wandering or changing the road surface', () => {
  const initial: SimulationState = {
    ...createSimulationState(track),
    distance: 30,
    speed: 5,
    lateralOffset: 5,
    lateralVelocity: -8,
    vertical: {
      height: sampleTrack(track, 30).y ?? 0,
      velocity: 0,
      airborne: false,
      landings: 0,
      impact: 0,
    },
  };
  const next = stepSimulation(track, initial, true);
  assert.equal(next.offRoad, false);
  assert.equal(next.recovering, false);
  assert.equal(next.lateralOffset, 0);
  assert.equal(next.lateralVelocity, 0);
  assert.ok(
    Math.abs(
      (next.vertical?.height ?? 0) - (sampleTrack(track, next.distance).y ?? 0)
    ) < 1e-6
  );
});
