import {
  dailyChallengeId,
  DailyChallengeError,
  parseDailyChallengeRecord,
  rankedSessionExpiresAt,
  rankedWindowIsOpen,
  RANKED_ROLLOVER_GRACE,
  RANKED_SESSION_MAX_AGE,
  utcDayWindow,
  validateSubredditId,
  assertSupportedScoredRuntime,
} from '../../shared/daily-challenge.ts';
import {
  fingerprintReplay,
  isRankedHash,
  isRankedSessionId,
  parseRankedSubmission,
  parseStartRankedRaceResponse,
  parseVerifiedRunResponse,
  RankedRaceError,
} from '../../shared/ranked-race.ts';
import type {
  StartRankedRaceResponse,
  VerifiedRunResponse,
} from '../../shared/ranked-race.ts';
import { runReplay } from '../../shared/replay.ts';
import type { DailyChallengeService } from './daily-challenges.ts';

export { RankedRaceError } from '../../shared/ranked-race.ts';
export const SESSION_METADATA_GRACE_MS = 10 * 60_000;
export const RECEIPT_RETENTION_MS = 10 * 60_000;
export type RankedStore = {
  get: (key: string) => Promise<string | undefined>;
  setNX: (key: string, value: string, expiresAtMs: number) => Promise<boolean>;
};
export type RankedContext = {
  userId?: string;
  subredditId: string;
  postId: string;
};
export type AuthenticatedRankedContext = {
  userId: string;
  subredditId: string;
  postId: string;
};
export type RankedSessionRecord = {
  schemaVersion: 1;
  sessionId: string;
  userId: string;
  subredditId: string;
  postId: string;
  day: string;
  challengeId: string;
  challengeHash: string;
  trackHash: string;
  simulationVersion: string;
  handlingVersion: string;
  simulationHz: 120;
  createdAtMs: number;
  expiresAtMs: number;
};
export type VerificationReceiptRecord = {
  schemaVersion: 1;
  session: RankedSessionRecord;
  replayFingerprint: string;
  response: VerifiedRunResponse;
};
export type VerifiedRunCommit = {
  session: RankedSessionRecord;
  replayFingerprint: string;
  response: VerifiedRunResponse;
};
export type RankedRaceServiceDependencies = {
  context: RankedContext;
  store: RankedStore;
  daily: Pick<DailyChallengeService, 'getForPost' | 'read'>;
  now: () => number;
  newSessionId: () => string;
  consumeStartBudget: (context: AuthenticatedRankedContext) => Promise<void>;
  consumeVerifyBudget: (context: AuthenticatedRankedContext) => Promise<void>;
  commitVerified: (
    candidate: VerifiedRunCommit
  ) => Promise<VerificationReceiptRecord>;
};
export type RankedRaceService = {
  start: () => Promise<StartRankedRaceResponse>;
  submit: (input: unknown) => Promise<VerifiedRunResponse>;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new RankedRaceError('integrity', 'Stored ranked data is malformed');
  }
}
function fields(value: Record<string, unknown>, keys: string[]): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new RankedRaceError(
      'integrity',
      'Stored ranked fields are missing or unsupported'
    );
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 128)
    throw new RankedRaceError('integrity', `${name} is invalid`);
  return value;
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
function validateScope(subredditId: string): void {
  try {
    validateSubredditId(subredditId);
  } catch {
    throw new RankedRaceError('integrity', 'Ranked subreddit scope is invalid');
  }
}
function validPost(postId: unknown): postId is string {
  return (
    typeof postId === 'string' &&
    postId.length <= 40 &&
    /^t3_[a-z0-9]+$/.test(postId)
  );
}
function validUser(userId: unknown): userId is string {
  return (
    typeof userId === 'string' &&
    userId.length <= 40 &&
    /^t2_[a-z0-9]+$/.test(userId)
  );
}
export function sessionKey(subredditId: string, sessionId: string): string {
  validateScope(subredditId);
  if (!isRankedSessionId(sessionId))
    throw new RankedRaceError('integrity', 'Session key ID is invalid');
  return `racer:session:${subredditId}:${sessionId}`;
}
export function receiptKey(subredditId: string, sessionId: string): string {
  validateScope(subredditId);
  if (!isRankedSessionId(sessionId))
    throw new RankedRaceError('integrity', 'Receipt key ID is invalid');
  return `racer:receipt:${subredditId}:${sessionId}`;
}

