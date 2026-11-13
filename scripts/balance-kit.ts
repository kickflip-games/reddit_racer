import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  MAX_CONTROLLER_RUNS,
  searchDrivingInputs,
  type BotRunSummary,
} from '../src/shared/driving-bots.ts';
import {
  QUALITY_VERSION,
  DEFAULT_QUALITY_THRESHOLDS,
} from '../src/shared/circuit-quality.ts';
import {
  runReplay,
  validateReplay,
  type Replay,
} from '../src/shared/replay.ts';
import {
  HANDLING_VERSION,
  MAX_SIMULATION_TICKS,
  SIMULATION_HZ,
  SIMULATION_VERSION,
} from '../src/shared/simulation.ts';
import { hashTrack, parseTrack, type Track } from '../src/shared/track.ts';

export const BALANCE_FIXTURE_DIRECTORY = fileURLToPath(
  new URL('../tests/fixtures/balance/', import.meta.url)
);
export const BALANCE_SOURCE_REPORT_SHA256 =
  'a4e2b0609e473eeb253640a09fc3de9394384b9eca0d273bc5abd0b5ebeb650a';
export const BALANCE_SELECTED_CSV_SHA256 =
  '89ab5511bcfc593b3667ddc3cdba36be9ac1c02eba79eba13551e057a5802f39';
export type BalanceRole = 'gentle' | 'handmade' | 'generated';
export type BalanceExpectedTicks = {
  hold: number;
  cautious: number | null;
  fast: number | null;
};
export type FrozenReplayCheck = {
  label: string;
  replay: Replay;
  finishTicks: number;
  state: unknown;
};
export type BalanceCourse = {
  id: string;
  role: BalanceRole;
  trackHash: string;
  generatorVersion: string;
  qualityVersion: string | null;
  selectionReasons: string;
  expectedFinishTicks: BalanceExpectedTicks;
  fallbackUsed: boolean;
  track: Track;
  checks: FrozenReplayCheck[];
};
export type BalanceKit = {
  courses: BalanceCourse[];
  population: Record<string, unknown>;
};
export type BalanceWork = {
  controllerRuns: number;
  simulatedTicks: number;
  replayChecks: number;
  replayTicks: number;
};
export type BalanceRecord = {
  id: string;
  role: BalanceRole;
  trackHash: string;
  generatorVersion: string;
  qualityVersion: string | null;
  lengthMetres: number;
  selectionReasons: string;
  fallbackUsed: boolean;
  expectedFinishTicks: BalanceExpectedTicks;
  hold: BotRunSummary;
  cautious: BotRunSummary;
  boundedFast: BotRunSummary;
  gainTicks: number;
  meaningfulIntervals: {
    startTick: number;
    endTick: number;
    seconds: number;
  }[];
  work: BalanceWork;
};
export type BalanceReport = {
  schemaVersion: 1;
  kind: 'frozen-driving-evaluation';
  scope: string;
  runtime: {
    simulationVersion: string;
    handlingVersion: string;
    simulationHz: number;
    qualityVersion: string;
  };
  origin: {
    sourceReportSha256: string;
    selectedCsvSha256: string;
    population: Record<string, unknown>;
  };
  selection: {
    total: number;
    generated: number;
    references: number;
    reserveCoverage: number;
    label: string;
  };
  records: BalanceRecord[];
  failures: { id: string; message: string }[];
  work: BalanceWork;
  workAccounting: string;
  limits: {
    controllerRuns: number;
    replayChecks: number;
    totalTickBudget: number;
  };
};
export type BalanceComparison = {
  unchanged: boolean;
  deltas: {
    id: string;
    holdTicks: number;
    cautiousTicks: number;
    boundedFastTicks: number;
    meaningfulLifts: number;
    offRoadTicks: number;
    recoveryCount: number;
    controls: {
      hold: ControllerDelta;
      cautious: ControllerDelta;
      boundedFast: ControllerDelta;
    };
    gainTicks: number;
    intervalsChanged: boolean;
  }[];
};

