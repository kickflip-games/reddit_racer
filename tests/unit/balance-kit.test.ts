import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  BALANCE_FIXTURE_DIRECTORY,
  BALANCE_SELECTED_CSV_SHA256,
  BALANCE_SOURCE_REPORT_SHA256,
  assertBalanceReportOutput,
  compareBalanceReports,
  evaluateBalanceKit,
  loadBalanceKit,
  parseBalanceOptions,
  verifyFrozenBalanceReplays,
  writeBalanceReport,
  type BalanceKit,
  type BalanceReport,
} from '../../scripts/balance-kit.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { hashTrack } from '../../src/shared/track.ts';
import {
  HANDLING_VERSION,
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
  SIMULATION_VERSION,
} from '../../src/shared/simulation.ts';
import { MAX_CONTROLLER_RUNS } from '../../src/shared/driving-bots.ts';
import { QUALITY_VERSION } from '../../src/shared/circuit-quality.ts';
import { authorHandmadeReference } from '../fixtures/balance/handmade-author.ts';

const kitPromise = loadBalanceKit();

// Arithmetic fixtures only. No bot runs or claimed race measurements are created
// by the comparison tests; actual tapes are verified in a separate test below.
function comparisonFixture(kit: BalanceKit): BalanceReport {
  const work = {
    controllerRuns: 0,
    simulatedTicks: 0,
    replayChecks: 0,
    replayTicks: 0,
  };
  return {
    schemaVersion: 1,
    kind: 'frozen-driving-evaluation',
    scope: 'Synthetic comparison arithmetic only; not evaluated gameplay.',
    runtime: {
      simulationVersion: SIMULATION_VERSION,
      handlingVersion: HANDLING_VERSION,
      simulationHz: SIMULATION_HZ,
      qualityVersion: QUALITY_VERSION,
    },
    origin: {
      sourceReportSha256: BALANCE_SOURCE_REPORT_SHA256,
      selectedCsvSha256: BALANCE_SELECTED_CSV_SHA256,
      population: kit.population,
    },
    selection: {
      total: 22,
      generated: 20,
      references: 2,
      reserveCoverage: 1,
      label: 'Arithmetic fixture',
    },
    records: kit.courses.map((course) => {
      const summary = (finishTicks: number) => ({
        finished: true,
        finishTicks,
        seconds: finishTicks / SIMULATION_HZ,
        elapsedTicks: finishTicks,
        offRoadTicks: 0,
        recoveryTicks: 0,
        recoveryCount: 0,
        lifts: 1,
        meaningfulLifts: 1,
      });
      const hold = course.expectedFinishTicks.hold;
      const cautious = course.expectedFinishTicks.cautious ?? hold;
      const fast = course.expectedFinishTicks.fast ?? hold;
      return {
        id: course.id,
        role: course.role,
        trackHash: course.trackHash,
        generatorVersion: course.generatorVersion,
        qualityVersion: course.qualityVersion,
        lengthMetres: course.track.totalLength,
        selectionReasons: course.selectionReasons,
        fallbackUsed: course.fallbackUsed,
        expectedFinishTicks: course.expectedFinishTicks,
        hold: summary(hold),
        cautious: summary(cautious),
        boundedFast: summary(fast),
        gainTicks: hold - fast,
        meaningfulIntervals: [{ startTick: 100, endTick: 112, seconds: 0.1 }],
        work: { ...work },
      };
    }),
    failures: [],
    work,
    workAccounting: 'Synthetic zero work',
    limits: { controllerRuns: 0, replayChecks: 0, totalTickBudget: 0 },
  };
}

void test('portable manifest checks 22 unique canonical identities and preserves population provenance separately', async () => {
  const kit = await kitPromise;
  assert.equal(kit.courses.length, 22);
  assert.equal(new Set(kit.courses.map((course) => course.trackHash)).size, 22);
  assert.equal(
    kit.courses.filter((course) => course.role === 'generated').length,
    20
  );
  assert.equal(
    kit.courses.filter((course) => course.role === 'handmade').length,
    1
  );
  assert.equal(
    kit.courses.filter((course) => course.role === 'gentle').length,
    1
  );
  assert.equal(kit.courses.filter((course) => course.fallbackUsed).length, 1);
  assert.equal(kit.population.sourceReportSha256, BALANCE_SOURCE_REPORT_SHA256);
  assert.deepEqual(kit.population.meaningfulLiftHistogram, {
    3: 92,
    4: 78,
    5: 26,
    6: 4,
  });
  const population: unknown = kit.population.summary;
  assert.ok(
    typeof population === 'object' &&
      population !== null &&
      'count' in population &&
      'fallbackCount' in population
  );
  assert.equal(population.count, 200);
  assert.equal(population.fallbackCount, 3);
  assert.deepEqual(kit.courses[0]?.expectedFinishTicks, {
    hold: 1867,
    cautious: null,
    fast: null,
  });
});

