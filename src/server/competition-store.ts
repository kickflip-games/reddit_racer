import { redis } from '@devvit/web/server';
import { RankedRaceError } from '../shared/ranked-race';
import type {
  CompetitionMember,
  CompetitionMutation,
  CompetitionStore,
} from './core/competition';

type SetOptions = { expiration?: Date };
export type CompetitionTransaction = {
  multi: () => Promise<void>;
  set: (key: string, value: string, options?: SetOptions) => Promise<unknown>;
  zAdd: (key: string, ...members: CompetitionMember[]) => Promise<unknown>;
  incrBy: (key: string, increment: number) => Promise<unknown>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  exec: () => Promise<unknown>;
  discard: () => Promise<void>;
  unwatch: () => Promise<unknown>;
};
/** Structural subset implemented by the installed Devvit 0.15.3 client. */
export type CompetitionRedis = {
  get: (key: string) => Promise<string | null | undefined>;
  mGet: (keys: string[]) => Promise<(string | null)[]>;
  type: (key: string) => Promise<string>;
  watch: (...keys: string[]) => Promise<CompetitionTransaction>;
  zRange: (
    key: string,
    start: number,
    stop: number,
    options?: {
      by: 'rank' | 'score';
      limit?: { offset: number; count: number };
    }
  ) => Promise<CompetitionMember[]>;
  zRank: (key: string, member: string) => Promise<number | null | undefined>;
  zScore: (key: string, member: string) => Promise<number | null | undefined>;
  /** Pinned hosted SDK 0.15.3 returns remaining TTL seconds, despite this name. */
  expireTime: (key: string) => Promise<number>;
};

function unavailable(): RankedRaceError {
  return new RankedRaceError(
    'unavailable',
    'Competition storage is unavailable.'
  );
}
function integrity(): RankedRaceError {
  return new RankedRaceError(
    'integrity',
    'Stored competition data is invalid.'
  );
}
function key(value: string): void {
  if (
    !value.length ||
    value.length > 256 ||
    /\s/.test(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    throw integrity();
}
function integer(value: unknown, minimum = 0): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
  );
}
function stringValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw integrity();
  return value;
}
function score(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (!integer(value, 1)) throw integrity();
  return value;
}
function rank(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (!integer(value)) throw integrity();
  return value;
}
function members(value: unknown, maximum: number): CompetitionMember[] {
  if (!Array.isArray(value) || value.length > maximum) throw integrity();
  return value.map((item: unknown) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('member' in item) ||
      !('score' in item) ||
      typeof item.member !== 'string' ||
      !item.member.length ||
      item.member.length > 128 ||
      !integer(item.score, 1)
    )
      throw integrity();
    return { member: item.member, score: item.score };
  });
}
function expireReply(value: unknown): boolean {
  // Hosted SDK 0.15.3 acknowledges queued EXPIRE with nil. Only these known
  // EXPIRE positions accept it; mandatory expireTime/readback below proves TTL.
  return value === null || value === 1 || value === true || value === 'OK';
}

/** Fixed hosted contract: remaining seconds, never an absolute epoch timestamp. */
export function hasExpectedRemainingTtl(
  remainingSeconds: unknown,
  expiresAtMs: number,
  nowMs: number
): boolean {
  if (
    !integer(remainingSeconds, 1) ||
    !integer(expiresAtMs) ||
    !integer(nowMs) ||
    expiresAtMs <= nowMs
  )
    return false;
  const expected = (expiresAtMs - nowMs) / 1000;
  // One second accounts for SET/TTL rounding. Queued relative expiry may start
  // later, bounded by the platform's five-second transaction execution budget.
  const minimum = Math.max(1, Math.floor(expected) - 1);
  const maximum = Math.ceil(expected) + 5;
  return remainingSeconds >= minimum && remainingSeconds <= maximum;
}

