import type {
  CompetitionMember,
  CompetitionMutation,
  CompetitionStore,
} from '../../../src/server/core/competition.ts';
import type { RankedStore } from '../../../src/server/core/ranked-races.ts';

export type PartialMutation =
  'proofs-only' | 'receipt-only' | 'score-only' | 'no-revision';
type StringEntry = { value: string; expiresAtMs: number };
type SortedEntry = { members: Map<string, number>; expiresAtMs: number };

/** Faithful watched-revision CAS plus explicit injected failure modes, never production data. */
export class CompetitionTestStore implements CompetitionStore, RankedStore {
  readonly strings = new Map<string, StringEntry>();
  readonly sorted = new Map<string, SortedEntry>();
  readonly revisions = new Map<string, number>();
  readonly batchSizes: number[] = [];
  casCalls = 0;
  casWins = 0;
  alwaysConflict = false;
  partialNext: PartialMutation | undefined;
  beforeCas:
    | ((mutation: CompetitionMutation, call: number) => Promise<void>)
    | undefined;
  afterGet:
    | ((key: string, value: string | undefined) => Promise<void> | void)
    | undefined;
  constructor(readonly clock: () => number) {}
  private changed(key: string): void {
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
  }
  private prune(key: string): void {
    const string = this.strings.get(key),
      sorted = this.sorted.get(key);
    if (string && string.expiresAtMs <= this.clock()) {
      this.strings.delete(key);
      this.changed(key);
    }
    if (sorted && sorted.expiresAtMs <= this.clock()) {
      this.sorted.delete(key);
      this.changed(key);
    }
  }
  private raw(key: string): string | undefined {
    this.prune(key);
    if (this.sorted.has(key)) throw new Error('WRONGTYPE');
    return this.strings.get(key)?.value;
  }
  private entries(key: string): CompetitionMember[] {
    this.prune(key);
    if (this.strings.has(key)) throw new Error('WRONGTYPE');
    return [...(this.sorted.get(key)?.members ?? [])]
      .map(([member, score]) => ({ member, score }))
      .sort(
        (a, b) =>
          a.score - b.score ||
          (a.member < b.member ? -1 : a.member > b.member ? 1 : 0)
      );
  }
  rawSet(
    key: string,
    value: string,
    expiresAtMs = Number.MAX_SAFE_INTEGER
  ): void {
    if (this.sorted.has(key)) throw new Error('WRONGTYPE');
    this.strings.set(key, { value, expiresAtMs });
    this.changed(key);
  }
  rawDelete(key: string): void {
    this.strings.delete(key);
    this.sorted.delete(key);
    this.changed(key);
  }
  rawScore(
    key: string,
    member: string,
    value: number,
    expiresAtMs = Number.MAX_SAFE_INTEGER
  ): void {
    if (this.strings.has(key)) throw new Error('WRONGTYPE');
    let entry = this.sorted.get(key);
    if (!entry) {
      entry = { members: new Map(), expiresAtMs };
      this.sorted.set(key, entry);
    }
    entry.members.set(member, value);
    entry.expiresAtMs = expiresAtMs;
    this.changed(key);
  }
  async get(key: string): Promise<string | undefined> {
    const value = this.raw(key);
    await this.afterGet?.(key, value);
    return value;
  }
  async getMany(keys: string[]): Promise<(string | undefined)[]> {
    this.batchSizes.push(keys.length);
    return Promise.all(keys.map((key) => this.get(key)));
  }
  async setNX(
    key: string,
    value: string,
    expiresAtMs: number
  ): Promise<boolean> {
    if (this.raw(key) !== undefined) return false;
    this.rawSet(key, value, expiresAtMs);
    return true;
  }
  async rangeByRank(
    key: string,
    start: number,
    stop: number
  ): Promise<CompetitionMember[]> {
    return this.entries(key).slice(start, stop + 1);
  }
  async firstAtScore(
    key: string,
    score: number
  ): Promise<CompetitionMember | undefined> {
    return this.entries(key).find((entry) => entry.score === score);
  }
  async rankOf(key: string, member: string): Promise<number | undefined> {
    const index = this.entries(key).findIndex(
      (entry) => entry.member === member
    );
    return index < 0 ? undefined : index;
  }
  async scoreOf(key: string, member: string): Promise<number | undefined> {
    return this.entries(key).find((entry) => entry.member === member)?.score;
  }
  private apply(mutation: CompetitionMutation, part?: PartialMutation): void {
    for (const set of mutation.sets) {
      if (part === 'score-only') continue;
      if (
        part === 'receipt-only' &&
        !set.key.startsWith('racer:progressive-slip-v1:receipt:')
      )
        continue;
      this.rawSet(set.key, set.value, set.expiresAtMs);
    }
    if (mutation.sortedSet && part !== 'proofs-only' && part !== 'receipt-only')
      this.rawScore(
        mutation.sortedSet.key,
        mutation.sortedSet.member,
        mutation.sortedSet.score,
        mutation.sortedSet.expiresAtMs
      );
    if (!part)
      for (const increment of mutation.increments)
        this.rawSet(
          increment.key,
          String(Number(this.raw(increment.key) ?? '0') + 1),
          increment.expiresAtMs
        );
  }
  async compareAndSwap(mutation: CompetitionMutation): Promise<boolean> {
    this.casCalls++;
    const watched = mutation.expected.map((entry) => {
      this.prune(entry.key);
      return { key: entry.key, revision: this.revisions.get(entry.key) ?? 0 };
    });
    await this.beforeCas?.(mutation, this.casCalls);
    // Watch values and revisions together to catch ABA, TTL and ordinary writes.
    const valuesMatch = mutation.expected.every(
      (entry) => this.raw(entry.key) === entry.value
    );
    if (
      this.alwaysConflict ||
      !valuesMatch ||
      watched.some(
        (entry) => (this.revisions.get(entry.key) ?? 0) !== entry.revision
      )
    )
      return false;
    const sortedSet = mutation.sortedSet;
    if (
      sortedSet &&
      this.entries(sortedSet.key).find(
        (entry) => entry.member === sortedSet.member
      )?.score !== sortedSet.expectedScore
    )
      return false;
    for (const set of mutation.sets) {
      if (!mutation.expected.some((entry) => entry.key === set.key))
        throw new Error('Unwatched SET');
      this.raw(set.key);
    }
    for (const increment of mutation.increments) {
      const value = this.raw(increment.key);
      if (value !== undefined && !/^\d+$/.test(value))
        throw new Error('Invalid revision type');
    }
    const part = this.partialNext;
    this.partialNext = undefined;
    // All normal mutation commands are one synchronous atomic section.
    this.apply(mutation, part);
    if (part) return false;
    this.casWins++;
    return true;
  }
}
export function createCompetitionTestStore(
  clock: () => number
): CompetitionTestStore {
  return new CompetitionTestStore(clock);
}
