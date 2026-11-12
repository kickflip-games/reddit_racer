import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GENERATOR_CONFIG,
  FALLBACK_CIRCUIT_SEED,
  generateCircuit,
  generateCircuitCandidate,
  GENERATOR_VERSION,
  MOTIF_KINDS,
} from './circuit-generator.ts';
import {
  assessTrackStructure,
  MIN_START_STRAIGHT,
} from './circuit-validation.ts';
import { hashTrack, parseTrack, serializeTrack } from './track.ts';
import { createRacingState, stepRace } from './race-rules.ts';
import {
  EXPECTED_FIRST_CIRCUIT_HASH,
  EXPECTED_RESERVE_CIRCUIT_HASH,
  SHOWCASE_CIRCUIT_SEEDS,
} from './fixtures/showcase-circuits.ts';
import type { Track } from './track.ts';

function opposingTurnDegrees(track: Track): number {
  let netTurn = 0,
    currentTurn = 0,
    lastSign = 0;
  const lobes: number[] = [];
  for (let index = 0; index < track.samples.length; index++) {
    const sample = track.samples[index],
      next = track.samples[(index + 1) % track.samples.length];
    if (!sample || !next) throw new Error('Incomplete generated sample');
    const length =
      index + 1 === track.samples.length
        ? track.totalLength - sample.s
        : next.s - sample.s;
    netTurn += sample.curvature * length;
    const sign =
      Math.abs(sample.curvature) < 0.004 ? 0 : Math.sign(sample.curvature);
    if (sign && lastSign && sign !== lastSign) {
      lobes.push(currentTurn);
      currentTurn = 0;
    }
    if (sign) {
      currentTurn += sample.curvature * length;
      lastSign = sign;
    }
  }
  lobes.push(currentTurn);
  const opposite = lobes.filter(
    (angle) => Math.sign(angle) !== Math.sign(netTurn)
  );
  return (Math.max(0, ...opposite.map(Math.abs)) * 180) / Math.PI;
}

void test('seed, version and configuration reconstruct exact canonical geometry and pinned hashes', async () => {
  const first = generateCircuit('regression-0');
  assert.deepEqual(generateCircuit('regression-0'), first);
  assert.equal(first.track.generatorVersion, GENERATOR_VERSION);
  assert.equal(first.diagnostics.version, GENERATOR_VERSION);
  assert.equal(first.track.seed, 'regression-0');
  const hash = await hashTrack(first.track);
  assert.equal(hash, EXPECTED_FIRST_CIRCUIT_HASH);
  assert.equal(
    await hashTrack(parseTrack(JSON.parse(serializeTrack(first.track)))),
    hash
  );
  const wider = generateCircuit('regression-0', { width: 8 });
  assert.ok(wider.track.samples.every((sample) => sample.width === 8));
  assert.notEqual(await hashTrack(wider.track), hash);
});

void test('ten showcased tracks contain a genuine infield return and varied signed corner sequences', () => {
  const profiles = new Set<string>(),
    motifOrders = new Set<string>(),
    changes = new Set<number>();
  for (const seed of SHOWCASE_CIRCUIT_SEEDS) {
    const { track, diagnostics } = generateCircuit(seed);
    for (const kind of MOTIF_KINDS)
      assert.ok(diagnostics.accepted.motifs.includes(kind));
    assert.ok(
      opposingTurnDegrees(track) >= 140,
      `${seed} needs an observed infield turn, not merely a motif label`
    );
    assert.ok(diagnostics.accepted.startStraight >= MIN_START_STRAIGHT);
    assert.ok(track.samples.length >= 350 && track.samples.length <= 501);
    assert.ok(track.samples.some((sample) => sample.curvature < -0.003));
    assert.ok(track.samples.some((sample) => sample.curvature > 0.003));
    // Dimensionless, start-relative curvature detects more than rotation/scale changes.
    profiles.add(
      diagnostics.accepted.curvatureProfile
        .map((curvature) => Math.round(curvature * track.totalLength))
        .join(',')
    );
    motifOrders.add(diagnostics.accepted.motifs.join(','));
    changes.add(diagnostics.accepted.directionChanges);
    let race = createRacingState(track);
    while (race.phase === 'racing') race = stepRace(track, race, true);
    assert.equal(
      race.phase,
      'finished',
      `${seed} must remain compatible with the shared race model`
    );
  }
  assert.equal(profiles.size, SHOWCASE_CIRCUIT_SEEDS.length);
  assert.ok(motifOrders.size >= 8);
  assert.ok(changes.size >= 3);
});

