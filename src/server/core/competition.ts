import { RACE_STORAGE_PREFIX } from '../../shared/race-storage';
import {
  DailyChallengeError,
  utcDayWindow,
  validateSubredditId,
} from '../../shared/daily-challenge.ts';
import type { DailyChallenge } from '../../shared/daily-challenge.ts';
import {
  competitionTicks,
  competitionUsername,
  parseCompetitionOutcome,
  parseLeaderboardQuery,
  parseLeaderboardView,
  RESULTS_RETENTION_MS,
} from '../../shared/leaderboard.ts';
import type {
  CompetitionOutcome,
  LeaderboardQuery,
  LeaderboardRow,
  LeaderboardView,
} from '../../shared/leaderboard.ts';
import { RankedRaceError } from '../../shared/ranked-race.ts';
import type { DailyChallengeService } from './daily-challenges.ts';
import {
  parseVerificationReceipt,
  receiptKey,
  RECEIPT_RETENTION_MS,
  serializeVerificationReceipt,
  validateCommittedReceipt,
} from './ranked-races.ts';
import type {
  RankedContext,
  VerificationReceiptRecord,
  VerifiedRunCommit,
} from './ranked-races.ts';

export const MAX_COMPETITION_CAS_ATTEMPTS = 5;
export const MAX_LEADERBOARD_READ_ATTEMPTS = 3;
export type CompetitionMember = { member: string; score: number };
export type CompetitionMutation = {
  expected: { key: string; value: string | undefined }[];
  sets: { key: string; value: string; expiresAtMs: number }[];
  sortedSet?: {
    key: string;
    member: string;
    score: number;
    expectedScore: number | undefined;
    expiresAtMs: number;
  };
  increments: { key: string; expiresAtMs: number }[];
};
export type CompetitionStore = {
  get: (key: string) => Promise<string | undefined>;
  getMany: (keys: string[]) => Promise<(string | undefined)[]>;
  rangeByRank: (
    key: string,
    start: number,
    stop: number
  ) => Promise<CompetitionMember[]>;
  firstAtScore: (
    key: string,
    score: number
  ) => Promise<CompetitionMember | undefined>;
  rankOf: (key: string, member: string) => Promise<number | undefined>;
  scoreOf: (key: string, member: string) => Promise<number | undefined>;
  compareAndSwap: (mutation: CompetitionMutation) => Promise<boolean>;
};
export type PersonalBestRecord = {
  schemaVersion: 1;
  username: string;
  receipt: VerificationReceiptRecord;
};
export type CompetitionOutcomeRecord = {
  schemaVersion: 1;
  receipt: VerificationReceiptRecord;
  personalBest: PersonalBestRecord;
  outcome: CompetitionOutcome;
};
export type CompetitionDependencies = {
  context: RankedContext;
  daily: Pick<DailyChallengeService, 'getForPost'>;
  store: CompetitionStore;
  now: () => number;
  getUsername: (userId: string) => Promise<string | undefined>;
};
export type CompetitionService = {
  commitVerified: (
    candidate: VerifiedRunCommit
  ) => Promise<VerificationReceiptRecord>;
  getLeaderboard: (input?: unknown) => Promise<LeaderboardView>;
};