void test('all 25 frozen input tapes reproduce complete authoritative golden states without searching or generating', async () => {
  const kit = await kitPromise;
  const checked = verifyFrozenBalanceReplays(kit.courses);
  assert.equal(checked.replayChecks, 25);
  assert.equal(
    checked.replayTicks,
    kit.courses.reduce(
      (sum, course) =>
        sum +
        course.checks.reduce((ticks, check) => ticks + check.replay.endTick, 0),
      0
    )
  );
  const first = kit.courses[0];
  assert.ok(first);
  assert.throws(
    () =>
      verifyFrozenBalanceReplays([
        {
          ...first,
          checks: first.checks.map((check) => ({ ...check, state: {} })),
        },
      ]),
    /Frozen replay state mismatch/
  );
});

void test('independent handmade controls and established gentle authoring match the frozen full geometry', async () => {
  const kit = await kitPromise;
  assert.equal(
    await hashTrack(authorHandmadeReference()),
    kit.courses.find((course) => course.role === 'handmade')?.trackHash
  );
  assert.equal(
    await hashTrack(createOvalTrack()),
    kit.courses.find((course) => course.role === 'gentle')?.trackHash
  );
});

void test('failed replay verification retains attempted work and stops before any controller search', async () => {
  const kit = await kitPromise,
    gentle = kit.courses[0];
  assert.ok(gentle && gentle.checks.length === 2);
  const broken = {
    ...gentle,
    checks: gentle.checks.map((check, index) =>
      index === 1 ? { ...check, state: {} } : check
    ),
  };
  const report = evaluateBalanceKit({
    courses: [broken],
    population: kit.population,
  });
  assert.equal(report.failures.length, 1);
  assert.equal(report.records.length, 0);
  assert.equal(report.work.controllerRuns, 0);
  assert.equal(report.work.replayChecks, 2);
  assert.equal(
    report.work.replayTicks,
    gentle.checks.reduce((ticks, check) => ticks + check.replay.endTick, 0)
  );
});

void test('a shared search throwing before it can return work is charged its conservative bound', async () => {
  const kit = await kitPromise,
    gentle = kit.courses[0];
  assert.ok(gentle);
  const broken = {
    ...gentle,
    checks: [],
    track: { ...gentle.track, samples: [] },
  };
  const report = evaluateBalanceKit({
    courses: [broken],
    population: kit.population,
  });
  assert.equal(report.failures.length, 1);
  assert.equal(report.work.controllerRuns, MAX_CONTROLLER_RUNS);
  assert.equal(
    report.work.simulatedTicks,
    MAX_CONTROLLER_RUNS * MAX_SIMULATION_TICKS
  );
  assert.match(report.workAccounting, /full bounded budget/);
});

