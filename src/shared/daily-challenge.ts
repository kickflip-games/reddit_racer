import { runtimeForTrack, scoredRuntime } from './scored-runtime.ts';
import { hashTrack, parseTrack, serializeTrack } from './track.ts';
import type { Track } from './track.ts';
import type { ValidatedCircuit } from './circuit-quality.ts';

export type DailyChallengeErrorKind =
  'invalid' | 'integrity' | 'unsupported' | 'unavailable' | 'not-found';
export class DailyChallengeError extends Error {
  constructor(
    public readonly kind: DailyChallengeErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'DailyChallengeError';
  }
}
export const DAY_MILLISECONDS = 86_400_000;
export const RANKED_SESSION_MAX_AGE = 5 * 60_000;
export const RANKED_ROLLOVER_GRACE = 3 * 60_000;
export type ChallengeInitialConditions = {
  tick: 0;
  distance: 0;
  speed: 0;
  lateralOffset: 0;
  lateralVelocity: 0;
  checkpointIndex: 0;
  acceleratorHeld: false;
};
export type DailyChallenge = {
  schemaVersion: 1;
  id: string;
  subredditId: string;
  day: string;
  startsAtMs: number;
  endsAtMs: number;
  track: Track;
  trackHash: string;
  challengeHash: string;
  generatorVersion: string;
  qualityVersion: string;
  simulationVersion: string;
  handlingVersion: string;
  simulationHz: 120;
  initialConditions: ChallengeInitialConditions;
};
export type DailyChallengeView = {
  challenge: DailyChallenge;
  serverNowMs: number;
  currentDay: string;
  nextResetAtMs: number;
  isCurrent: boolean;
  rankedWindowOpen: boolean;
};
export type DailyChallengeAudit = {
  generatorFallback: boolean;
  structuralFallback: boolean;
  generationAttempts: number;
  qualityAttempts: number;
  generationRejectCodes: string[];
  qualityRejectCodes: string[];
  holdFinishTicks: number;
  cautiousFinishTicks: number;
  fastFinishTicks: number;
  meaningfulLifts: number;
  gainTicks: number;
  fastOffRoadTicks: number;
  fastRecoveryTicks: number;
  controllerRuns: number;
  simulatedTicks: number;
  replayChecks: number;
};
export type DailyChallengeRecord = DailyChallenge & {
  createdAtMs: number;
  requestedSeed: string;
  generatorConfig: Record<string, number>;
  qualityThresholds: Record<string, number>;
  audit: DailyChallengeAudit;
};
export type DailyChallengeCreation = {
  subredditId: string;
  day: string;
  createdAtMs: number;
  requestedSeed: string;
  generated: ValidatedCircuit;
  generatorFallback?: boolean;
};

