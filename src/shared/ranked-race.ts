import { scoredRuntime } from './scored-runtime.ts';
import { validateReplay } from './replay.ts';
import type { Replay } from './replay.ts';
import { MAX_SIMULATION_TICKS, SIMULATION_HZ } from './simulation.ts';
import {
  assertSupportedScoredRuntime,
  RANKED_SESSION_MAX_AGE,
} from './daily-challenge.ts';

export type RankedRaceErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'archive'
  | 'expired'
  | 'invalid'
  | 'conflict'
  | 'integrity'
  | 'unsupported'
  | 'unavailable'
  | 'rate-limited';
export class RankedRaceError extends Error {
  constructor(
    public readonly kind: RankedRaceErrorKind,
    message: string
  ) {
    super(message);
    this.name = 'RankedRaceError';
  }
}
export type StartRankedRaceResponse = {
  sessionId: string;
  challengeId: string;
  challengeHash: string;
  trackHash: string;
  simulationVersion: string;
  handlingVersion: string;
  expiresAtMs: number;
  serverNowMs: number;
};
export type VerifiedRunResponse = {
  sessionId: string;
  challengeId: string;
  challengeHash: string;
  finishTicks: number;
  simulationHz: 120;
  finishTimeMs: number;
  verifiedAtMs: number;
};
export type RankedSubmission = { sessionId: string; replay: Replay };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fields(
  value: Record<string, unknown>,
  keys: string[],
  kind: RankedRaceErrorKind
): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new RankedRaceError(
      kind,
      'Ranked request or response has missing or unsupported fields'
    );
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 128)
    throw new RankedRaceError('integrity', `${name} is invalid`);
  return value;
}
export function isRankedSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value
    )
  );
}
export function isRankedHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
function timestamp(value: unknown, name: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isFinite(new Date(value).getTime())
  )
    throw new RankedRaceError('integrity', `${name} is invalid`);
  return value;
}
export function parseRankedSubmission(value: unknown): RankedSubmission {
  if (!record(value))
    throw new RankedRaceError(
      'invalid',
      'A session and input replay are required'
    );
  fields(value, ['sessionId', 'replay'], 'invalid');
  if (!isRankedSessionId(value.sessionId))
    throw new RankedRaceError('invalid', 'Ranked session ID is invalid');
  if (record(value.replay)) {
    const sim = value.replay.simulationVersion,
      handling = value.replay.handlingVersion;
    if (
      (typeof sim === 'string' &&
        !['fixed-step-v2', 'fixed-step-v4'].includes(sim)) ||
      (typeof handling === 'string' &&
        !['arcade-v1', 'centreline-v1'].includes(handling)) ||
      (typeof value.replay.schemaVersion === 'number' &&
        value.replay.schemaVersion !== 1)
    )
      throw new RankedRaceError(
        'unsupported',
        'Run replay version is unsupported'
      );
    if (typeof sim === 'string' && typeof handling === 'string') {
      try {
        scoredRuntime(sim, handling);
      } catch {
        throw new RankedRaceError(
          'unsupported',
          'Run replay version is unsupported'
        );
      }
    }
  }
  let replay: Replay;
  try {
    replay = validateReplay(value.replay);
  } catch {
    throw new RankedRaceError(
      'invalid',
      'Run input replay is malformed or exceeds its bounds'
    );
  }
  return { sessionId: value.sessionId, replay };
}

export async function fingerprintReplay(value: Replay): Promise<string> {
  let replay: Replay;
  try {
    replay = validateReplay(value);
  } catch {
    throw new RankedRaceError('invalid', 'Run input replay is malformed');
  }
  if (!globalThis.crypto?.subtle)
    throw new RankedRaceError(
      'unavailable',
      'Replay integrity verification is unavailable'
    );
  const canonical = JSON.stringify({
    schemaVersion: replay.schemaVersion,
    simulationVersion: replay.simulationVersion,
    handlingVersion: replay.handlingVersion,
    transitions: replay.transitions.map(({ tick, held }) => ({ tick, held })),
    endTick: replay.endTick,
  });
  try {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonical)
    );
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
  } catch {
    throw new RankedRaceError(
      'unavailable',
      'Replay integrity verification is unavailable'
    );
  }
}

export function parseStartRankedRaceResponse(
  value: unknown
): StartRankedRaceResponse {
  if (!record(value))
    throw new RankedRaceError(
      'integrity',
      'Ranked session response is malformed'
    );
  fields(
    value,
    [
      'sessionId',
      'challengeId',
      'challengeHash',
      'trackHash',
      'simulationVersion',
      'handlingVersion',
      'expiresAtMs',
      'serverNowMs',
    ],
    'integrity'
  );
  if (
    !isRankedSessionId(value.sessionId) ||
    !isRankedHash(value.challengeHash) ||
    !isRankedHash(value.trackHash)
  )
    throw new RankedRaceError(
      'integrity',
      'Ranked session integrity fields are invalid'
    );
  const simulationVersion = text(value.simulationVersion, 'simulationVersion'),
    handlingVersion = text(value.handlingVersion, 'handlingVersion');
  try {
    assertSupportedScoredRuntime(
      simulationVersion,
      handlingVersion,
      SIMULATION_HZ
    );
  } catch {
    throw new RankedRaceError(
      'unsupported',
      'Ranked session rules are unsupported'
    );
  }
  const serverNowMs = timestamp(value.serverNowMs, 'serverNowMs'),
    expiresAtMs = timestamp(value.expiresAtMs, 'expiresAtMs');
  if (
    expiresAtMs <= serverNowMs ||
    expiresAtMs > serverNowMs + RANKED_SESSION_MAX_AGE
  )
    throw new RankedRaceError(
      'integrity',
      'Ranked session expiration is invalid'
    );
  return {
    sessionId: value.sessionId,
    challengeId: text(value.challengeId, 'challengeId'),
    challengeHash: value.challengeHash,
    trackHash: value.trackHash,
    simulationVersion,
    handlingVersion,
    expiresAtMs,
    serverNowMs,
  };
}
export function parseVerifiedRunResponse(value: unknown): VerifiedRunResponse {
  if (!record(value))
    throw new RankedRaceError(
      'integrity',
      'Verified result response is malformed'
    );
  fields(
    value,
    [
      'sessionId',
      'challengeId',
      'challengeHash',
      'finishTicks',
      'simulationHz',
      'finishTimeMs',
      'verifiedAtMs',
    ],
    'integrity'
  );
  if (
    !isRankedSessionId(value.sessionId) ||
    !isRankedHash(value.challengeHash) ||
    typeof value.finishTicks !== 'number' ||
    !Number.isInteger(value.finishTicks) ||
    value.finishTicks < 1 ||
    value.finishTicks > MAX_SIMULATION_TICKS ||
    value.simulationHz !== 120 ||
    typeof value.finishTimeMs !== 'number' ||
    !Number.isFinite(value.finishTimeMs) ||
    Math.abs(value.finishTimeMs - (value.finishTicks * 1000) / 120) > 0.000001
  )
    throw new RankedRaceError(
      'integrity',
      'Verified result time or identity is invalid'
    );
  return {
    sessionId: value.sessionId,
    challengeId: text(value.challengeId, 'challengeId'),
    challengeHash: value.challengeHash,
    finishTicks: value.finishTicks,
    simulationHz: 120,
    finishTimeMs: value.finishTimeMs,
    verifiedAtMs: timestamp(value.verifiedAtMs, 'verifiedAtMs'),
  };
}