function scope(subredditId: string): void {
  try {
    validateSubredditId(subredditId);
  } catch {
    throw new RankedRaceError('integrity', 'Competition scope is invalid');
  }
}
function userId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    /^t2_[a-z0-9]+$/.test(value)
  );
}
export function leaderboardKey(subredditId: string, day: string): string {
  scope(subredditId);
  utcDayWindow(day);
  return `${RACE_STORAGE_PREFIX}:leaderboard:${subredditId}:${day}`;
}
export function personalBestKey(
  subredditId: string,
  day: string,
  user: string
): string {
  scope(subredditId);
  utcDayWindow(day);
  if (!userId(user))
    throw new RankedRaceError('integrity', 'Personal-best owner is invalid');
  return `${RACE_STORAGE_PREFIX}:pb:${subredditId}:${day}:${user}`;
}
export function competitionOutcomeKey(
  subredditId: string,
  sessionId: string
): string {
  receiptKey(subredditId, sessionId);
  return `${RACE_STORAGE_PREFIX}:outcome:${subredditId}:${sessionId}`;
}
export function boardRevisionKey(subredditId: string, day: string): string {
  scope(subredditId);
  utcDayWindow(day);
  return `${RACE_STORAGE_PREFIX}:board-revision:${subredditId}:${day}`;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new RankedRaceError(
      'integrity',
      'Stored competition data is malformed'
    );
  }
}
function fields(value: Record<string, unknown>, keys: string[]): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new RankedRaceError(
      'integrity',
      'Stored competition fields are invalid'
    );
}
function sameRace(
  a: VerificationReceiptRecord,
  b: VerificationReceiptRecord
): boolean {
  return (
    a.session.sessionId === b.session.sessionId &&
    a.session.userId === b.session.userId &&
    a.session.subredditId === b.session.subredditId &&
    a.session.postId === b.session.postId &&
    a.session.challengeId === b.session.challengeId &&
    a.session.challengeHash === b.session.challengeHash &&
    a.replayFingerprint === b.replayFingerprint &&
    a.response.finishTicks === b.response.finishTicks
  );
}
export function parsePersonalBest(value: unknown): PersonalBestRecord {
  const raw = decoded(value);
  if (!record(raw))
    throw new RankedRaceError('integrity', 'Personal best is malformed');
  fields(raw, ['schemaVersion', 'username', 'receipt']);
  if (raw.schemaVersion !== 1 || !competitionUsername(raw.username))
    throw new RankedRaceError(
      'integrity',
      'Personal-best schema or username is invalid'
    );
  return {
    schemaVersion: 1,
    username: raw.username,
    receipt: parseVerificationReceipt(raw.receipt),
  };
}
export function serializePersonalBest(value: PersonalBestRecord): string {
  return JSON.stringify(parsePersonalBest(value));
}
export function parseCompetitionOutcomeRecord(
  value: unknown
): CompetitionOutcomeRecord {
  const raw = decoded(value);
  if (!record(raw))
    throw new RankedRaceError(
      'integrity',
      'Stored competition outcome is malformed'
    );
  fields(raw, ['schemaVersion', 'receipt', 'personalBest', 'outcome']);
  if (raw.schemaVersion !== 1)
    throw new RankedRaceError(
      'integrity',
      'Competition outcome schema is unsupported'
    );
  const receipt = parseVerificationReceipt(raw.receipt),
    personalBest = parsePersonalBest(raw.personalBest),
    outcome = parseCompetitionOutcome(raw.outcome);
  const a = receipt.session,
    b = personalBest.receipt.session;
  if (
    a.userId !== b.userId ||
    a.subredditId !== b.subredditId ||
    a.challengeId !== b.challengeId ||
    a.challengeHash !== b.challengeHash ||
    outcome.sessionId !== a.sessionId ||
    outcome.personalBestTicks !== personalBest.receipt.response.finishTicks ||
    outcome.personalBestTicks > receipt.response.finishTicks ||
    (outcome.isPersonalBest &&
      outcome.personalBestTicks !== receipt.response.finishTicks)
  )
    throw new RankedRaceError(
      'integrity',
      'Competition outcome is not bound to its verified run and personal best'
    );
  return { schemaVersion: 1, receipt, personalBest, outcome };
}
export function serializeCompetitionOutcomeRecord(
  value: CompetitionOutcomeRecord
): string {
  return JSON.stringify(parseCompetitionOutcomeRecord(value));
}
function revision(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new RankedRaceError('integrity', 'Leaderboard revision is invalid');
  return Number(value);
}
function score(value: number | undefined): number | undefined {
  if (value !== undefined && !competitionTicks(value))
    throw new RankedRaceError(
      'integrity',
      'Leaderboard score is not an authoritative integer tick count'
    );
  return value;
}
function ticks(best: PersonalBestRecord): number {
  return best.receipt.response.finishTicks;
}
function boundBest(
  best: PersonalBestRecord,
  expected: {
    userId: string;
    subredditId: string;
    challengeId: string;
    challengeHash: string;
  }
): void {
  const session = best.receipt.session;
  if (
    session.userId !== expected.userId ||
    session.subredditId !== expected.subredditId ||
    session.challengeId !== expected.challengeId ||
    session.challengeHash !== expected.challengeHash
  )
    throw new RankedRaceError(
      'integrity',
      'Personal best does not match its account/challenge'
    );
}