/** Parsing a historical receipt does not execute or reinterpret its race physics. */
export function parseRankedSession(input: unknown): RankedSessionRecord {
  const value = decoded(input);
  if (!record(value))
    throw new RankedRaceError('integrity', 'Stored session is malformed');
  if (value.schemaVersion !== 1)
    throw new RankedRaceError(
      'unsupported',
      'Stored session schema is unsupported'
    );
  fields(value, [
    'schemaVersion',
    'sessionId',
    'userId',
    'subredditId',
    'postId',
    'day',
    'challengeId',
    'challengeHash',
    'trackHash',
    'simulationVersion',
    'handlingVersion',
    'simulationHz',
    'createdAtMs',
    'expiresAtMs',
  ]);
  if (
    !isRankedSessionId(value.sessionId) ||
    !validUser(value.userId) ||
    !validPost(value.postId) ||
    !isRankedHash(value.challengeHash) ||
    !isRankedHash(value.trackHash) ||
    value.simulationHz !== 120
  )
    throw new RankedRaceError(
      'integrity',
      'Stored session identity or integrity data is invalid'
    );
  const subredditId = text(value.subredditId, 'subredditId'),
    day = text(value.day, 'day'),
    challengeId = text(value.challengeId, 'challengeId');
  validateScope(subredditId);
  let window: { startsAtMs: number; endsAtMs: number };
  try {
    window = utcDayWindow(day);
    if (dailyChallengeId(subredditId, day) !== challengeId)
      throw new Error('identity');
  } catch {
    throw new RankedRaceError(
      'integrity',
      'Stored session day or challenge identity is invalid'
    );
  }
  const createdAtMs = timestamp(value.createdAtMs, 'createdAtMs'),
    expiresAtMs = timestamp(value.expiresAtMs, 'expiresAtMs');
  if (
    createdAtMs < window.startsAtMs ||
    createdAtMs >= window.endsAtMs ||
    expiresAtMs !==
      Math.min(
        createdAtMs + RANKED_SESSION_MAX_AGE,
        window.endsAtMs + RANKED_ROLLOVER_GRACE
      )
  )
    throw new RankedRaceError(
      'integrity',
      'Stored session expiration does not match the admitted UTC window'
    );
  return {
    schemaVersion: 1,
    sessionId: value.sessionId,
    userId: value.userId,
    subredditId,
    postId: value.postId,
    day,
    challengeId,
    challengeHash: value.challengeHash,
    trackHash: value.trackHash,
    simulationVersion: text(value.simulationVersion, 'simulationVersion'),
    handlingVersion: text(value.handlingVersion, 'handlingVersion'),
    simulationHz: 120,
    createdAtMs,
    expiresAtMs,
  };
}
export function serializeRankedSession(value: RankedSessionRecord): string {
  return JSON.stringify(parseRankedSession(value));
}
export function parseVerificationReceipt(
  input: unknown
): VerificationReceiptRecord {
  const value = decoded(input);
  if (!record(value))
    throw new RankedRaceError(
      'integrity',
      'Stored verification receipt is malformed'
    );
  if (value.schemaVersion !== 1)
    throw new RankedRaceError(
      'unsupported',
      'Stored verification receipt schema is unsupported'
    );
  fields(value, ['schemaVersion', 'session', 'replayFingerprint', 'response']);
  const session = parseRankedSession(value.session),
    response = parseVerifiedRunResponse(value.response);
  if (
    !isRankedHash(value.replayFingerprint) ||
    response.sessionId !== session.sessionId ||
    response.challengeId !== session.challengeId ||
    response.challengeHash !== session.challengeHash ||
    response.verifiedAtMs < session.createdAtMs ||
    response.verifiedAtMs >= session.expiresAtMs
  )
    throw new RankedRaceError(
      'integrity',
      'Stored receipt is not bound to its admitted race'
    );
  return {
    schemaVersion: 1,
    session,
    replayFingerprint: value.replayFingerprint,
    response,
  };
}
export function serializeVerificationReceipt(
  value: VerificationReceiptRecord
): string {
  return JSON.stringify(parseVerificationReceipt(value));
}
function owned(
  session: RankedSessionRecord,
  context: AuthenticatedRankedContext,
  sessionId: string
): void {
  if (session.sessionId !== sessionId)
    throw new RankedRaceError(
      'integrity',
      'Stored session does not match its storage key'
    );
  if (
    session.userId !== context.userId ||
    session.subredditId !== context.subredditId ||
    session.postId !== context.postId
  )
    throw new RankedRaceError(
      'forbidden',
      'This race belongs to a different account or originating post'
    );
}
export function validateCommittedReceipt(
  winner: VerificationReceiptRecord,
  candidate: VerifiedRunCommit
): VerificationReceiptRecord {
  const parsed = parseVerificationReceipt(winner);
  if (
    serializeRankedSession(parsed.session) !==
    serializeRankedSession(candidate.session)
  )
    throw new RankedRaceError(
      'integrity',
      'Stored receipt does not match the immutable session'
    );
  if (parsed.replayFingerprint !== candidate.replayFingerprint)
    throw new RankedRaceError(
      'conflict',
      'This race session already accepted a different input replay'
    );
  if (parsed.response.finishTicks !== candidate.response.finishTicks)
    throw new RankedRaceError(
      'integrity',
      'Stored receipt disagrees with authoritative replay time'
    );
  return parsed;
}