void test('200 fixed seeds pass structural corridor gates without reserve domination', () => {
  let fallbackCount = 0,
    attempts = 0;
  const profiles = new Set<string>();
  for (let index = 0; index < 200; index++) {
    const generated = generateCircuit(`regression-${index}`);
    const assessment = assessTrackStructure(generated.track);
    assert.equal(
      assessment.valid,
      true,
      `${index}: ${assessment.codes.join(',')}`
    );
    assert.ok(
      assessment.metrics.minRadius >= DEFAULT_GENERATOR_CONFIG.minRadius
    );
    assert.ok(
      assessment.metrics.minClearance >= DEFAULT_GENERATOR_CONFIG.clearance
    );
    assert.ok(assessment.metrics.startStraight >= MIN_START_STRAIGHT);
    assert.ok(
      generated.track.totalLength >= 349.8 &&
        generated.track.totalLength <= 500.2
    );
    assert.ok(
      generated.diagnostics.attempts >= 1 &&
        generated.diagnostics.attempts <= 12
    );
    assert.equal(
      generated.diagnostics.rejections.length,
      generated.diagnostics.attempts -
        Number(!generated.diagnostics.fallbackUsed)
    );
    fallbackCount += Number(generated.diagnostics.fallbackUsed);
    attempts += generated.diagnostics.attempts;
    profiles.add(JSON.stringify(assessment.metrics.curvatureProfile));
  }
  assert.ok(
    fallbackCount <= 10,
    `reserve rate ${fallbackCount}/200 exceeds 5%`
  );
  assert.ok(
    attempts / 200 < 5,
    'candidate construction should avoid repeated near-impossible geometry'
  );
  assert.ok(profiles.size >= 190, 'fallback must not erase daily variety');
});

void test('bounded failure uses one pinned generated reserve and reports the requested seed separately', async () => {
  const firstCandidate = generateCircuitCandidate('regression-1', 1);
  assert.ok(firstCandidate.diagnostics.codes.length > 0);
  const generated = generateCircuit('regression-1', { maxAttempts: 1 });
  assert.equal(generated.diagnostics.fallbackUsed, true);
  assert.equal(generated.diagnostics.attempts, 1);
  assert.equal(generated.diagnostics.rejections.length, 1);
  assert.equal(generated.diagnostics.requestedSeed, 'regression-1');
  assert.equal(generated.track.seed, FALLBACK_CIRCUIT_SEED);
  assert.equal(await hashTrack(generated.track), EXPECTED_RESERVE_CIRCUIT_HASH);
  assert.deepEqual(
    generateCircuit('regression-1', { maxAttempts: 1 }),
    generated
  );
  let race = createRacingState(generated.track);
  while (race.phase === 'racing') race = stepRace(generated.track, race, true);
  assert.equal(
    race.phase,
    'finished',
    'the prevalidated reserve completes with authoritative lap rules'
  );
  assert.throws(
    () => generateCircuit('strict-reserve', { minRadius: 50, maxAttempts: 1 }),
    /reserve is incompatible/
  );
});

void test('seed, configuration, and candidate work bounds reject unsupported requests', () => {
  for (const seed of ['', 'x'.repeat(97)])
    assert.throws(() => generateCircuit(seed), /seed/);
  for (const overrides of [
    { maxAttempts: 0 },
    { maxAttempts: 13 },
    { maxAttempts: 1.5 },
    { width: 0 },
    { width: NaN },
    { width: Infinity },
    { lengthMin: 200 },
    { lengthMax: 601 },
    { lengthMin: 500, lengthMax: 400 },
    { clearance: -1 },
    { minRadius: 0 },
    { shoulder: -1 },
  ])
    assert.throws(() => generateCircuit('bounds', overrides), /configuration/);
  assert.throws(
    () => generateCircuit('bounds', JSON.parse('{"extra":1}')),
    /configuration/
  );
  assert.throws(() => generateCircuitCandidate('bounds', 0), /attempt/);
  assert.throws(() => generateCircuitCandidate('bounds', 13), /attempt/);
});