const publicKeys = [
  'schemaVersion',
  'id',
  'subredditId',
  'day',
  'startsAtMs',
  'endsAtMs',
  'track',
  'trackHash',
  'challengeHash',
  'generatorVersion',
  'qualityVersion',
  'simulationVersion',
  'handlingVersion',
  'simulationHz',
  'initialConditions',
];
const privateKeys = [
  'createdAtMs',
  'requestedSeed',
  'generatorConfig',
  'qualityThresholds',
  'audit',
];
const initialKeys = [
  'tick',
  'distance',
  'speed',
  'lateralOffset',
  'lateralVelocity',
  'checkpointIndex',
  'acceleratorHeld',
];
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, keys: string[]): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new DailyChallengeError(
      'integrity',
      'Challenge fields are missing or unsupported'
    );
}
function text(value: unknown, name: string, maximum = 128): string {
  if (typeof value !== 'string' || !value.length || value.length > maximum)
    throw new DailyChallengeError('integrity', `${name} is invalid`);
  return value;
}
function integer(value: unknown, name: string, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  )
    throw new DailyChallengeError('integrity', `${name} is invalid`);
  return value;
}
function timestamp(value: unknown, name: string): number {
  const ms = integer(value, name);
  if (!Number.isFinite(new Date(ms).getTime()))
    throw new DailyChallengeError(
      'integrity',
      `${name} is outside the supported calendar`
    );
  return ms;
}
function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean')
    throw new DailyChallengeError('integrity', `${name} is invalid`);
  return value;
}
export function validateSubredditId(value: string): void {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^t5_[a-z0-9]+$/.test(value)
  )
    throw new DailyChallengeError(
      'invalid',
      'A trusted subreddit ID is required'
    );
}
export function utcDay(nowMs: number): string {
  return new Date(timestamp(nowMs, 'Clock')).toISOString().slice(0, 10);
}
export function utcDayWindow(day: string): {
  startsAtMs: number;
  endsAtMs: number;
} {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new DailyChallengeError('invalid', 'UTC day must use YYYY-MM-DD');
  const startsAtMs = Date.parse(`${day}T00:00:00.000Z`);
  if (
    !Number.isFinite(startsAtMs) ||
    startsAtMs < 0 ||
    new Date(startsAtMs).toISOString().slice(0, 10) !== day
  )
    throw new DailyChallengeError('invalid', 'UTC calendar day is invalid');
  return { startsAtMs, endsAtMs: startsAtMs + DAY_MILLISECONDS };
}
export function dailyChallengeId(subredditId: string, day: string): string {
  validateSubredditId(subredditId);
  utcDayWindow(day);
  return `${subredditId}:${day}`;
}
function initialConditions(): ChallengeInitialConditions {
  return {
    tick: 0,
    distance: 0,
    speed: 0,
    lateralOffset: 0,
    lateralVelocity: 0,
    checkpointIndex: 0,
    acceleratorHeld: false,
  };
}
function parseInitial(value: unknown): ChallengeInitialConditions {
  if (!record(value))
    throw new DailyChallengeError(
      'integrity',
      'Initial conditions are invalid'
    );
  fields(value, initialKeys);
  if (
    initialKeys.some(
      (key) => value[key] !== (key === 'acceleratorHeld' ? false : 0)
    )
  )
    throw new DailyChallengeError(
      'unsupported',
      'Challenge starting conditions are unsupported'
    );
  return initialConditions();
}
/** Scored-runtime compatibility; future handling must retain this implementation tuple. */
export function assertSupportedScoredRuntime(
  simulationVersion: string,
  handlingVersion: string,
  simulationHz: number
): void {
  // Keep both complete implementations available; version strings alone never retune old days.
  try {
    scoredRuntime(simulationVersion, handlingVersion, simulationHz);
  } catch {
    throw new DailyChallengeError(
      'unsupported',
      'Challenge simulation or handling version is unsupported'
    );
  }
}
function numericMap(value: unknown, name: string): Record<string, number> {
  if (
    !record(value) ||
    Object.keys(value).length > 64 ||
    !Object.keys(value).length
  )
    throw new DailyChallengeError('integrity', `${name} is invalid`);
  const entries: [string, number][] = [];
  for (const key of Object.keys(value).sort()) {
    const number = value[key];
    if (
      !key.length ||
      key.length > 64 ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      typeof number !== 'number' ||
      !Number.isFinite(number)
    )
      throw new DailyChallengeError(
        'integrity',
        `${name} contains an invalid value`
      );
    entries.push([key, number]);
  }
  return Object.fromEntries(entries);
}
function codes(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 256)
    throw new DailyChallengeError('integrity', `${name} is invalid`);
  return value.map((code: unknown) => text(code, name));
}
function parseAudit(value: unknown): DailyChallengeAudit {
  if (!record(value))
    throw new DailyChallengeError('integrity', 'Challenge audit is invalid');
  const audit: DailyChallengeAudit = {
    generatorFallback: boolean(value.generatorFallback, 'generatorFallback'),
    structuralFallback: boolean(value.structuralFallback, 'structuralFallback'),
    generationAttempts: integer(value.generationAttempts, 'generationAttempts'),
    qualityAttempts: integer(value.qualityAttempts, 'qualityAttempts'),
    generationRejectCodes: codes(
      value.generationRejectCodes,
      'generationRejectCodes'
    ),
    qualityRejectCodes: codes(value.qualityRejectCodes, 'qualityRejectCodes'),
    holdFinishTicks: integer(value.holdFinishTicks, 'holdFinishTicks', 1),
    cautiousFinishTicks: integer(
      value.cautiousFinishTicks,
      'cautiousFinishTicks',
      1
    ),
    fastFinishTicks: integer(value.fastFinishTicks, 'fastFinishTicks', 1),
    meaningfulLifts: integer(value.meaningfulLifts, 'meaningfulLifts'),
    gainTicks: integer(value.gainTicks, 'gainTicks'),
    fastOffRoadTicks: integer(value.fastOffRoadTicks, 'fastOffRoadTicks'),
    fastRecoveryTicks: integer(value.fastRecoveryTicks, 'fastRecoveryTicks'),
    controllerRuns: integer(value.controllerRuns, 'controllerRuns'),
    simulatedTicks: integer(value.simulatedTicks, 'simulatedTicks'),
    replayChecks: integer(value.replayChecks, 'replayChecks'),
  };
  fields(value, Object.keys(audit));
  return audit;
}
function hashText(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    throw new DailyChallengeError('integrity', `${name} is invalid`);
  return value;
}
async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new DailyChallengeError(
      'unavailable',
      'Challenge verification requires Web Crypto'
    );
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

