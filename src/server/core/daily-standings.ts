import {
  RANKED_ROLLOVER_GRACE,
  utcDayWindow,
  validateSubredditId,
} from '../../shared/daily-challenge';
import {
  ARCHIVE_MAX_OFFSET,
  ARCHIVE_PAGE_SIZE,
  archiveDayBounds,
  parseDailyStandingsQuery,
  parseDailyStandingsView,
  type DailyStandingsView,
} from '../../shared/daily-standings';
import {
  competitionTicks,
  RESULTS_RETENTION_MS,
  type LeaderboardRow,
} from '../../shared/leaderboard';
import { RankedRaceError } from '../../shared/ranked-race';
import { canonicalRacePostUrl } from '../../shared/today-race-post';
import {
  boardRevisionKey,
  boundBest,
  leaderboardKey,
  parsePersonalBest,
  personalBestKey,
  type CompetitionStore,
} from './competition';
import type { DailyChallengeService } from './daily-challenges';
import type { TrustedRacePost } from './today-race-posts';

export type DailyStandingsDependencies = {
  context: { subredditId: string; userId?: string };
  daily: Pick<DailyChallengeService, 'read'>;
  store: Pick<
    CompetitionStore,
    'get' | 'getMany' | 'rangeByRank' | 'firstAtScore' | 'rankOf'
  >;
  now: () => number;
  readPost: (input: {
    subredditId: string;
    day: string;
  }) => Promise<TrustedRacePost | undefined>;
};
function revision(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid board revision');
  return Number(value);
}
/** Read only: no generation, registration, admission or score writes. */
export function createDailyStandingsService(deps: DailyStandingsDependencies) {
  return async (input?: unknown): Promise<DailyStandingsView> => {
    const query = parseDailyStandingsQuery(input),
      now = deps.now();
    validateSubredditId(deps.context.subredditId);
    const bounds = archiveDayBounds(now),
      day = query.day ?? bounds.maxDay,
      offset = query.offset ?? 0;
    if (day > bounds.maxDay)
      throw new RankedRaceError(
        'invalid',
        'Leaderboard dates cannot be after today UTC'
      );
    const end = utcDayWindow(day).endsAtMs,
      retainedUntilMs = end + RESULTS_RETENTION_MS;
    const base = (
      status: DailyStandingsView['status'],
      rows: LeaderboardRow[] = [],
      nextOffset: number | null = null,
      postUrl: string | null = null,
      hasMore = false
    ): DailyStandingsView =>
      parseDailyStandingsView({
        day,
        ...archiveDayBounds(deps.now()),
        offset,
        serverNowMs: deps.now(),
        retainedUntilMs,
        status,
        provisional: deps.now() < end + RANKED_ROLLOVER_GRACE,
        rows,
        nextOffset,
        postUrl,
        hasMore,
      });
    if (now >= retainedUntilMs) return base('expired');
    try {
      const challenge = await deps.daily.read({
        subredditId: deps.context.subredditId,
        day,
      });
      if (!challenge) return base('missing');
      if (
        challenge.day !== day ||
        challenge.subredditId !== deps.context.subredditId
      )
        throw new Error('Wrong stored daily');
      let postUrl: string | null = null;
      try {
        const post = await deps.readPost({
          subredditId: deps.context.subredditId,
          day,
        });
        if (
          post?.available &&
          post.subredditId === deps.context.subredditId &&
          utcDayWindow(day).startsAtMs <= post.createdAtMs &&
          post.createdAtMs < end
        )
          postUrl = canonicalRacePostUrl(post.id);
      } catch {
        /* Optional navigation never invalidates verified standings. */
      }
      const board = leaderboardKey(deps.context.subredditId, day),
        rev = boardRevisionKey(deps.context.subredditId, day);
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = revision(await deps.store.get(rev));
        const entries = await deps.store.rangeByRank(
          board,
          offset,
          offset + ARCHIVE_PAGE_SIZE
        );
        if (entries.length > ARCHIVE_PAGE_SIZE + 1)
          throw new Error('Oversized page');
        const seen = new Set<string>();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i],
            p = entries[i - 1];
          if (
            !e ||
            !/^t2_[a-z0-9]+$/.test(e.member) ||
            !competitionTicks(e.score) ||
            seen.has(e.member) ||
            (p &&
              (e.score < p.score ||
                (e.score === p.score && e.member <= p.member)))
          )
            throw new Error('Invalid sorted page');
          seen.add(e.member);
        }
        const visible = entries.slice(0, ARCHIVE_PAGE_SIZE),
          first = visible[0];
        let firstRank = offset + 1;
        if (first) {
          const tie = await deps.store.firstAtScore(board, first.score);
          const index = tie
            ? await deps.store.rankOf(board, tie.member)
            : undefined;
          if (
            !tie ||
            tie.score !== first.score ||
            !/^t2_[a-z0-9]+$/.test(tie.member) ||
            index === undefined ||
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index > offset
          )
            throw new Error('Invalid tie rank');
          firstRank = index + 1;
        }
        const raws: string[] = [];
        // SDK bounded multi-get, at most 20 retained profiles per page.
        for (let i = 0; i < visible.length; i += 8) {
          const batch = visible.slice(i, i + 8);
          const values = await deps.store.getMany(
            batch.map((e) =>
              personalBestKey(deps.context.subredditId, day, e.member)
            )
          );
          if (
            values.length !== batch.length ||
            values.some((v) => v === undefined)
          )
            throw new Error('Missing trusted profile');
          for (const value of values) if (value !== undefined) raws.push(value);
        }
        const rows: LeaderboardRow[] = [];
        let rank = firstRank;
        for (let i = 0; i < visible.length; i++) {
          const e = visible[i],
            raw = raws[i];
          if (!e || raw === undefined) throw new Error('Missing profile');
          const pb = parsePersonalBest(raw);
          boundBest(pb, {
            userId: e.member,
            subredditId: deps.context.subredditId,
            challengeId: challenge.id,
            challengeHash: challenge.challengeHash,
          });
          if (pb.receipt.response.finishTicks !== e.score)
            throw new Error('Score disagrees with receipt');
          if (i > 0 && visible[i - 1]?.score !== e.score) rank = offset + i + 1;
          rows.push({
            username: pb.username,
            finishTicks: e.score,
            rank,
            isSelf: e.member === deps.context.userId,
          });
        }
        const after = revision(await deps.store.get(rev));
        if (before !== after) continue;
        if (deps.now() >= retainedUntilMs) return base('expired');
        return base(
          rows.length ? 'available' : 'empty',
          rows,
          entries.length > ARCHIVE_PAGE_SIZE && offset < ARCHIVE_MAX_OFFSET
            ? offset + ARCHIVE_PAGE_SIZE
            : null,
          postUrl,
          entries.length > ARCHIVE_PAGE_SIZE
        );
      }
      return base('unavailable');
    } catch {
      return base(deps.now() >= retainedUntilMs ? 'expired' : 'unavailable');
    }
  };
}
