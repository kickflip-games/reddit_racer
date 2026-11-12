import {
  dailyChallengeId,
  DAY_MILLISECONDS,
  utcDay,
  utcDayWindow,
} from './daily-challenge.ts';
import {
  isRankedHash,
  isRankedSessionId,
  RankedRaceError,
} from './ranked-race.ts';
import { MAX_SIMULATION_TICKS } from './simulation.ts';

export const RESULTS_RETENTION_MS = 90 * DAY_MILLISECONDS;
export type LeaderboardQuery = { sessionId?: string };
export type LeaderboardRow = {
  username: string;
  finishTicks: number;
  rank: number;
  isSelf: boolean;
};
export type CompetitionOutcome = {
  sessionId: string;
  previousBestTicks: number | null;
  personalBestTicks: number;
  isPersonalBest: boolean;
  improvementTicks: number | null;
};
export type LeaderboardView = {
  challengeId: string;
  challengeHash: string;
  day: string;
  simulationHz: 120;
  serverNowMs: number;
  retainedUntilMs: number;
  status: 'available' | 'expired';
  viewer: 'signed-in' | 'signed-out';
  top: LeaderboardRow[];
  me: LeaderboardRow | null;
  nearby: LeaderboardRow[];
  outcome: CompetitionOutcome | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fields(
  value: Record<string, unknown>,
  keys: string[],
  kind: 'invalid' | 'integrity' = 'integrity'
): void {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new RankedRaceError(
      kind,
      'Competition fields are missing or unsupported'
    );
}
export function competitionTicks(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_SIMULATION_TICKS
  );
}
export function competitionUsername(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 64
  );
}
export function parseLeaderboardQuery(value: unknown): LeaderboardQuery {
  if (value === undefined) return {};
  if (!record(value) || Object.keys(value).some((key) => key !== 'sessionId'))
    throw new RankedRaceError(
      'invalid',
      'Leaderboard requests are bound to their originating post'
    );
  if (value.sessionId === undefined) return {};
  if (!isRankedSessionId(value.sessionId))
    throw new RankedRaceError(
      'invalid',
      'Competition result session ID is invalid'
    );
  return { sessionId: value.sessionId };
}
export function parseCompetitionOutcome(value: unknown): CompetitionOutcome {
  if (!record(value))
    throw new RankedRaceError('integrity', 'Competition outcome is malformed');
  fields(value, [
    'sessionId',
    'previousBestTicks',
    'personalBestTicks',
    'isPersonalBest',
    'improvementTicks',
  ]);
  if (
    !isRankedSessionId(value.sessionId) ||
    !competitionTicks(value.personalBestTicks) ||
    (value.previousBestTicks !== null &&
      !competitionTicks(value.previousBestTicks)) ||
    typeof value.isPersonalBest !== 'boolean' ||
    (value.improvementTicks !== null &&
      (typeof value.improvementTicks !== 'number' ||
        !Number.isInteger(value.improvementTicks) ||
        value.improvementTicks < 0))
  )
    throw new RankedRaceError(
      'integrity',
      'Competition outcome values are invalid'
    );
  if (value.previousBestTicks === null) {
    if (!value.isPersonalBest || value.improvementTicks !== null)
      throw new RankedRaceError(
        'integrity',
        'First personal-best outcome is inconsistent'
      );
  } else if (value.isPersonalBest) {
    if (
      value.personalBestTicks >= value.previousBestTicks ||
      value.improvementTicks !==
        value.previousBestTicks - value.personalBestTicks
    )
      throw new RankedRaceError(
        'integrity',
        'Personal-best improvement is inconsistent'
      );
  } else if (
    value.personalBestTicks !== value.previousBestTicks ||
    value.improvementTicks !== 0
  )
    throw new RankedRaceError(
      'integrity',
      'Unchanged personal-best outcome is inconsistent'
    );
  return {
    sessionId: value.sessionId,
    previousBestTicks: value.previousBestTicks,
    personalBestTicks: value.personalBestTicks,
    isPersonalBest: value.isPersonalBest,
    improvementTicks: value.improvementTicks,
  };
}
function row(value: unknown): LeaderboardRow {
  if (!record(value))
    throw new RankedRaceError('integrity', 'Leaderboard row is malformed');
  fields(value, ['username', 'finishTicks', 'rank', 'isSelf']);
  if (
    !competitionUsername(value.username) ||
    !competitionTicks(value.finishTicks) ||
    typeof value.rank !== 'number' ||
    !Number.isSafeInteger(value.rank) ||
    value.rank < 1 ||
    typeof value.isSelf !== 'boolean'
  )
    throw new RankedRaceError('integrity', 'Leaderboard row is invalid');
  return {
    username: value.username,
    finishTicks: value.finishTicks,
    rank: value.rank,
    isSelf: value.isSelf,
  };
}
function rows(value: unknown, maximum: number): LeaderboardRow[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new RankedRaceError(
      'integrity',
      'Leaderboard result window is invalid'
    );
  const parsed = value.map(row);
  for (let index = 1; index < parsed.length; index++) {
    const previous = parsed[index - 1],
      current = parsed[index];
    if (
      !previous ||
      !current ||
      current.finishTicks < previous.finishTicks ||
      (current.finishTicks === previous.finishTicks &&
        current.rank !== previous.rank) ||
      (current.finishTicks > previous.finishTicks &&
        current.rank <= previous.rank)
    )
      throw new RankedRaceError(
        'integrity',
        'Leaderboard rank ordering is inconsistent'
      );
  }
  if (parsed.filter((entry) => entry.isSelf).length > 1)
    throw new RankedRaceError(
      'integrity',
      'Leaderboard contains duplicate player rows'
    );
  return parsed;
}
export function parseLeaderboardView(value: unknown): LeaderboardView {
  if (!record(value))
    throw new RankedRaceError('integrity', 'Leaderboard response is malformed');
  fields(value, [
    'challengeId',
    'challengeHash',
    'day',
    'simulationHz',
    'serverNowMs',
    'retainedUntilMs',
    'status',
    'viewer',
    'top',
    'me',
    'nearby',
    'outcome',
  ]);
  if (
    typeof value.challengeId !== 'string' ||
    !isRankedHash(value.challengeHash) ||
    typeof value.day !== 'string' ||
    value.simulationHz !== 120 ||
    typeof value.serverNowMs !== 'number' ||
    !Number.isSafeInteger(value.serverNowMs) ||
    value.serverNowMs < 0 ||
    typeof value.retainedUntilMs !== 'number' ||
    !Number.isSafeInteger(value.retainedUntilMs) ||
    (value.status !== 'available' && value.status !== 'expired') ||
    (value.viewer !== 'signed-in' && value.viewer !== 'signed-out')
  )
    throw new RankedRaceError(
      'integrity',
      'Leaderboard identity or retention metadata is invalid'
    );
  try {
    utcDay(value.serverNowMs);
    const scope = value.challengeId.split(':')[0];
    if (
      !scope ||
      dailyChallengeId(scope, value.day) !== value.challengeId ||
      value.retainedUntilMs !==
        utcDayWindow(value.day).endsAtMs + RESULTS_RETENTION_MS ||
      (value.status === 'expired') !==
        value.serverNowMs >= value.retainedUntilMs
    )
      throw new Error('identity');
  } catch {
    throw new RankedRaceError(
      'integrity',
      'Leaderboard challenge window is inconsistent'
    );
  }
  const top = rows(value.top, 20),
    nearby = rows(value.nearby, 7),
    me = value.me === null ? null : row(value.me),
    outcome =
      value.outcome === null ? null : parseCompetitionOutcome(value.outcome);
  for (let index = 0; index < top.length; index++) {
    const current = top[index],
      previous = top[index - 1];
    if (
      current &&
      current.rank !==
        (previous?.finishTicks === current.finishTicks
          ? previous.rank
          : index + 1)
    )
      throw new RankedRaceError(
        'integrity',
        'Top competition ranks are inconsistent'
      );
  }
  if (
    me &&
    (!me.isSelf ||
      !nearby.some(
        (entry) =>
          entry.isSelf &&
          entry.username === me.username &&
          entry.finishTicks === me.finishTicks &&
          entry.rank === me.rank
      ))
  )
    throw new RankedRaceError(
      'integrity',
      'Player row does not match its nearby window'
    );
  if (!me && nearby.length)
    throw new RankedRaceError(
      'integrity',
      'Nearby racers require a personal best'
    );
  if (
    value.viewer === 'signed-out' &&
    (me || nearby.length || outcome || top.some((entry) => entry.isSelf))
  )
    throw new RankedRaceError(
      'integrity',
      'Signed-out response contains private competition data'
    );
  if (
    value.status === 'expired' &&
    (top.length || me || nearby.length || outcome)
  )
    throw new RankedRaceError(
      'integrity',
      'Expired results must not contain retained scores'
    );
  return {
    challengeId: value.challengeId,
    challengeHash: value.challengeHash,
    day: value.day,
    simulationHz: 120,
    serverNowMs: value.serverNowMs,
    retainedUntilMs: value.retainedUntilMs,
    status: value.status,
    viewer: value.viewer,
    top,
    me,
    nearby,
    outcome,
  };
}