void test('comparison requires successful matching 22 identities and detects every controller exposure metric', async () => {
  const current = comparisonFixture(await kitPromise);
  assert.equal(compareBalanceReports(current, current).unchanged, true);
  const first = current.records[0];
  assert.ok(first);
  const controls: readonly ('hold' | 'cautious' | 'boundedFast')[] = [
    'hold',
    'cautious',
    'boundedFast',
  ];
  const fields: readonly (
    | 'offRoadTicks'
    | 'recoveryTicks'
    | 'recoveryCount'
    | 'lifts'
    | 'meaningfulLifts'
  )[] = [
    'offRoadTicks',
    'recoveryTicks',
    'recoveryCount',
    'lifts',
    'meaningfulLifts',
  ];
  for (const control of controls) {
    for (const field of fields) {
      const previous = {
        ...first[control],
        [field]: field === 'meaningfulLifts' ? 0 : first[control][field] + 1,
      };
      const baseline: BalanceReport = {
        ...current,
        records: [
          { ...first, [control]: previous },
          ...current.records.slice(1),
        ],
      };
      assert.equal(
        compareBalanceReports(current, baseline).unchanged,
        false,
        `${control}/${field}`
      );
    }
  }
  const changed = {
    ...current,
    records: [
      {
        ...first,
        boundedFast: {
          ...first.boundedFast,
          finishTicks: first.boundedFast.elapsedTicks + 120,
          elapsedTicks: first.boundedFast.elapsedTicks + 120,
          seconds: first.boundedFast.elapsedTicks / 120 + 1,
        },
      },
      ...current.records.slice(1),
    ],
  };
  assert.equal(
    compareBalanceReports(current, changed).deltas[0]?.boundedFastTicks,
    -120
  );
  assert.equal(
    compareBalanceReports(current, {
      ...current,
      records: [
        {
          ...first,
          meaningfulIntervals: [{ startTick: 101, endTick: 113, seconds: 0.1 }],
        },
        ...current.records.slice(1),
      ],
    }).unchanged,
    false
  );
  assert.throws(
    () =>
      compareBalanceReports(current, {
        ...current,
        runtime: { ...current.runtime, handlingVersion: 'different' },
      }),
    /runtime mismatch/
  );
  assert.throws(
    () =>
      compareBalanceReports(current, {
        ...current,
        failures: [{ id: 'x', message: 'failure' }],
      }),
    /successful/
  );
  assert.throws(
    () =>
      compareBalanceReports(current, {
        ...current,
        records: current.records.slice(1),
      }),
    /course set/
  );
  assert.throws(
    () =>
      compareBalanceReports(current, {
        ...current,
        records: [first, first, ...current.records.slice(2)],
      }),
    /Duplicate/
  );
  assert.throws(
    () =>
      compareBalanceReports(current, {
        ...current,
        records: [
          { ...first, trackHash: 'wrong' },
          ...current.records.slice(1),
        ],
      }),
    /identity mismatch/
  );
  assert.throws(
    () =>
      compareBalanceReports(current, {
        ...current,
        records: [
          { ...first, hold: { ...first.hold, finished: false } },
          ...current.records.slice(1),
        ],
      }),
    /completed/
  );
  assert.throws(
    () =>
      compareBalanceReports(current, {
        ...current,
        records: [
          { ...first, hold: { ...first.hold, seconds: 999 } },
          ...current.records.slice(1),
        ],
      }),
    /consistent/
  );
});

void test('CLI parses only explicit report/compare paths and refuses overwriting fixture, baseline, existing or linked destinations', async () => {
  assert.deepEqual(parseBalanceOptions([]), {});
  assert.deepEqual(
    parseBalanceOptions(['--report', 'new.json', '--compare', 'old.json']),
    { report: resolve('new.json'), compare: resolve('old.json') }
  );
  for (const args of [
    ['--report'],
    ['--update'],
    ['--report', 'a', '--report', 'b'],
    ['--compare', '--report'],
  ])
    assert.throws(() => parseBalanceOptions(args));
  const temp = await mkdtemp(join(tmpdir(), 'racer-balance-test-'));
  try {
    const report = comparisonFixture(await kitPromise),
      path = join(temp, 'report.json');
    await assertBalanceReportOutput(path);
    await writeBalanceReport(path, report);
    const original = await readFile(path, 'utf8');
    await assert.rejects(writeBalanceReport(path, report), /already exists/);
    assert.equal(await readFile(path, 'utf8'), original);
    await assert.rejects(
      assertBalanceReportOutput(
        join(temp, 'baseline.json'),
        join(temp, 'baseline.json')
      ),
      /baseline/
    );
    await assert.rejects(
      assertBalanceReportOutput(
        join(BALANCE_FIXTURE_DIRECTORY, 'new-report.json')
      ),
      /frozen fixture/
    );
    const link = join(temp, 'fixtures');
    await symlink(BALANCE_FIXTURE_DIRECTORY, link, 'dir');
    await assert.rejects(
      assertBalanceReportOutput(join(link, 'new-report.json')),
      /frozen fixture/
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

void test('loader rejects a runtime change before attempting geometry or bot evaluation', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'racer-balance-manifest-'));
  try {
    await writeFile(
      join(temp, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        runtime: { simulationVersion: 'future' },
      })
    );
    await assert.rejects(loadBalanceKit(temp), /runtime version mismatch/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