export function createCompetitionService(
  deps: CompetitionDependencies
): CompetitionService {
  function now(): number {
    const value = deps.now();
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RankedRaceError(
        'unavailable',
        'Competition clock is unavailable'
      );
    return value;
  }
  async function storage<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RankedRaceError) throw error;
      throw new RankedRaceError(
        'unavailable',
        'Competition storage is temporarily unavailable'
      );
    }
  }
  function actor(): { userId: string; subredditId: string; postId: string } {
    const context = deps.context;
    if (!userId(context.userId))
      throw new RankedRaceError(
        'unauthenticated',
        'Sign in to view your competition outcome'
      );
    scope(context.subredditId);
    if (!/^t3_[a-z0-9]+$/.test(context.postId))
      throw new RankedRaceError(
        'integrity',
        'Competition post context is invalid'
      );
    return {
      userId: context.userId,
      subredditId: context.subredditId,
      postId: context.postId,
    };
  }
  function own(receipt: VerificationReceiptRecord): void {
    const context = actor(),
      session = receipt.session;
    if (
      session.userId !== context.userId ||
      session.subredditId !== context.subredditId ||
      session.postId !== context.postId
    )
      throw new RankedRaceError(
        'forbidden',
        'This competition outcome belongs to another account or post'
      );
  }
  async function trustedUsername(id: string): Promise<string> {
    const value = await storage(() => deps.getUsername(id));
    if (!competitionUsername(value))
      throw new RankedRaceError(
        'unavailable',
        'Trusted Reddit username is unavailable'
      );
    return value;
  }
  async function commitVerified(
    candidate: VerifiedRunCommit
  ): Promise<VerificationReceiptRecord> {
    const proposed = parseVerificationReceipt({
      schemaVersion: 1,
      ...candidate,
    });
    own(proposed);
    const session = proposed.session,
      board = leaderboardKey(session.subredditId, session.day),
      pbKey = personalBestKey(session.subredditId, session.day, session.userId),
      rKey = receiptKey(session.subredditId, session.sessionId),
      oKey = competitionOutcomeKey(session.subredditId, session.sessionId),
      revKey = boardRevisionKey(session.subredditId, session.day);
    const retainedUntil =
      utcDayWindow(session.day).endsAtMs + RESULTS_RETENTION_MS;
    if (
      now() >= retainedUntil ||
      now() >= proposed.response.verifiedAtMs + RECEIPT_RETENTION_MS
    )
      throw new RankedRaceError(
        'expired',
        'This competition result is outside its retention window'
      );
    let name: string | undefined,
      forceConfirmation = false;
    let lowestObserved = proposed.response.finishTicks;
    let proposedOutcome: CompetitionOutcomeRecord | undefined;
    for (let attempt = 0; attempt < MAX_COMPETITION_CAS_ATTEMPTS; attempt++) {
      const [raws, storedScore] = await Promise.all([
        storage(() => deps.store.getMany([pbKey, rKey, oKey])),
        storage(() => deps.store.scoreOf(board, session.userId)),
      ]);
      if (raws.length !== 3)
        throw new RankedRaceError(
          'unavailable',
          'Competition snapshot was incomplete'
        );
      const [pbRaw, receiptRaw, outcomeRaw] = raws;
      const best = pbRaw === undefined ? null : parsePersonalBest(pbRaw),
        existingReceipt =
          receiptRaw === undefined
            ? null
            : parseVerificationReceipt(receiptRaw),
        existingOutcome =
          outcomeRaw === undefined
            ? null
            : parseCompetitionOutcomeRecord(outcomeRaw);
      const currentScore = score(storedScore);
      if (best)
        boundBest(best, { ...session, challengeId: session.challengeId });
      const accepted =
        existingReceipt ??
        existingOutcome?.receipt ??
        (best?.receipt.session.sessionId === session.sessionId
          ? best.receipt
          : proposed);
      validateCommittedReceipt(accepted, candidate);
      if (existingOutcome && !sameRace(existingOutcome.receipt, accepted))
        throw new RankedRaceError(
          'conflict',
          'A different verified replay already owns this competition outcome'
        );
      const proven: PersonalBestRecord[] = [];
      if (best) proven.push(best);
      if (existingOutcome) proven.push(existingOutcome.personalBest);
      const minimum = Math.min(
        accepted.response.finishTicks,
        ...proven.map(ticks),
        ...(currentScore === undefined ? [] : [currentScore]),
        lowestObserved
      );
      lowestObserved = minimum;
      let nextBest = proven.find((entry) => ticks(entry) === minimum);
      if (!nextBest && accepted.response.finishTicks === minimum) {
        name ??= await trustedUsername(session.userId);
        nextBest = { schemaVersion: 1, username: name, receipt: accepted };
      }
      if (!nextBest)
        throw new RankedRaceError(
          'unavailable',
          'A faster stored score lacks a matching verified proof; preserving it for reconciliation'
        );
      const existingBefore = Math.min(
        ...(best ? [ticks(best)] : []),
        ...(currentScore === undefined ? [] : [currentScore])
      );
      const previousBestTicks = Number.isFinite(existingBefore)
        ? existingBefore
        : null;
      const isPersonalBest =
        previousBestTicks === null ||
        accepted.response.finishTicks < previousBestTicks;
      const partialOwnFootprint =
        existingReceipt !== null ||
        best?.receipt.session.sessionId === session.sessionId ||
        (currentScore === accepted.response.finishTicks &&
          (!best || ticks(best) > currentScore));
      const rememberedOutcome =
        forceConfirmation &&
        partialOwnFootprint &&
        proposedOutcome &&
        sameRace(proposedOutcome.receipt, accepted)
          ? proposedOutcome
          : undefined;
      const outcome = existingOutcome ??
        rememberedOutcome ?? {
          schemaVersion: 1,
          receipt: accepted,
          personalBest: nextBest,
          outcome: {
            sessionId: session.sessionId,
            previousBestTicks,
            personalBestTicks: ticks(nextBest),
            isPersonalBest,
            improvementTicks:
              previousBestTicks === null
                ? null
                : isPersonalBest
                  ? previousBestTicks - ticks(nextBest)
                  : 0,
          },
        };
      proposedOutcome = outcome;
      const pbConsistent = best !== null && ticks(best) === minimum,
        boardConsistent = currentScore === minimum;
      if (
        existingReceipt &&
        existingOutcome &&
        pbConsistent &&
        boardConsistent &&
        !forceConfirmation
      )
        return validateCommittedReceipt(existingReceipt, candidate);
      const sets: CompetitionMutation['sets'] = [];
      if (!pbConsistent) {
        name ??= await trustedUsername(session.userId);
        nextBest = { ...nextBest, username: name };
        sets.push({
          key: pbKey,
          value: serializePersonalBest(nextBest),
          expiresAtMs: retainedUntil,
        });
      }
      if (!existingReceipt)
        sets.push({
          key: rKey,
          value: serializeVerificationReceipt(accepted),
          expiresAtMs: accepted.response.verifiedAtMs + RECEIPT_RETENTION_MS,
        });
      if (!existingOutcome)
        sets.push({
          key: oKey,
          value: serializeCompetitionOutcomeRecord(outcome),
          expiresAtMs: accepted.response.verifiedAtMs + RECEIPT_RETENTION_MS,
        });
      const mutation: CompetitionMutation = {
        expected: [
          { key: pbKey, value: pbRaw },
          { key: rKey, value: receiptRaw },
          { key: oKey, value: outcomeRaw },
        ],
        sets,
        increments:
          !pbConsistent || !boardConsistent || forceConfirmation
            ? [{ key: revKey, expiresAtMs: retainedUntil }]
            : [],
      };
      if (!boardConsistent)
        mutation.sortedSet = {
          key: board,
          member: session.userId,
          score: minimum,
          expectedScore: currentScore,
          expiresAtMs: retainedUntil,
        };
      const committed = await storage(() =>
        deps.store.compareAndSwap(mutation)
      );
      forceConfirmation = !committed;
      if (!committed) continue;
      const [confirmed, confirmedScore] = await Promise.all([
        storage(() => deps.store.getMany([pbKey, rKey, oKey])),
        storage(() => deps.store.scoreOf(board, session.userId)),
      ]);
      if (confirmed.length !== 3) {
        forceConfirmation = true;
        continue;
      }
      const [confirmedPB, confirmedReceipt, confirmedOutcome] = confirmed;
      if (
        !confirmedPB ||
        !confirmedReceipt ||
        !confirmedOutcome ||
        confirmedScore === undefined
      ) {
        forceConfirmation = true;
        continue;
      }
      const persistedBest = parsePersonalBest(confirmedPB),
        persistedOutcome = parseCompetitionOutcomeRecord(confirmedOutcome),
        persistedReceipt = parseVerificationReceipt(confirmedReceipt);
      boundBest(persistedBest, session);
      if (
        ticks(persistedBest) !== score(confirmedScore) ||
        ticks(persistedBest) > minimum ||
        !sameRace(persistedOutcome.receipt, persistedReceipt)
      ) {
        forceConfirmation = true;
        continue;
      }
      return validateCommittedReceipt(persistedReceipt, candidate);
    }
    throw new RankedRaceError(
      'unavailable',
      'Competition changed repeatedly; retry this same verified run'
    );
  }
  async function outcomeForQuery(
    query: LeaderboardQuery,
    challenge: DailyChallenge
  ): Promise<CompetitionOutcome | null> {
    if (!query.sessionId) return null;
    const context = actor();
    const raw = await storage(() =>
      deps.store.get(receiptKey(context.subredditId, query.sessionId ?? ''))
    );
    if (raw === undefined) return null;
    const receipt = parseVerificationReceipt(raw);
    own(receipt);
    if (
      receipt.session.challengeId !== challenge.id ||
      receipt.session.challengeHash !== challenge.challengeHash
    )
      throw new RankedRaceError(
        'forbidden',
        'This result belongs to a different immutable challenge'
      );
    if (now() >= receipt.response.verifiedAtMs + RECEIPT_RETENTION_MS)
      return null;
    // Query-only legacy adoption and reconciliation: the already verified tape
    // is never re-executed and #10's original receipt remains unchanged.
    await commitVerified({
      session: receipt.session,
      replayFingerprint: receipt.replayFingerprint,
      response: receipt.response,
    });
    const stored = await storage(() =>
      deps.store.get(
        competitionOutcomeKey(context.subredditId, query.sessionId ?? '')
      )
    );
    if (stored === undefined)
      throw new RankedRaceError(
        'unavailable',
        'The accepted competition outcome is not yet confirmed'
      );
    const result = parseCompetitionOutcomeRecord(stored);
    if (!sameRace(result.receipt, receipt))
      throw new RankedRaceError(
        'integrity',
        'Competition outcome disagrees with its retained receipt'
      );
    return result.outcome;
  }
  function members(
    values: CompetitionMember[],
    maximum: number
  ): CompetitionMember[] {
    if (values.length > maximum)
      throw new RankedRaceError(
        'integrity',
        'Leaderboard storage returned an oversized window'
      );
    const seen = new Set<string>();
    for (let index = 0; index < values.length; index++) {
      const entry = values[index],
        previous = values[index - 1];
      if (
        !entry ||
        !userId(entry.member) ||
        !competitionTicks(entry.score) ||
        seen.has(entry.member) ||
        (previous &&
          (entry.score < previous.score ||
            (entry.score === previous.score &&
              entry.member <= previous.member)))
      )
        throw new RankedRaceError(
          'integrity',
          'Leaderboard storage order or score is invalid'
        );
      seen.add(entry.member);
    }
    return values;
  }
  async function getLeaderboard(input?: unknown): Promise<LeaderboardView> {
    const query = parseLeaderboardQuery(input),
      context = deps.context;
    scope(context.subredditId);
    if (!/^t3_[a-z0-9]+$/.test(context.postId))
      throw new RankedRaceError(
        'integrity',
        'Competition needs an originating post'
      );
    if (query.sessionId) actor();
    let challenge: DailyChallenge;
    try {
      challenge = (await deps.daily.getForPost(context)).challenge;
    } catch (error) {
      if (
        error instanceof DailyChallengeError &&
        (error.kind === 'integrity' || error.kind === 'unsupported')
      )
        throw new RankedRaceError(error.kind, error.message);
      throw new RankedRaceError(
        'unavailable',
        'The post-bound leaderboard challenge is unavailable'
      );
    }
    const board = leaderboardKey(context.subredditId, challenge.day),
      revKey = boardRevisionKey(context.subredditId, challenge.day),
      retainedUntilMs = challenge.endsAtMs + RESULTS_RETENTION_MS;
    const viewer = userId(context.userId) ? 'signed-in' : 'signed-out';
    const empty = (): LeaderboardView => {
      const serverNowMs = now();
      return {
        challengeId: challenge.id,
        challengeHash: challenge.challengeHash,
        day: challenge.day,
        simulationHz: 120,
        serverNowMs,
        retainedUntilMs,
        status: serverNowMs >= retainedUntilMs ? 'expired' : 'available',
        viewer,
        top: [],
        me: null,
        nearby: [],
        outcome: null,
      };
    };
    if (now() >= retainedUntilMs) return parseLeaderboardView(empty());
    const outcome = await outcomeForQuery(query, challenge);
    for (let attempt = 0; attempt < MAX_LEADERBOARD_READ_ATTEMPTS; attempt++) {
      const before = revision(await storage(() => deps.store.get(revKey)));
      const [topRaw, ownRank, ownScore, ownPB] = await Promise.all([
        storage(() => deps.store.rangeByRank(board, 0, 19)),
        userId(context.userId)
          ? storage(() => deps.store.rankOf(board, context.userId ?? ''))
          : Promise.resolve(undefined),
        userId(context.userId)
          ? storage(() => deps.store.scoreOf(board, context.userId ?? ''))
          : Promise.resolve(undefined),
        userId(context.userId)
          ? storage(() =>
              deps.store.get(
                personalBestKey(
                  context.subredditId,
                  challenge.day,
                  context.userId ?? ''
                )
              )
            )
          : Promise.resolve(undefined),
      ]);
      const top = members(topRaw, 20);
      let inconsistent = false;
      if (
        ownRank !== undefined &&
        (!Number.isSafeInteger(ownRank) || ownRank < 0)
      )
        throw new RankedRaceError(
          'integrity',
          'Player leaderboard index is invalid'
        );
      if (
        (ownRank === undefined) !== (ownScore === undefined) ||
        (ownRank === undefined) !== (ownPB === undefined)
      )
        inconsistent = true;
      score(ownScore);
      let nearbyRaw: CompetitionMember[] = [],
        nearbyStart = 0;
      if (ownRank !== undefined) {
        const start = Math.max(0, ownRank - 6);
        const surrounding = members(
          await storage(() =>
            deps.store.rangeByRank(board, start, ownRank + 6)
          ),
          13
        );
        const self = surrounding.findIndex(
          (entry) => entry.member === context.userId
        );
        if (self < 0) inconsistent = true;
        const trim = Math.max(0, Math.min(self - 3, surrounding.length - 7));
        nearbyRaw = surrounding.slice(trim, trim + 7);
        nearbyStart = start + trim;
      }
      let firstNearbyRank = 0;
      const firstNearby = nearbyRaw[0];
      if (firstNearby) {
        const firstTie = await storage(() =>
          deps.store.firstAtScore(board, firstNearby.score)
        );
        const index = firstTie
          ? await storage(() => deps.store.rankOf(board, firstTie.member))
          : undefined;
        if (
          !firstTie ||
          !userId(firstTie.member) ||
          firstTie.score !== firstNearby.score ||
          index === undefined ||
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index > nearbyStart
        )
          inconsistent = true;
        else firstNearbyRank = index + 1;
      }
      const all = new Map<string, CompetitionMember>();
      for (const entry of [...top, ...nearbyRaw]) {
        const previous = all.get(entry.member);
        if (previous && previous.score !== entry.score) inconsistent = true;
        all.set(entry.member, entry);
      }
      const unique = [...all.values()],
        names = new Map<string, string>();
      const profileKeys = unique.map((entry) =>
        personalBestKey(context.subredditId, challenge.day, entry.member)
      );
      const batches: Promise<(string | undefined)[]>[] = [];
      for (let index = 0; index < profileKeys.length; index += 8)
        batches.push(
          storage(() => deps.store.getMany(profileKeys.slice(index, index + 8)))
        );
      const profiles = (await Promise.all(batches)).flat();
      if (profiles.length !== unique.length) inconsistent = true;
      for (let index = 0; index < unique.length; index++) {
        const entry = unique[index],
          raw = profiles[index];
        if (!entry || raw === undefined) {
          inconsistent = true;
          continue;
        }
        const best = parsePersonalBest(raw);
        boundBest(best, {
          userId: entry.member,
          subredditId: context.subredditId,
          challengeId: challenge.id,
          challengeHash: challenge.challengeHash,
        });
        if (ticks(best) !== entry.score) inconsistent = true;
        names.set(entry.member, best.username);
      }
      const after = revision(await storage(() => deps.store.get(revKey)));
      if (before !== after) continue;
      if (now() >= retainedUntilMs) return parseLeaderboardView(empty());
      if (inconsistent)
        throw new RankedRaceError(
          'unavailable',
          'Leaderboard records are not yet a consistent snapshot'
        );
      const makeRows = (
        entries: CompetitionMember[],
        start: number,
        firstRank?: number
      ): LeaderboardRow[] => {
        let rank = firstRank ?? start + 1;
        return entries.map((entry, index) => {
          const previous = entries[index - 1];
          if (previous && previous.score !== entry.score)
            rank = start + index + 1;
          const username = names.get(entry.member);
          if (!username)
            throw new RankedRaceError(
              'unavailable',
              'Trusted racer profile is unavailable'
            );
          return {
            username,
            finishTicks: entry.score,
            rank,
            isSelf: entry.member === context.userId,
          };
        });
      };
      const topRows = makeRows(top, 0),
        nearby = makeRows(nearbyRaw, nearbyStart, firstNearbyRank),
        me = nearby.find((entry) => entry.isSelf) ?? null;
      if (ownPB !== undefined && !me)
        throw new RankedRaceError(
          'unavailable',
          'The player could not be located in the confirmed standings'
        );
      const metadata = empty();
      if (metadata.status === 'expired') return parseLeaderboardView(metadata);
      return parseLeaderboardView({
        ...metadata,
        top: topRows,
        me,
        nearby,
        outcome,
      });
    }
    throw new RankedRaceError(
      'unavailable',
      'Leaderboard is updating; refresh the standings'
    );
  }
  return { commitVerified, getLeaderboard };
}