/** Hash all public immutable race fields; trackHash binds the complete canonical road. */
export function hashDailyChallenge(
  challenge: Omit<DailyChallenge, 'challengeHash'>
): Promise<string> {
  return sha256(
    JSON.stringify({
      schemaVersion: challenge.schemaVersion,
      id: challenge.id,
      subredditId: challenge.subredditId,
      day: challenge.day,
      startsAtMs: challenge.startsAtMs,
      endsAtMs: challenge.endsAtMs,
      trackHash: challenge.trackHash,
      generatorVersion: challenge.generatorVersion,
      qualityVersion: challenge.qualityVersion,
      simulationVersion: challenge.simulationVersion,
      handlingVersion: challenge.handlingVersion,
      simulationHz: challenge.simulationHz,
      initialConditions: {
        tick: challenge.initialConditions.tick,
        distance: challenge.initialConditions.distance,
        speed: challenge.initialConditions.speed,
        lateralOffset: challenge.initialConditions.lateralOffset,
        lateralVelocity: challenge.initialConditions.lateralVelocity,
        checkpointIndex: challenge.initialConditions.checkpointIndex,
        acceleratorHeld: challenge.initialConditions.acceleratorHeld,
      },
    })
  );
}
async function parseChallengeFields(
  value: Record<string, unknown>
): Promise<DailyChallenge> {
  if (value.schemaVersion !== 1)
    throw new DailyChallengeError(
      'unsupported',
      'Challenge schema version is unsupported'
    );
  const subredditId = text(value.subredditId, 'subredditId', 40),
    day = text(value.day, 'day', 10);
  let window: { startsAtMs: number; endsAtMs: number };
  try {
    validateSubredditId(subredditId);
    window = utcDayWindow(day);
  } catch {
    throw new DailyChallengeError(
      'integrity',
      'Stored challenge identity or UTC day is invalid'
    );
  }
  const id = text(value.id, 'id');
  if (
    id !== dailyChallengeId(subredditId, day) ||
    value.startsAtMs !== window.startsAtMs ||
    value.endsAtMs !== window.endsAtMs
  )
    throw new DailyChallengeError(
      'integrity',
      'Challenge identity or UTC window does not match'
    );
  const simulationVersion = text(value.simulationVersion, 'simulationVersion'),
    handlingVersion = text(value.handlingVersion, 'handlingVersion');
  const simulationHz = integer(value.simulationHz, 'simulationHz', 1);
  assertSupportedScoredRuntime(
    simulationVersion,
    handlingVersion,
    simulationHz
  );
  if (simulationHz !== 120)
    throw new DailyChallengeError(
      'unsupported',
      'Challenge tick frequency is unsupported'
    );
  if (
    record(value.track) &&
    value.track.schemaVersion !== 1 &&
    value.track.schemaVersion !== 2
  )
    throw new DailyChallengeError(
      'unsupported',
      'Track schema version is unsupported'
    );
  let track: Track;
  try {
    track = parseTrack(value.track);
  } catch {
    throw new DailyChallengeError(
      'integrity',
      'Stored canonical track is malformed'
    );
  }
  const expectedRuntime = runtimeForTrack(track);
  if (
    simulationVersion !== expectedRuntime.simulationVersion ||
    handlingVersion !== expectedRuntime.handlingVersion
  )
    throw new DailyChallengeError(
      'integrity',
      'Track and scored rules do not match'
    );
  const trackHash = hashText(value.trackHash, 'trackHash');
  let actualTrackHash: string;
  try {
    actualTrackHash = await hashTrack(track);
  } catch (error) {
    if (error instanceof DailyChallengeError) throw error;
    throw new DailyChallengeError(
      'unavailable',
      'Canonical track hash could not be verified'
    );
  }
  if (actualTrackHash !== trackHash)
    throw new DailyChallengeError(
      'integrity',
      'Stored track hash does not match geometry'
    );
  const generatorVersion = text(value.generatorVersion, 'generatorVersion'),
    qualityVersion = text(value.qualityVersion, 'qualityVersion');
  if (generatorVersion !== track.generatorVersion)
    throw new DailyChallengeError(
      'integrity',
      'Generator provenance does not match the stored track'
    );
  const challenge: DailyChallenge = {
    schemaVersion: 1,
    id,
    subredditId,
    day,
    ...window,
    track,
    trackHash,
    challengeHash: hashText(value.challengeHash, 'challengeHash'),
    generatorVersion,
    qualityVersion,
    simulationVersion,
    handlingVersion,
    simulationHz,
    initialConditions: parseInitial(value.initialConditions),
  };
  if ((await hashDailyChallenge(challenge)) !== challenge.challengeHash)
    throw new DailyChallengeError(
      'integrity',
      'Stored challenge hash does not match race conditions'
    );
  return challenge;
}
export async function parseDailyChallenge(
  value: unknown
): Promise<DailyChallenge> {
  if (!record(value))
    throw new DailyChallengeError('integrity', 'Challenge must be an object');
  if (value.schemaVersion !== 1)
    throw new DailyChallengeError(
      'unsupported',
      'Challenge schema version is unsupported'
    );
  fields(value, publicKeys);
  return parseChallengeFields(value);
}
export async function parseDailyChallengeRecord(
  value: unknown
): Promise<DailyChallengeRecord> {
  if (!record(value))
    throw new DailyChallengeError(
      'integrity',
      'Challenge record must be an object'
    );
  if (value.schemaVersion !== 1)
    throw new DailyChallengeError(
      'unsupported',
      'Challenge schema version is unsupported'
    );
  fields(value, [...publicKeys, ...privateKeys]);
  return {
    ...(await parseChallengeFields(value)),
    createdAtMs: timestamp(value.createdAtMs, 'createdAtMs'),
    requestedSeed: text(value.requestedSeed, 'requestedSeed', 96),
    generatorConfig: numericMap(value.generatorConfig, 'generatorConfig'),
    qualityThresholds: numericMap(value.qualityThresholds, 'qualityThresholds'),
    audit: parseAudit(value.audit),
  };
}
/** Explicit projection prevents private audit/config/solver data reaching a public response. */
export function toPublicDailyChallenge(
  value: DailyChallengeRecord
): DailyChallenge {
  return {
    schemaVersion: value.schemaVersion,
    id: value.id,
    subredditId: value.subredditId,
    day: value.day,
    startsAtMs: value.startsAtMs,
    endsAtMs: value.endsAtMs,
    track: value.track,
    trackHash: value.trackHash,
    challengeHash: value.challengeHash,
    generatorVersion: value.generatorVersion,
    qualityVersion: value.qualityVersion,
    simulationVersion: value.simulationVersion,
    handlingVersion: value.handlingVersion,
    simulationHz: value.simulationHz,
    initialConditions: { ...value.initialConditions },
  };
}
export function serializeDailyChallengeRecord(
  value: DailyChallengeRecord
): string {
  return JSON.stringify({
    ...toPublicDailyChallenge(value),
    track: JSON.parse(serializeTrack(value.track)),
    createdAtMs: value.createdAtMs,
    requestedSeed: value.requestedSeed,
    generatorConfig: numericMap(value.generatorConfig, 'generatorConfig'),
    qualityThresholds: numericMap(value.qualityThresholds, 'qualityThresholds'),
    audit: value.audit,
  });
}

