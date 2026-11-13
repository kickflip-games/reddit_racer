import type { Track } from '../shared/track';
import { runtimeForTrack } from '../shared/scored-runtime';
import { SLOT_HANDLING_VERSION, type GripZone } from '../shared/slot-grip';
import type { GapJump } from '../shared/stunt-course';
import { practiceTrackFingerprint } from './practice-course';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type LocalBestResult = {
  bestTicks: number;
  previousBestTicks: number | null;
  isNewBest: boolean;
  tied: boolean;
};
const storageKey = 'reddit-racer.practice-bests.v1';
const session = new Map<string, number>();
const validTicks = (n: unknown): n is number =>
  typeof n === 'number' &&
  Number.isSafeInteger(n) &&
  n > 0 &&
  n <= 2_147_483_647;
export function practiceBestKey(
  track: Track,
  options: {
    dynamicGrip?: boolean;
    continuousPractice?: boolean;
    jumps?: readonly GapJump[];
    gripZones?: readonly GripZone[];
  }
): string {
  return JSON.stringify([
    practiceTrackFingerprint(track),
    runtimeForTrack(track).simulationVersion,
    options.dynamicGrip
      ? SLOT_HANDLING_VERSION
      : runtimeForTrack(track).handlingVersion,
    !!options.continuousPractice,
    options.jumps ?? [],
    options.gripZones ?? [],
  ]);
}
export function createPracticeBestStore(storage?: StorageLike) {
  const records = new Map(session);
  let persistent = !!storage;
  let writable = true;
  try {
    const raw = storage?.getItem(storageKey);
    if (raw) {
      const data: unknown = JSON.parse(raw);
      if (
        !data ||
        typeof data !== 'object' ||
        !('version' in data) ||
        data.version !== 1
      ) {
        writable = false;
        persistent = false;
      } else if ('entries' in data && Array.isArray(data.entries))
        for (const item of data.entries.slice(-64)) {
          if (
            Array.isArray(item) &&
            typeof item[0] === 'string' &&
            item[0].length < 20000 &&
            validTicks(item[1])
          )
            records.set(
              item[0],
              Math.min(records.get(item[0]) ?? Infinity, item[1])
            );
        }
    }
  } catch {
    persistent = false;
    writable = false;
  }
  return {
    get persistent() {
      return persistent;
    },
    best(key: string): number | null {
      return records.get(key) ?? null;
    },
    record(key: string, ticks: number): LocalBestResult {
      if (!validTicks(ticks)) throw new Error('Invalid completed lap time');
      const previousBestTicks = records.get(key) ?? null;
      const bestTicks = Math.min(previousBestTicks ?? Infinity, ticks);
      records.delete(key);
      records.set(key, bestTicks);
      session.delete(key);
      session.set(key, bestTicks);
      while (records.size > 64) {
        const first = records.keys().next().value;
        if (first === undefined) break;
        records.delete(first);
      }
      while (session.size > 64) {
        const first = session.keys().next().value;
        if (first === undefined) break;
        session.delete(first);
      }
      if (storage && writable)
        try {
          storage.setItem(
            storageKey,
            JSON.stringify({ version: 1, entries: [...records] })
          );
        } catch {
          persistent = false;
        }
      return {
        bestTicks,
        previousBestTicks,
        isNewBest: previousBestTicks === null || ticks < previousBestTicks,
        tied: ticks === previousBestTicks,
      };
    },
  };
}