export function createCompetitionStore(
  client: CompetitionRedis = redis,
  now: () => number = Date.now
): CompetitionStore {
  async function getMany(keys: string[]): Promise<(string | undefined)[]> {
    if (keys.length > 100) throw integrity();
    keys.forEach(key);
    if (!keys.length) return [];
    const values: unknown = await client.mGet(keys);
    if (!Array.isArray(values) || values.length !== keys.length)
      throw integrity();
    return values.map((value: unknown) => stringValue(value));
  }
  return {
    get: async (name) => {
      key(name);
      return stringValue(await client.get(name));
    },
    getMany,
    rangeByRank: async (name, start, stop) => {
      key(name);
      if (
        !integer(start) ||
        !integer(stop) ||
        stop < start ||
        stop - start >= 100
      )
        throw integrity();
      return members(
        await client.zRange(name, start, stop, { by: 'rank' }),
        stop - start + 1
      );
    },
    firstAtScore: async (name, value) => {
      key(name);
      if (!integer(value, 1)) throw integrity();
      const result = members(
        await client.zRange(name, value, value, {
          by: 'score',
          limit: { offset: 0, count: 1 },
        }),
        1
      );
      if (result[0] && result[0].score !== value) throw integrity();
      return result[0];
    },
    rankOf: async (name, member) => {
      key(name);
      return rank(await client.zRank(name, member));
    },
    scoreOf: async (name, member) => {
      key(name);
      return score(await client.zScore(name, member));
    },
    async compareAndSwap(mutation: CompetitionMutation): Promise<boolean> {
      if (
        !mutation.expected.length ||
        mutation.expected.length > 8 ||
        (!mutation.sets.length &&
          !mutation.sortedSet &&
          !mutation.increments.length) ||
        mutation.sets.length > 8 ||
        mutation.increments.length > 2
      )
        throw integrity();
      const expected = new Map(
        mutation.expected.map((entry) => [entry.key, entry.value])
      );
      if (expected.size !== mutation.expected.length) throw integrity();
      const written = new Set<string>();
      for (const entry of mutation.expected) {
        key(entry.key);
        if (entry.value !== undefined && typeof entry.value !== 'string')
          throw integrity();
      }
      for (const entry of mutation.sets) {
        key(entry.key);
        if (
          !expected.has(entry.key) ||
          written.has(entry.key) ||
          !entry.value.length ||
          entry.value.length > 16_384
        )
          throw integrity();
        written.add(entry.key);
      }
      for (const entry of mutation.increments) {
        key(entry.key);
        if (written.has(entry.key)) throw integrity();
        written.add(entry.key);
      }
      if (mutation.sortedSet) {
        key(mutation.sortedSet.key);
        if (
          written.has(mutation.sortedSet.key) ||
          !mutation.sortedSet.member.length ||
          mutation.sortedSet.member.length > 128 ||
          !integer(mutation.sortedSet.score, 1) ||
          (mutation.sortedSet.expectedScore !== undefined &&
            !integer(mutation.sortedSet.expectedScore, 1))
        )
          throw integrity();
      }
      const expiring = [
        ...mutation.sets,
        ...mutation.increments,
        ...(mutation.sortedSet ? [mutation.sortedSet] : []),
      ];
      const validDeadlines = () =>
        expiring.every(
          (entry) =>
            integer(entry.expiresAtMs, now() + 1) &&
            Number.isFinite(new Date(entry.expiresAtMs + 1000).getTime())
        );
      if (!validDeadlines()) return false;

      let tx: CompetitionTransaction | undefined;
      let queued = false,
        executed = false;
      try {
        tx = await client.watch(...expected.keys());
        // TxClient.get/zScore are builders even before MULTI in SDK 0.15.3.
        for (const name of expected.keys()) {
          const type = await client.type(name);
          if (type !== 'none' && type !== 'string') throw integrity();
        }
        // SDK mGet maps empty strings to null, so it cannot establish exact CAS absence.
        const current = await Promise.all(
          [...expected.keys()].map(async (name) =>
            stringValue(await client.get(name))
          )
        );
        if (
          current.some(
            (value, index) => value !== mutation.expected[index]?.value
          )
        )
          return false;
        if (mutation.sortedSet) {
          const type = await client.type(mutation.sortedSet.key);
          if (type !== 'none' && type !== 'zset') throw integrity();
          const currentScore = score(
            await client.zScore(
              mutation.sortedSet.key,
              mutation.sortedSet.member
            )
          );
          if (currentScore !== mutation.sortedSet.expectedScore) return false;
        }
        const counters: number[] = [];
        for (const entry of mutation.increments) {
          const type = await client.type(entry.key);
          if (type !== 'none' && type !== 'string') throw integrity();
          const raw = stringValue(await client.get(entry.key));
          const value = raw === undefined ? 0 : Number(raw);
          if (
            !integer(value) ||
            (raw !== undefined && !/^(0|[1-9][0-9]*)$/.test(raw)) ||
            value === Number.MAX_SAFE_INTEGER
          )
            throw integrity();
          counters.push(value);
        }
        if (!validDeadlines()) return false;
        await tx.multi();
        queued = true;
        for (const entry of mutation.sets)
          await tx.set(entry.key, entry.value, {
            // SDK 0.15.3 floors this Date into relative seconds. A one-second
            // allowance prevents physical deletion before the logical deadline.
            expiration: new Date(entry.expiresAtMs + 1000),
          });
        if (mutation.sortedSet) {
          await tx.zAdd(mutation.sortedSet.key, {
            member: mutation.sortedSet.member,
            score: mutation.sortedSet.score,
          });
          await tx.expire(
            mutation.sortedSet.key,
            Math.max(
              1,
              Math.ceil((mutation.sortedSet.expiresAtMs - now()) / 1000)
            )
          );
        }
        for (const entry of mutation.increments) {
          await tx.incrBy(entry.key, 1);
          await tx.expire(
            entry.key,
            Math.max(1, Math.ceil((entry.expiresAtMs - now()) / 1000))
          );
        }
        let reply: unknown;
        try {
          reply = await tx.exec();
          executed = true;
        } catch {
          // Lost replies and hosted WATCH-conflict errors are both unconfirmed.
          return false;
        }
        const count =
          mutation.sets.length +
          (mutation.sortedSet ? 2 : 0) +
          mutation.increments.length * 2;
        if (!Array.isArray(reply) || reply.length !== count) return false;
        let index = 0;
        for (const unused of mutation.sets) {
          void unused;
          if (reply[index++] !== 'OK') return false;
        }
        if (mutation.sortedSet) {
          const added: unknown = reply[index++];
          if ((added !== 0 && added !== 1) || !expireReply(reply[index++]))
            return false;
        }
        const confirmedCounters: number[] = [];
        for (let counter = 0; counter < mutation.increments.length; counter++) {
          const value: unknown = reply[index++];
          const before = counters[counter];
          if (
            before === undefined ||
            !integer(value, before + 1) ||
            !expireReply(reply[index++])
          )
            return false;
          confirmedCounters.push(value);
        }
        const saved = await getMany(mutation.sets.map((entry) => entry.key));
        if (
          saved.some((value, offset) => value !== mutation.sets[offset]?.value)
        )
          return false;
        if (
          mutation.sortedSet &&
          score(
            await client.zScore(
              mutation.sortedSet.key,
              mutation.sortedSet.member
            )
          ) !== mutation.sortedSet.score
        )
          return false;
        for (let counter = 0; counter < mutation.increments.length; counter++) {
          const entry = mutation.increments[counter],
            confirmed = confirmedCounters[counter];
          if (!entry || confirmed === undefined) throw integrity();
          const value = Number(await client.get(entry.key));
          if (!integer(value, confirmed)) return false;
        }
        for (const entry of expiring) {
          const expiration = await client.expireTime(entry.key);
          if (!hasExpectedRemainingTtl(expiration, entry.expiresAtMs, now()))
            return false;
        }
        return true;
      } catch (error) {
        if (error instanceof RankedRaceError) throw error;
        throw unavailable();
      } finally {
        if (tx && !executed) {
          try {
            if (queued) await tx.discard();
            else await tx.unwatch();
          } catch {
            /* Released/expired transactions need no further work. */
          }
        }
      }
    },
  };
}