/** #11 replaces this boundary with one atomic receipt + personal-best transaction. */
export function createNxReceiptCommitter(
  store: RankedStore
): (candidate: VerifiedRunCommit) => Promise<VerificationReceiptRecord> {
  return async (candidate) => {
    const receipt = parseVerificationReceipt({
      schemaVersion: 1,
      ...candidate,
    });
    const key = receiptKey(
      receipt.session.subredditId,
      receipt.session.sessionId
    );
    let stored: string | undefined;
    try {
      await store.setNX(
        key,
        serializeVerificationReceipt(receipt),
        receipt.response.verifiedAtMs + RECEIPT_RETENTION_MS
      );
      stored = await store.get(key);
    } catch {
      throw new RankedRaceError(
        'unavailable',
        'Verified receipt storage is unavailable'
      );
    }
    if (stored === undefined)
      throw new RankedRaceError(
        'unavailable',
        'Verified receipt storage did not confirm the accepted result'
      );
    return validateCommittedReceipt(
      parseVerificationReceipt(stored),
      candidate
    );
  };
}

export function createRankedRaceService(
  deps: RankedRaceServiceDependencies
): RankedRaceService {
  function context(): AuthenticatedRankedContext {
    if (!validUser(deps.context.userId))
      throw new RankedRaceError(
        'unauthenticated',
        'Sign in to race with a verified account'
      );
    if (!validPost(deps.context.postId))
      throw new RankedRaceError(
        'unavailable',
        'An originating Reddit post is required'
      );
    validateScope(deps.context.subredditId);
    return {
      userId: deps.context.userId,
      subredditId: deps.context.subredditId,
      postId: deps.context.postId,
    };
  }
  function now(): number {
    try {
      return timestamp(deps.now(), 'Server clock');
    } catch {
      throw new RankedRaceError(
        'unavailable',
        'The authoritative server clock is unavailable'
      );
    }
  }
  async function get(key: string): Promise<string | undefined> {
    try {
      return await deps.store.get(key);
    } catch {
      throw new RankedRaceError(
        'unavailable',
        'Ranked race storage is unavailable'
      );
    }
  }
  async function budget(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof RankedRaceError) throw error;
      throw new RankedRaceError(
        'unavailable',
        'Ranked request allowance is unavailable'
      );
    }
  }
  function active(session: RankedSessionRecord): void {
    if (now() >= session.expiresAtMs)
      throw new RankedRaceError(
        'expired',
        'The ranked attempt expired; start a fresh run'
      );
  }
  function dailyError(error: unknown): never {
    if (
      error instanceof DailyChallengeError &&
      (error.kind === 'integrity' || error.kind === 'unsupported')
    )
      throw new RankedRaceError(error.kind, error.message);
    throw new RankedRaceError(
      'unavailable',
      'The immutable daily challenge is unavailable'
    );
  }
  async function start(): Promise<StartRankedRaceResponse> {
    const actor = context();
    await budget(() => deps.consumeStartBudget(actor));
    let view;
    try {
      view = await deps.daily.getForPost(actor);
    } catch (error) {
      return dailyError(error);
    }
    // Capture admission after any expensive load/generation and request allowance.
    const createdAtMs = now(),
      challenge = view.challenge;
    if (!rankedWindowIsOpen(challenge, createdAtMs))
      throw new RankedRaceError(
        'archive',
        'This original-day circuit is available as practice'
      );
    try {
      assertSupportedScoredRuntime(
        challenge.simulationVersion,
        challenge.handlingVersion,
        challenge.simulationHz
      );
    } catch {
      throw new RankedRaceError(
        'unsupported',
        'This challenge needs unavailable race rules'
      );
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      let sessionId: string;
      try {
        sessionId = deps.newSessionId();
      } catch {
        throw new RankedRaceError(
          'unavailable',
          'A secure ranked session ID could not be created'
        );
      }
      if (!isRankedSessionId(sessionId))
        throw new RankedRaceError(
          'unavailable',
          'A secure ranked session ID could not be created'
        );
      const session = parseRankedSession({
        schemaVersion: 1,
        sessionId,
        ...actor,
        day: challenge.day,
        challengeId: challenge.id,
        challengeHash: challenge.challengeHash,
        trackHash: challenge.trackHash,
        simulationVersion: challenge.simulationVersion,
        handlingVersion: challenge.handlingVersion,
        simulationHz: challenge.simulationHz,
        createdAtMs,
        expiresAtMs: rankedSessionExpiresAt(challenge, createdAtMs),
      });
      const key = sessionKey(actor.subredditId, sessionId),
        serialized = serializeRankedSession(session);
      let created: boolean;
      try {
        created = await deps.store.setNX(
          key,
          serialized,
          session.expiresAtMs + SESSION_METADATA_GRACE_MS
        );
      } catch {
        throw new RankedRaceError(
          'unavailable',
          'Ranked session storage is unavailable'
        );
      }
      if (!created) continue;
      const raw = await get(key);
      if (
        raw === undefined ||
        serializeRankedSession(parseRankedSession(raw)) !== serialized
      )
        throw new RankedRaceError(
          'unavailable',
          'Ranked session storage did not confirm its immutable starting conditions'
        );
      active(session);
      return parseStartRankedRaceResponse({
        sessionId,
        challengeId: session.challengeId,
        challengeHash: session.challengeHash,
        trackHash: session.trackHash,
        simulationVersion: session.simulationVersion,
        handlingVersion: session.handlingVersion,
        expiresAtMs: session.expiresAtMs,
        serverNowMs: now(),
      });
    }
    throw new RankedRaceError(
      'unavailable',
      'A unique ranked session could not be reserved'
    );
  }
  async function submit(input: unknown): Promise<VerifiedRunResponse> {
    const actor = context(),
      submission = parseRankedSubmission(input),
      replayFingerprint = await fingerprintReplay(submission.replay);
    const storedReceipt = await get(
      receiptKey(actor.subredditId, submission.sessionId)
    );
    if (storedReceipt !== undefined) {
      const receipt = parseVerificationReceipt(storedReceipt);
      owned(receipt.session, actor, submission.sessionId);
      if (receipt.replayFingerprint !== replayFingerprint)
        throw new RankedRaceError(
          'conflict',
          'This race session already accepted a different input replay'
        );
      if (now() >= receipt.response.verifiedAtMs + RECEIPT_RETENTION_MS)
        throw new RankedRaceError(
          'expired',
          'The retained result window ended; start a fresh run'
        );
      return receipt.response;
    }
    const storedSession = await get(
      sessionKey(actor.subredditId, submission.sessionId)
    );
    if (storedSession === undefined)
      throw new RankedRaceError(
        'expired',
        'The ranked session expired or is no longer retained'
      );
    const session = parseRankedSession(storedSession);
    owned(session, actor, submission.sessionId);
    active(session);
    let challenge;
    try {
      const stored = await deps.daily.read({
        subredditId: actor.subredditId,
        day: session.day,
      });
      if (!stored)
        throw new DailyChallengeError(
          'integrity',
          'The session challenge record is missing'
        );
      challenge = await parseDailyChallengeRecord(stored);
    } catch (error) {
      return dailyError(error);
    }
    if (
      challenge.id !== session.challengeId ||
      challenge.challengeHash !== session.challengeHash ||
      challenge.trackHash !== session.trackHash ||
      challenge.simulationVersion !== session.simulationVersion ||
      challenge.handlingVersion !== session.handlingVersion ||
      challenge.simulationHz !== session.simulationHz ||
      submission.replay.simulationVersion !== session.simulationVersion ||
      submission.replay.handlingVersion !== session.handlingVersion
    )
      throw new RankedRaceError(
        'integrity',
        'Session rules do not match the immutable stored challenge'
      );
    await budget(() => deps.consumeVerifyBudget(actor));
    active(session);
    let finishTicks: number;
    try {
      finishTicks = runReplay(challenge.track, submission.replay).finishTicks;
    } catch {
      throw new RankedRaceError(
        'invalid',
        'The input replay does not complete a valid authoritative lap'
      );
    }
    active(session);
    const response = parseVerifiedRunResponse({
      sessionId: session.sessionId,
      challengeId: session.challengeId,
      challengeHash: session.challengeHash,
      finishTicks,
      simulationHz: 120,
      finishTimeMs: (finishTicks * 1000) / 120,
      verifiedAtMs: now(),
    });
    if (response.verifiedAtMs >= session.expiresAtMs)
      throw new RankedRaceError(
        'expired',
        'The ranked attempt expired before verification completed'
      );
    let winner: VerificationReceiptRecord;
    try {
      winner = await deps.commitVerified({
        session,
        replayFingerprint,
        response,
      });
    } catch (error) {
      if (error instanceof RankedRaceError) throw error;
      throw new RankedRaceError(
        'unavailable',
        'The verified result could not be committed'
      );
    }
    const receipt = validateCommittedReceipt(winner, {
      session,
      replayFingerprint,
      response,
    });
    // The winner was verified before expiry. Persistence latency crossing the
    // deadline must not invalidate an accepted atomic receipt or its later retries.
    return receipt.response;
  }
  return { start, submit };
}
