import { RankedRaceError } from '../../shared/ranked-race';

export type RaceBudgetStore = {
  setNX: (key: string, value: string, expiresAtMs: number) => Promise<boolean>;
  incrBy: (key: string, increment: number) => Promise<number>;
};
export const RACE_BUDGET_WINDOW_MS = 60_000;
export const RACE_STARTS_PER_WINDOW = 12;
export const RACE_VERIFICATIONS_PER_WINDOW = 12;

/** Atomic increments bound expensive work, independently of individual sessions. */
export async function consumeRaceBudget(input: {
  store: RaceBudgetStore;
  nowMs: number;
  subredditId: string;
  userId: string;
  operation: 'start' | 'verify';
}): Promise<void> {
  if (
    !/^t5_[a-z0-9]+$/.test(input.subredditId) ||
    !/^t2_[a-z0-9]+$/.test(input.userId) ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0
  )
    throw new RankedRaceError(
      'unavailable',
      'The race request could not be budgeted.'
    );
  const bucket = Math.floor(input.nowMs / RACE_BUDGET_WINDOW_MS);
  const expiresAtMs = (bucket + 2) * RACE_BUDGET_WINDOW_MS;
  const key = `racer:budget:${input.subredditId}:${input.userId}:${input.operation}:${bucket}`;
  let count: number;
  try {
    // Install expiration atomically BEFORE incrementing. A current bucket cannot
    // expire during this minute; expiry is an entire extra window away.
    await input.store.setNX(key, '0', expiresAtMs);
    count = await input.store.incrBy(key, 1);
  } catch {
    throw new RankedRaceError(
      'unavailable',
      'Race checks are temporarily unavailable.'
    );
  }
  if (!Number.isSafeInteger(count) || count < 1)
    throw new RankedRaceError(
      'unavailable',
      'The race budget could not be confirmed.'
    );
  const maximum =
    input.operation === 'start'
      ? RACE_STARTS_PER_WINDOW
      : RACE_VERIFICATIONS_PER_WINDOW;
  if (count > maximum)
    throw new RankedRaceError(
      'rate-limited',
      'Too many race requests. Please wait a minute and try again.'
    );
}