type ControllerDelta = {
  finishTicks: number;
  seconds: number;
  elapsedTicks: number;
  offRoadTicks: number;
  recoveryTicks: number;
  recoveryCount: number;
  lifts: number;
  meaningfulLifts: number;
};
const WORK_FIELDS: readonly (keyof BalanceWork)[] = [
  'controllerRuns',
  'simulatedTicks',
  'replayChecks',
  'replayTicks',
];

function object(value: unknown, label: string): Record<string, unknown> {
  if (!isObject(value)) throw new Error(`${label} must be an object`);
  return value;
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length)
    throw new Error(`${label} must be a nonempty string`);
  return value;
}
function integer(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error(`${label} is outside its integer bounds`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
function ticks(value: unknown): number | null {
  return value === null
    ? null
    : integer(value, 'Expected finish ticks', 1, MAX_SIMULATION_TICKS);
}
function expected(value: unknown): BalanceExpectedTicks {
  const row = object(value, 'Expected ticks');
  return {
    hold: integer(row.hold, 'Expected hold ticks', 1, MAX_SIMULATION_TICKS),
    cautious: ticks(row.cautious),
    fast: ticks(row.fast),
  };
}
function runtime() {
  return {
    simulationVersion: SIMULATION_VERSION,
    handlingVersion: HANDLING_VERSION,
    simulationHz: SIMULATION_HZ,
    qualityVersion: QUALITY_VERSION,
  };
}

/** Portable frozen inputs only: never calls a generator, bots, Reddit or Redis. */
export async function loadBalanceKit(
  directory = BALANCE_FIXTURE_DIRECTORY
): Promise<BalanceKit> {
  const manifest = object(
    await json(resolve(directory, 'manifest.json')),
    'Balance manifest'
  );
  if (
    manifest.schemaVersion !== 1 ||
    !isDeepStrictEqual(manifest.runtime, runtime())
  )
    throw new Error('Frozen balance runtime version mismatch');
  const origin = object(manifest.origin, 'Origin');
  if (
    origin.sourceReportSha256 !== BALANCE_SOURCE_REPORT_SHA256 ||
    origin.selectedCsvSha256 !== BALANCE_SELECTED_CSV_SHA256 ||
    origin.generatedSelectionFile !== 'generated-selection.json' ||
    origin.selectedCsvFile !== 'selected-seeds.csv' ||
    origin.populationFile !== 'population.json'
  )
    throw new Error('Frozen balance provenance mismatch');
  if (
    sha256(await readFile(resolve(directory, 'selected-seeds.csv'))) !==
    BALANCE_SELECTED_CSV_SHA256
  )
    throw new Error('Selected CSV digest mismatch');
  const population = object(
    await json(resolve(directory, 'population.json')),
    'Population'
  );
  if (population.sourceReportSha256 !== BALANCE_SOURCE_REPORT_SHA256)
    throw new Error('Population origin mismatch');
  const selection = object(
    await json(resolve(directory, 'generated-selection.json')),
    'Generated selection'
  );
  if (
    selection.sourceReportSha256 !== BALANCE_SOURCE_REPORT_SHA256 ||
    selection.selectedCsvSha256 !== BALANCE_SELECTED_CSV_SHA256 ||
    selection.expectedCourseCount !== 20
  )
    throw new Error('Generated selection provenance mismatch');
  const originals = new Map<string, Record<string, unknown>>();
  for (const value of array(selection.entries, 'Generated entries')) {
    const entry = object(value, 'Generated entry');
    const id = text(entry.requestedSeed, 'Requested seed');
    if (originals.has(id)) throw new Error('Duplicate generated selection ID');
    originals.set(id, entry);
  }
  if (originals.size !== 20)
    throw new Error('Expected twenty original selected courses');
  const entries = array(manifest.entries, 'Balance entries');
  if (entries.length !== 22)
    throw new Error('Expected exactly twenty-two frozen courses');
  const ids = new Set<string>(),
    hashes = new Set<string>();
  const courses: BalanceCourse[] = [];
  for (const value of entries) {
    const entry = object(value, 'Balance entry');
    const id = text(entry.id, 'Course ID');
    if (
      !/^(gentle-reference|handmade-reference|regression-[0-9]+)$/.test(id) ||
      ids.has(id)
    )
      throw new Error('Invalid or duplicate balance course ID');
    ids.add(id);
    const role = entry.role;
    if (role !== 'gentle' && role !== 'handmade' && role !== 'generated')
      throw new Error('Unknown balance course role');
    if (
      entry.trackFile !== `courses/${id}.track.json` ||
      entry.replayFile !== `replays/${id}.json`
    )
      throw new Error('Frozen fixture path mismatch');
    const track = parseTrack(
      await json(resolve(directory, `courses/${id}.track.json`))
    );
    const trackHash = await hashTrack(track);
    if (entry.trackHash !== trackHash || hashes.has(trackHash))
      throw new Error(`Frozen geometry identity mismatch: ${id}`);
    hashes.add(trackHash);
    if (entry.generatorVersion !== track.generatorVersion)
      throw new Error(`Generator provenance mismatch: ${id}`);
    const expectedFinishTicks = expected(entry.expectedFinishTicks);
    let fallbackUsed = false;
    if (role === 'generated') {
      const original = originals.get(id);
      if (
        !original ||
        original.expectedTrackHash !== trackHash ||
        typeof original.expectedCandidateSeed !== 'string' ||
        !/:attempt:[1-9][0-9]*$/.test(original.expectedCandidateSeed) ||
        original.expectedCandidateSeed.replace(/:attempt:[0-9]+$/, '') !==
          track.seed ||
        original.expectedGeneratorVersion !== entry.generatorVersion ||
        original.expectedQualityVersion !== entry.qualityVersion ||
        original.expectedSimulationVersion !== SIMULATION_VERSION ||
        original.expectedHandlingVersion !== HANDLING_VERSION ||
        !isDeepStrictEqual(original.expectedFinishTicks, expectedFinishTicks) ||
        original.selectionReasons !== entry.selectionReasons ||
        !isDeepStrictEqual(
          original.expectedQualityThresholds,
          DEFAULT_QUALITY_THRESHOLDS
        ) ||
        typeof original.expectedFallback !== 'boolean'
      )
        throw new Error(`Original generated expectation mismatch: ${id}`);
      fallbackUsed = original.expectedFallback;
    } else if (role === 'gentle') {
      if (
        id !== 'gentle-reference' ||
        trackHash !==
          '4a17865c1bbb3e3ff830795dc2ba12d434ac98b1bedc9d731e777e5f268d9109' ||
        !isDeepStrictEqual(expectedFinishTicks, {
          hold: 1867,
          cautious: null,
          fast: null,
        }) ||
        entry.qualityVersion !== null
      )
        throw new Error('Gentle control expectation mismatch');
    } else if (
      id !== 'handmade-reference' ||
      trackHash !==
        '90c4b77426a957e6f5c7ed9e296a125f177b3ab20d616e357ddb726eb7df2f4c' ||
      !isDeepStrictEqual(expectedFinishTicks, {
        hold: 3996,
        cautious: 4453,
        fast: 3326,
      }) ||
      entry.qualityVersion !== QUALITY_VERSION
    )
      throw new Error('Handmade reference expectation mismatch');
    const replayFile = object(
      await json(resolve(directory, `replays/${id}.json`)),
      'Replay fixture'
    );
    const checks = array(replayFile.checks, 'Replay checks').map(
      (value): FrozenReplayCheck => {
        const row = object(value, 'Replay check');
        const label = text(row.label, 'Replay label');
        const replay = validateReplay(row.replay);
        const finishTicks = integer(
          row.finishTicks,
          'Frozen finish ticks',
          1,
          MAX_SIMULATION_TICKS
        );
        if (replay.endTick !== finishTicks)
          throw new Error(`Frozen replay endpoint mismatch: ${id}`);
        const pinned =
          label === 'hold'
            ? expectedFinishTicks.hold
            : label === 'cautious'
              ? expectedFinishTicks.cautious
              : label === 'fast'
                ? expectedFinishTicks.fast
                : id === 'gentle-reference' && label === 'deliberate-lift'
                  ? 1590
                  : null;
        if (pinned === null || pinned !== finishTicks)
          throw new Error(`Frozen replay expectation mismatch: ${id}`);
        return { label, replay, finishTicks, state: row.state };
      }
    );
    const labels = checks
      .map((check) => check.label)
      .sort()
      .join(',');
    if (
      labels !==
      (role === 'generated'
        ? 'fast'
        : role === 'handmade'
          ? 'cautious,fast,hold'
          : 'deliberate-lift,hold')
    )
      throw new Error(`Missing or duplicate frozen replay checks: ${id}`);
    courses.push({
      id,
      role,
      trackHash,
      generatorVersion: track.generatorVersion,
      qualityVersion:
        entry.qualityVersion === null
          ? null
          : text(entry.qualityVersion, 'Quality version'),
      selectionReasons: text(entry.selectionReasons, 'Selection reasons'),
      expectedFinishTicks,
      fallbackUsed,
      track,
      checks,
    });
  }
  if (
    courses.filter((course) => course.role === 'generated').length !== 20 ||
    courses.filter((course) => course.role === 'gentle').length !== 1 ||
    courses.filter((course) => course.role === 'handmade').length !== 1
  )
    throw new Error('Frozen role counts mismatch');
  return { courses, population };
}

function verifyRecordedCourse(course: BalanceCourse, work: BalanceWork): void {
  for (const check of course.checks) {
    // Charge the requested replay ticks before execution. A thrown replay cannot
    // erase already-spent work; its endpoint remains a conservative upper bound.
    work.replayChecks++;
    work.replayTicks += check.replay.endTick;
    const verified = runReplay(course.track, check.replay);
    if (
      verified.finishTicks !== check.finishTicks ||
      !isDeepStrictEqual(verified.state, check.state)
    )
      throw new Error(
        `Frozen replay state mismatch: ${course.id}/${check.label}`
      );
  }
}
export function verifyFrozenBalanceReplays(courses: readonly BalanceCourse[]): {
  replayChecks: number;
  replayTicks: number;
} {
  const work = emptyWork();
  for (const course of courses) verifyRecordedCourse(course, work);
  return { replayChecks: work.replayChecks, replayTicks: work.replayTicks };
}
function emptyWork(): BalanceWork {
  return {
    controllerRuns: 0,
    simulatedTicks: 0,
    replayChecks: 0,
    replayTicks: 0,
  };
}
function intervals(replay: Replay): BalanceRecord['meaningfulIntervals'] {
  const result: BalanceRecord['meaningfulIntervals'] = [];
  for (let index = 0; index < replay.transitions.length; index++) {
    const event = replay.transitions[index];
    if (!event || event.held) continue;
    const endTick = replay.transitions[index + 1]?.tick ?? replay.endTick;
    if (endTick - event.tick >= DEFAULT_QUALITY_THRESHOLDS.minLiftTicks)
      result.push({
        startTick: event.tick,
        endTick,
        seconds: (endTick - event.tick) / SIMULATION_HZ,
      });
  }
  return result;
}

/** Explicit 22-course work, excluded from npm check and unit-test startup. */
export function evaluateBalanceKit(kit: BalanceKit): BalanceReport {
  const report: BalanceReport = {
    schemaVersion: 1,
    kind: 'frozen-driving-evaluation',
    scope:
      'Shared standing-start automated controls on frozen geometry; bounded fast is not a global optimum, human learning or player standings. Gentle control is intentionally outside daily quality targets.',
    runtime: runtime(),
    origin: {
      sourceReportSha256: BALANCE_SOURCE_REPORT_SHA256,
      selectedCsvSha256: BALANCE_SELECTED_CSV_SHA256,
      population: kit.population,
    },
    selection: {
      total: kit.courses.length,
      generated: kit.courses.filter((course) => course.role === 'generated')
        .length,
      references: kit.courses.filter((course) => course.role !== 'generated')
        .length,
      reserveCoverage: kit.courses.filter((course) => course.fallbackUsed)
        .length,
      label:
        'Selected diagnostic/extreme subset; reserve coverage is not a population fallback-rate estimate.',
    },
    records: [],
    failures: [],
    work: emptyWork(),
    workAccounting:
      'Completed controller work is measured; replay attempts charge their requested endpoint. A shared search that throws before returning is charged its full bounded budget.',
    limits: {
      controllerRuns: kit.courses.length * MAX_CONTROLLER_RUNS,
      replayChecks: kit.courses.reduce(
        (sum, course) => sum + course.checks.length + 3,
        0
      ),
      totalTickBudget: 0,
    },
  };
  report.limits.totalTickBudget =
    (report.limits.controllerRuns + report.limits.replayChecks) *
    MAX_SIMULATION_TICKS;
  for (const course of kit.courses) {
    const work = emptyWork();
    try {
      verifyRecordedCourse(course, work);
      let search;
      try {
        search = searchDrivingInputs(
          course.track,
          DEFAULT_QUALITY_THRESHOLDS.minLiftTicks
        );
      } catch (error) {
        // Shared search has no partial-work callback. Charge its complete upper
        // bound on failure rather than report an unmeasurable partial run as zero.
        work.controllerRuns += MAX_CONTROLLER_RUNS;
        work.simulatedTicks += MAX_CONTROLLER_RUNS * MAX_SIMULATION_TICKS;
        throw error;
      }
      work.controllerRuns += search.work.controllerRuns;
      work.simulatedTicks += search.work.simulatedTicks;
      if (work.controllerRuns > MAX_CONTROLLER_RUNS)
        throw new Error('Controller work budget exceeded');
      const controls = [
        {
          name: 'hold',
          run: search.hold,
          pinned: course.expectedFinishTicks.hold,
        },
        {
          name: 'cautious',
          run: search.cautious,
          pinned: course.expectedFinishTicks.cautious,
        },
        {
          name: 'bounded-fast',
          run: search.fast,
          pinned: course.expectedFinishTicks.fast,
        },
      ];
      for (const { name, run, pinned } of controls) {
        if (!run.summary.finished || run.summary.finishTicks === null)
          throw new Error(`${name} did not finish`);
        work.replayChecks++;
        work.replayTicks += run.replay.endTick;
        const verified = runReplay(course.track, run.replay);
        if (verified.finishTicks !== run.summary.finishTicks)
          throw new Error(`${name} replay mismatch`);
        if (pinned !== null && verified.finishTicks !== pinned)
          report.failures.push({
            id: course.id,
            message: `${name} expected ${pinned} ticks, received ${verified.finishTicks}; frozen expectation was not changed`,
          });
      }
      const holdTicks = search.hold.summary.finishTicks,
        fastTicks = search.fast.summary.finishTicks;
      if (holdTicks === null || fastTicks === null)
        throw new Error('Missing finished controller score');
      report.records.push({
        id: course.id,
        role: course.role,
        trackHash: course.trackHash,
        generatorVersion: course.generatorVersion,
        qualityVersion: course.qualityVersion,
        lengthMetres: course.track.totalLength,
        selectionReasons: course.selectionReasons,
        fallbackUsed: course.fallbackUsed,
        expectedFinishTicks: course.expectedFinishTicks,
        hold: search.hold.summary,
        cautious: search.cautious.summary,
        boundedFast: search.fast.summary,
        gainTicks: holdTicks - fastTicks,
        meaningfulIntervals: intervals(search.fast.replay),
        work,
      });
    } catch (error) {
      report.failures.push({
        id: course.id,
        message: error instanceof Error ? error.message : 'Evaluation failed',
      });
    } finally {
      for (const field of WORK_FIELDS) report.work[field] += work[field];
    }
  }
  if (
    report.work.controllerRuns > report.limits.controllerRuns ||
    report.work.replayChecks > report.limits.replayChecks ||
    report.work.simulatedTicks + report.work.replayTicks >
      report.limits.totalTickBudget
  )
    throw new Error('Evaluation work budget exceeded');
  return report;
}

function summary(value: unknown): BotRunSummary {
  const row = object(value, 'Controller summary');
  const finishTicks = ticks(row.finishTicks);
  if (
    row.finished !== true ||
    finishTicks === null ||
    row.seconds !== finishTicks / SIMULATION_HZ ||
    row.elapsedTicks !== finishTicks
  )
    throw new Error('Comparison requires completed consistent controls');
  return {
    finished: true,
    finishTicks,
    seconds: finishTicks / SIMULATION_HZ,
    elapsedTicks: finishTicks,
    offRoadTicks: integer(row.offRoadTicks, 'Off-road ticks', 0, finishTicks),
    recoveryTicks: integer(row.recoveryTicks, 'Recovery ticks', 0, finishTicks),
    recoveryCount: integer(row.recoveryCount, 'Recoveries', 0, finishTicks),
    lifts: integer(row.lifts, 'Lifts', 0, finishTicks),
    meaningfulLifts: integer(
      row.meaningfulLifts,
      'Meaningful lifts',
      0,
      integer(row.lifts, 'Lifts', 0, finishTicks)
    ),
  };
}
function controllerDelta(
  currentValue: unknown,
  previousValue: unknown
): ControllerDelta {
  const current = summary(currentValue),
    previous = summary(previousValue);
  // summary requires non-null completed values; these checks also narrow the type.
  if (
    current.finishTicks === null ||
    previous.finishTicks === null ||
    current.seconds === null ||
    previous.seconds === null
  )
    throw new Error('Comparison requires completed controls');
  return {
    finishTicks: current.finishTicks - previous.finishTicks,
    seconds: current.seconds - previous.seconds,
    elapsedTicks: current.elapsedTicks - previous.elapsedTicks,
    offRoadTicks: current.offRoadTicks - previous.offRoadTicks,
    recoveryTicks: current.recoveryTicks - previous.recoveryTicks,
    recoveryCount: current.recoveryCount - previous.recoveryCount,
    lifts: current.lifts - previous.lifts,
    meaningfulLifts: current.meaningfulLifts - previous.meaningfulLifts,
  };
}
function replayIntervals(value: unknown): BalanceRecord['meaningfulIntervals'] {
  return array(value, 'Meaningful intervals').map((value) => {
    const row = object(value, 'Meaningful interval');
    const startTick = integer(
      row.startTick,
      'Interval start',
      0,
      MAX_SIMULATION_TICKS
    );
    const endTick = integer(
      row.endTick,
      'Interval end',
      startTick + DEFAULT_QUALITY_THRESHOLDS.minLiftTicks,
      MAX_SIMULATION_TICKS
    );
    if (row.seconds !== (endTick - startTick) / SIMULATION_HZ)
      throw new Error('Inconsistent comparison interval');
    return {
      startTick,
      endTick,
      seconds: (endTick - startTick) / SIMULATION_HZ,
    };
  });
}
export function compareBalanceReports(
  current: BalanceReport,
  baselineValue: unknown
): BalanceComparison {
  const baseline = object(baselineValue, 'Comparison report');
  if (
    baseline.schemaVersion !== 1 ||
    baseline.kind !== 'frozen-driving-evaluation' ||
    !isDeepStrictEqual(baseline.runtime, current.runtime)
  )
    throw new Error('Comparison report/runtime mismatch');
  if (
    array(baseline.failures, 'Comparison failures').length ||
    current.failures.length
  )
    throw new Error('Comparison requires complete successful reports');
  const records = new Map<string, Record<string, unknown>>();
  for (const value of array(baseline.records, 'Comparison records')) {
    const row = object(value, 'Comparison record'),
      id = text(row.id, 'Comparison ID');
    if (records.has(id)) throw new Error('Duplicate comparison course ID');
    records.set(id, row);
  }
  if (
    records.size !== current.records.length ||
    current.records.length !== 22 ||
    new Set(current.records.map((row) => row.id)).size !== 22
  )
    throw new Error(
      'Comparison requires the same complete twenty-two course set'
    );
  let unchanged = true;
  const deltas = current.records.map((record) => {
    const previous = records.get(record.id);
    if (
      !previous ||
      previous.trackHash !== record.trackHash ||
      previous.role !== record.role ||
      previous.generatorVersion !== record.generatorVersion ||
      previous.qualityVersion !== record.qualityVersion ||
      previous.lengthMetres !== record.lengthMetres ||
      previous.fallbackUsed !== record.fallbackUsed
    )
      throw new Error(`Comparison frozen identity mismatch: ${record.id}`);
    const controls = {
      hold: controllerDelta(record.hold, previous.hold),
      cautious: controllerDelta(record.cautious, previous.cautious),
      boundedFast: controllerDelta(record.boundedFast, previous.boundedFast),
    };
    const gainTicks =
      record.gainTicks -
      integer(
        previous.gainTicks,
        'Gain ticks',
        -MAX_SIMULATION_TICKS,
        MAX_SIMULATION_TICKS
      );
    const intervalsChanged = !isDeepStrictEqual(
      record.meaningfulIntervals,
      replayIntervals(previous.meaningfulIntervals)
    );
    if (
      gainTicks !== 0 ||
      intervalsChanged ||
      Object.values(controls).some((delta) =>
        Object.values(delta).some((value) => value !== 0)
      )
    )
      unchanged = false;
    return {
      id: record.id,
      holdTicks: controls.hold.finishTicks,
      cautiousTicks: controls.cautious.finishTicks,
      boundedFastTicks: controls.boundedFast.finishTicks,
      meaningfulLifts: controls.boundedFast.meaningfulLifts,
      offRoadTicks: controls.boundedFast.offRoadTicks,
      recoveryCount: controls.boundedFast.recoveryCount,
      controls,
      gainTicks,
      intervalsChanged,
    };
  });
  return { unchanged, deltas };
}

export function parseBalanceOptions(args: string[]): {
  report?: string;
  compare?: string;
} {
  const options: { report?: string; compare?: string } = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index],
      value = args[index + 1];
    if (
      (flag !== '--report' && flag !== '--compare') ||
      !value ||
      value.startsWith('--')
    )
      throw new Error(
        'Use --report new.json and optional --compare previous.json'
      );
    if (flag === '--report') {
      if (options.report) throw new Error('Duplicate --report');
      options.report = resolve(value);
    } else {
      if (options.compare) throw new Error('Duplicate --compare');
      options.compare = resolve(value);
    }
  }
  return options;
}
function inside(parent: string, path: string): boolean {
  const part = relative(parent, path);
  return (
    part === '' ||
    (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
  );
}
/** Validate before bot work; exclusive write below still prevents later races. */
export async function assertBalanceReportOutput(
  path: string,
  comparePath?: string
): Promise<void> {
  const target = resolve(path),
    fixtureRoot = await realpath(BALANCE_FIXTURE_DIRECTORY);
  const parent = await realpath(dirname(target));
  if (
    inside(fixtureRoot, target) ||
    inside(fixtureRoot, parent) ||
    (comparePath && target === resolve(comparePath))
  )
    throw new Error(
      'Report cannot overwrite a frozen fixture or comparison baseline'
    );
  try {
    await lstat(target);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return;
    throw error;
  }
  throw new Error('Report output already exists; choose a new path');
}
export async function writeBalanceReport(
  path: string,
  report: BalanceReport,
  comparison?: BalanceComparison,
  comparePath?: string
): Promise<void> {
  await assertBalanceReportOutput(path, comparePath);
  await writeFile(
    resolve(path),
    JSON.stringify(
      { ...report, ...(comparison ? { comparison } : {}) },
      null,
      2
    ) + '\n',
    { flag: 'wx' }
  );
}