export async function createDailyChallengeRecord(
  input: DailyChallengeCreation
): Promise<DailyChallengeRecord> {
  validateSubredditId(input.subredditId);
  const window = utcDayWindow(input.day),
    generated = input.generated;
  if (
    !generated.quality.valid ||
    generated.quality.codes.length ||
    generated.diagnostics.version !== generated.track.generatorVersion
  )
    throw new DailyChallengeError(
      'integrity',
      'Generated course lacks matching complete quality approval'
    );
  let track: Track;
  try {
    track = parseTrack(generated.track);
  } catch {
    throw new DailyChallengeError(
      'integrity',
      'Approved course geometry is malformed'
    );
  }
  // Bind approval to this copied geometry, never to mutable/stale caller metadata.
  // Only record creation loads the solver; public parsing and stored reads do not.
  const { assessTrackQuality, qualityVersionForTrack } =
    await import('./circuit-quality.ts');
  const { normalizeGeneratorConfig } = await import('./circuit-generator.ts');
  const normalize =
    track.generatorVersion === 'linked-circuits-v4' ||
    track.generatorVersion ===
      (await import('./course-rhythm.ts')).LINKED_COURSE_VERSION
      ? (await import('./braking-course-generator.ts'))
          .normalizeCurrentCourseConfig
      : track.schemaVersion === 2
        ? (await import('./elevated-generator.ts'))
            .normalizeElevatedGeneratorConfig
        : normalizeGeneratorConfig;
  const generatorConfig = normalize(generated.diagnostics.config);
  if (
    JSON.stringify(numericMap(generatorConfig, 'generatorConfig')) !==
      JSON.stringify(
        numericMap(generated.diagnostics.config, 'generatorConfig')
      ) ||
    track.samples.some((sample) => sample.width !== generatorConfig.width)
  )
    throw new DailyChallengeError(
      'integrity',
      'Generator configuration does not match approved geometry'
    );
  const quality = assessTrackQuality(track, {
    thresholds: generated.quality.thresholds,
    structure: {
      minRadius: generated.diagnostics.config.minRadius,
      clearance: generated.diagnostics.config.clearance,
      shoulder: generated.diagnostics.config.shoulder,
    },
  });
  const metrics = quality.metrics;
  if (
    !quality.valid ||
    quality.version !== qualityVersionForTrack(track) ||
    JSON.stringify(numericMap(quality.thresholds, 'qualityThresholds')) !==
      JSON.stringify(
        numericMap(generated.quality.thresholds, 'qualityThresholds')
      ) ||
    quality.codes.length ||
    !quality.structure.valid ||
    !metrics ||
    !metrics.hold.finished ||
    !metrics.cautious.finished ||
    !metrics.fast.finished ||
    metrics.hold.finishTicks === null ||
    metrics.cautious.finishTicks === null ||
    metrics.fast.finishTicks === null ||
    quality.work.replayChecks !== 3 ||
    !quality.fastReplay ||
    generated.quality.version !== quality.version ||
    generated.diagnostics.qualityVersion !== quality.version
  )
    throw new DailyChallengeError(
      'integrity',
      'Copied course does not pass its matching quality policy'
    );
  const challenge: Omit<DailyChallenge, 'challengeHash'> = {
    schemaVersion: 1,
    id: dailyChallengeId(input.subredditId, input.day),
    subredditId: input.subredditId,
    day: input.day,
    ...window,
    track,
    trackHash: await hashTrack(track),
    generatorVersion: track.generatorVersion,
    qualityVersion: quality.version,
    simulationVersion: quality.fastReplay.simulationVersion,
    handlingVersion: quality.fastReplay.handlingVersion,
    simulationHz: 120,
    initialConditions: initialConditions(),
  };
  assertSupportedScoredRuntime(
    challenge.simulationVersion,
    challenge.handlingVersion,
    challenge.simulationHz
  );
  const audit: DailyChallengeAudit = {
    generatorFallback: input.generatorFallback ?? false,
    structuralFallback: generated.diagnostics.fallbackUsed,
    generationAttempts: generated.diagnostics.attempts,
    qualityAttempts: generated.diagnostics.qualityAttempts,
    generationRejectCodes: generated.diagnostics.rejections.flatMap(
      (rejection) => rejection.codes
    ),
    qualityRejectCodes: generated.diagnostics.qualityRejections.flatMap(
      (rejection) => rejection.codes
    ),
    holdFinishTicks: metrics.hold.finishTicks,
    cautiousFinishTicks: metrics.cautious.finishTicks,
    fastFinishTicks: metrics.fast.finishTicks,
    meaningfulLifts: metrics.meaningfulLifts,
    gainTicks: metrics.gainTicks,
    fastOffRoadTicks: metrics.fast.offRoadTicks,
    fastRecoveryTicks: metrics.fast.recoveryTicks,
    controllerRuns:
      generated.diagnostics.validationWork.controllerRuns +
      quality.work.controllerRuns,
    simulatedTicks:
      generated.diagnostics.validationWork.simulatedTicks +
      quality.work.simulatedTicks,
    replayChecks:
      generated.diagnostics.validationWork.replayChecks +
      quality.work.replayChecks,
  };
  return parseDailyChallengeRecord({
    ...challenge,
    challengeHash: await hashDailyChallenge(challenge),
    createdAtMs: timestamp(input.createdAtMs, 'createdAtMs'),
    requestedSeed: text(input.requestedSeed, 'requestedSeed', 96),
    generatorConfig: generated.diagnostics.config,
    qualityThresholds: quality.thresholds,
    audit,
  });
}
export function rankedWindowIsOpen(
  challenge: DailyChallenge,
  nowMs: number
): boolean {
  const now = timestamp(nowMs, 'Clock');
  return now >= challenge.startsAtMs && now < challenge.endsAtMs;
}
export function rankedSessionExpiresAt(
  challenge: DailyChallenge,
  startedAtMs: number
): number {
  if (!rankedWindowIsOpen(challenge, startedAtMs))
    throw new DailyChallengeError(
      'invalid',
      'Ranked sessions must start within the challenge UTC day'
    );
  return Math.min(
    startedAtMs + RANKED_SESSION_MAX_AGE,
    challenge.endsAtMs + RANKED_ROLLOVER_GRACE
  );
}
export function dailyChallengeView(
  challenge: DailyChallengeRecord,
  nowMs: number
): DailyChallengeView {
  const serverNowMs = timestamp(nowMs, 'Clock'),
    currentDay = utcDay(serverNowMs);
  return {
    challenge: toPublicDailyChallenge(challenge),
    serverNowMs,
    currentDay,
    nextResetAtMs: utcDayWindow(currentDay).endsAtMs,
    isCurrent: challenge.day === currentDay,
    rankedWindowOpen: rankedWindowIsOpen(challenge, serverNowMs),
  };
}
export async function parseDailyChallengeView(
  value: unknown
): Promise<DailyChallengeView> {
  if (!record(value))
    throw new DailyChallengeError('integrity', 'Daily view must be an object');
  fields(value, [
    'challenge',
    'serverNowMs',
    'currentDay',
    'nextResetAtMs',
    'isCurrent',
    'rankedWindowOpen',
  ]);
  const challenge = await parseDailyChallenge(value.challenge),
    serverNowMs = timestamp(value.serverNowMs, 'serverNowMs'),
    currentDay = utcDay(serverNowMs);
  const nextResetAtMs = utcDayWindow(currentDay).endsAtMs,
    isCurrent = challenge.day === currentDay,
    rankedWindowOpen = rankedWindowIsOpen(challenge, serverNowMs);
  if (
    value.currentDay !== currentDay ||
    value.nextResetAtMs !== nextResetAtMs ||
    value.isCurrent !== isCurrent ||
    value.rankedWindowOpen !== rankedWindowOpen
  )
    throw new DailyChallengeError(
      'integrity',
      'Daily view UTC status does not match server time'
    );
  return {
    challenge,
    serverNowMs,
    currentDay,
    nextResetAtMs,
    isCurrent,
    rankedWindowOpen,
  };
}
