import assert from 'node:assert/strict';
import type {
  CompetitionRedis,
  CompetitionTransaction,
} from '../../src/server/competition-store.ts';

/** Revision-based test double; it models CAS, not the hosted SDK's conflict encoding. */
export class RevisionRedis implements CompetitionRedis {
  constructor(private readonly nowMs = Date.parse('2026-11-12T12:00:00Z')) {}
  readonly strings = new Map<string, string>();
  readonly sorted = new Map<string, Map<string, number>>();
  readonly deadlines = new Map<string, number>();
  readonly revisions = new Map<string, number>();
  readonly calls: string[] = [];
  beforeExec: (() => Promise<void>) | undefined;
  alterReply: ((value: unknown[]) => unknown) | undefined;
  loseReply = false;
  omitSet: string | undefined;
  failQueue = false;
  private changed(key: string): void {
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
  }
  seed(key: string, value: string): void {
    this.strings.set(key, value);
    this.changed(key);
  }
  async set(
    key: string,
    value: string,
    options?: { nx?: boolean; expiration?: Date }
  ): Promise<string> {
    if (options?.nx && this.strings.has(key)) return '';
    this.seed(key, value);
    if (options?.expiration)
      this.deadlines.set(key, Math.floor(options.expiration.getTime() / 1000));
    return 'OK';
  }
  async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.strings.delete(key);
      this.sorted.delete(key);
      this.deadlines.delete(key);
      this.changed(key);
    }
  }
  async get(key: string) {
    this.calls.push('get');
    return this.strings.get(key);
  }
  async mGet(keys: string[]) {
    this.calls.push('mGet');
    return keys.map((key) => this.strings.get(key) || null);
  }
  async type(key: string): Promise<string> {
    this.calls.push('type');
    return this.strings.has(key)
      ? 'string'
      : this.sorted.has(key)
        ? 'zset'
        : 'none';
  }
  async expireTime(key: string) {
    return this.deadlines.get(key) ?? -1;
  }
  async zScore(key: string, member: string) {
    return this.sorted.get(key)?.get(member);
  }
  async zRange(
    key: string,
    start: number,
    stop: number,
    options?: {
      by: 'rank' | 'score';
      limit?: { offset: number; count: number };
    }
  ) {
    const entries = [...(this.sorted.get(key) ?? new Map<string, number>())]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
    return options?.by === 'score'
      ? entries
          .filter((entry) => entry.score >= start && entry.score <= stop)
          .slice(
            options.limit?.offset ?? 0,
            (options.limit?.offset ?? 0) + (options.limit?.count ?? 1000)
          )
      : entries.slice(start, stop + 1);
  }
  async zRank(key: string, member: string) {
    const entries = await this.zRange(key, 0, 100);
    const index = entries.findIndex((entry) => entry.member === member);
    return index < 0 ? undefined : index;
  }
  async watch(...keys: string[]): Promise<CompetitionTransaction> {
    this.calls.push('watch');
    const watched = keys.map((key) => [key, this.revisions.get(key) ?? 0]);
    const commands: (() => unknown)[] = [];
    let multi = false;
    return {
      multi: async () => {
        this.calls.push('multi');
        multi = true;
      },
      set: async (key, value, options) => {
        if (this.failQueue) throw new Error('queue unavailable');
        commands.push(() => {
          if (key !== this.omitSet) {
            this.seed(key, value);
            this.deadlines.set(
              key,
              Math.floor((options?.expiration?.getTime() ?? 0) / 1000)
            );
          }
          return 'OK';
        });
      },
      zAdd: async (key, ...members) => {
        commands.push(() => {
          const board = this.sorted.get(key) ?? new Map<string, number>();
          let added = 0;
          for (const entry of members) {
            if (!board.has(entry.member)) added++;
            board.set(entry.member, entry.score);
          }
          this.sorted.set(key, board);
          this.changed(key);
          return added;
        });
      },
      incrBy: async (key, increment) => {
        commands.push(() => {
          const value = Number(this.strings.get(key) ?? 0) + increment;
          this.seed(key, String(value));
          return value;
        });
      },
      expire: async (key, seconds) => {
        commands.push(() => {
          this.deadlines.set(key, Math.floor(this.nowMs / 1000) + seconds);
          return 'OK';
        });
      },
      exec: async () => {
        this.calls.push('exec');
        assert.equal(multi, true);
        await this.beforeExec?.();
        if (
          watched.some(
            ([key, revision]) =>
              typeof key !== 'string' ||
              (this.revisions.get(key) ?? 0) !== revision
          )
        )
          return [];
        const values = commands.map((command) => command());
        if (this.loseReply) throw new Error('reply lost after commit');
        return this.alterReply ? this.alterReply(values) : values;
      },
      discard: async () => {
        this.calls.push('discard');
      },
      unwatch: async () => {
        this.calls.push('unwatch');
      },
    };
  }
}
