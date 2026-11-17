import { RANKED_ROLLOVER_GRACE, utcDay, utcDayWindow } from './daily-challenge';
import {
  competitionTicks,
  competitionUsername,
  RESULTS_RETENTION_MS,
  type LeaderboardRow,
} from './leaderboard';
import { RankedRaceError } from './ranked-race';

export const ARCHIVE_PAGE_SIZE = 20;
export const ARCHIVE_MAX_OFFSET = 100_000;
export type DailyStandingsQuery = { day?: string; offset?: number };
export type DailyStandingsView = {
  day: string;
  minDay: string;
  maxDay: string;
  offset: number;
  serverNowMs: number;
  retainedUntilMs: number;
  status: 'available' | 'empty' | 'missing' | 'expired' | 'unavailable';
  provisional: boolean;
  rows: LeaderboardRow[];
  nextOffset: number | null;
  hasMore: boolean;
  postUrl: string | null;
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fail(): never {
  throw new RankedRaceError(
    'invalid',
    'Invalid daily standings request or response'
  );
}
export function parseDailyStandingsQuery(value: unknown): DailyStandingsQuery {
  if (value === undefined) return {};
  if (
    !record(value) ||
    Object.keys(value).some((k) => k !== 'day' && k !== 'offset')
  )
    return fail();
  if (value.day !== undefined) {
    if (typeof value.day !== 'string') return fail();
    try {
      utcDayWindow(value.day);
    } catch {
      return fail();
    }
  }
  if (
    value.offset !== undefined &&
    (typeof value.offset !== 'number' ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0 ||
      value.offset > ARCHIVE_MAX_OFFSET ||
      value.offset % ARCHIVE_PAGE_SIZE !== 0)
  )
    return fail();
  return {
    ...(typeof value.day === 'string' ? { day: value.day } : {}),
    ...(typeof value.offset === 'number' ? { offset: value.offset } : {}),
  };
}
export function archiveDayBounds(now: number): {
  minDay: string;
  maxDay: string;
} {
  const today = utcDayWindow(utcDay(now)).startsAtMs;
  return {
    minDay: utcDay(today - RESULTS_RETENTION_MS),
    maxDay: utcDay(today),
  };
}
export function parseDailyStandingsView(value: unknown): DailyStandingsView {
  if (!record(value)) return fail();
  const fields = [
    'day',
    'minDay',
    'maxDay',
    'offset',
    'serverNowMs',
    'retainedUntilMs',
    'status',
    'provisional',
    'rows',
    'nextOffset',
    'hasMore',
    'postUrl',
  ];
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((k) => !Object.hasOwn(value, k))
  )
    return fail();
  const query = parseDailyStandingsQuery({
    day: value.day,
    offset: value.offset,
  });
  if (
    !query.day ||
    query.offset === undefined ||
    typeof value.serverNowMs !== 'number' ||
    !Number.isSafeInteger(value.serverNowMs) ||
    value.serverNowMs < 0
  )
    return fail();
  const bounds = archiveDayBounds(value.serverNowMs),
    end = utcDayWindow(query.day).endsAtMs;
  if (
    query.day > bounds.maxDay ||
    value.minDay !== bounds.minDay ||
    value.maxDay !== bounds.maxDay ||
    value.retainedUntilMs !== end + RESULTS_RETENTION_MS ||
    value.provisional !== value.serverNowMs < end + RANKED_ROLLOVER_GRACE
  )
    return fail();
  const status = value.status;
  if (
    status !== 'available' &&
    status !== 'empty' &&
    status !== 'missing' &&
    status !== 'expired' &&
    status !== 'unavailable'
  )
    return fail();
  if (
    (status === 'expired') !==
    value.serverNowMs >= end + RESULTS_RETENTION_MS
  )
    return fail();
  if (!Array.isArray(value.rows) || value.rows.length > ARCHIVE_PAGE_SIZE)
    return fail();
  const rows: LeaderboardRow[] = [];
  for (const raw of value.rows) {
    if (
      !record(raw) ||
      Object.keys(raw).length !== 4 ||
      !competitionUsername(raw.username) ||
      !competitionTicks(raw.finishTicks) ||
      typeof raw.rank !== 'number' ||
      !Number.isSafeInteger(raw.rank) ||
      raw.rank < 1 ||
      typeof raw.isSelf !== 'boolean'
    )
      return fail();
    const previous = rows.at(-1),
      position = query.offset + rows.length + 1;
    if (
      raw.rank > position ||
      (rows.length === 0 && query.offset === 0 && raw.rank !== 1) ||
      (previous &&
        (raw.finishTicks < previous.finishTicks ||
          raw.rank !==
            (raw.finishTicks === previous.finishTicks
              ? previous.rank
              : position)))
    )
      return fail();
    rows.push({
      username: raw.username,
      finishTicks: raw.finishTicks,
      rank: raw.rank,
      isSelf: raw.isSelf,
    });
  }
  if (
    (status === 'available') !== rows.length > 0 ||
    rows.filter((r) => r.isSelf).length > 1
  )
    return fail();
  if (
    value.nextOffset !== null &&
    (value.nextOffset !== query.offset + ARCHIVE_PAGE_SIZE ||
      rows.length !== ARCHIVE_PAGE_SIZE ||
      value.nextOffset > ARCHIVE_MAX_OFFSET)
  )
    return fail();
  if (
    typeof value.hasMore !== 'boolean' ||
    (value.hasMore && value.rows.length !== ARCHIVE_PAGE_SIZE) ||
    (!value.hasMore && value.nextOffset !== null)
  )
    return fail();
  if (
    value.postUrl !== null &&
    (typeof value.postUrl !== 'string' ||
      !/^https:\/\/www\.reddit\.com\/comments\/[a-z0-9]+\/$/.test(
        value.postUrl
      ))
  )
    return fail();
  return {
    day: query.day,
    ...bounds,
    offset: query.offset,
    serverNowMs: value.serverNowMs,
    retainedUntilMs: end + RESULTS_RETENTION_MS,
    status,
    provisional: value.serverNowMs < end + RANKED_ROLLOVER_GRACE,
    rows,
    hasMore: value.hasMore,
    nextOffset: typeof value.nextOffset === 'number' ? value.nextOffset : null,
    postUrl: typeof value.postUrl === 'string' ? value.postUrl : null,
  };
}
