import { api } from './api';
import { withRequestDeadline } from './request-deadline';
import {
  parseDailyChallengeView,
  type DailyChallengeView,
} from '../shared/daily-challenge';

export class DailyCourseIntegrityError extends Error {
  constructor() {
    super(
      'The saved daily course could not be verified in this version of the game.'
    );
    this.name = 'DailyCourseIntegrityError';
  }
}

function isStoredCourseFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('data' in error))
    return false;
  const data = error.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    data.code === 'PRECONDITION_FAILED'
  );
}

/** The server resolves the post and day; clients never supply either authority. */
export async function fetchDailyChallenge(): Promise<DailyChallengeView> {
  let value: unknown;
  try {
    value = await withRequestDeadline((signal) =>
      api.dailyChallenge.query(undefined, { signal })
    );
  } catch (error) {
    if (isStoredCourseFailure(error)) throw new DailyCourseIntegrityError();
    throw error;
  }
  try {
    return await parseDailyChallengeView(value);
  } catch {
    // A successful transport with an unusable record must never become a different daily course.
    throw new DailyCourseIntegrityError();
  }
}

export type DailyClockState = {
  day: string;
  archived: boolean;
  resetSeconds: number;
};

/** Display time is anchored to the server response and a monotonic elapsed clock. */
export function startDailyClock(
  view: DailyChallengeView,
  render: (state: DailyClockState) => void
): () => void {
  const receivedAt = performance.now();
  const update = (): void => {
    const serverNow =
      view.serverNowMs + Math.max(0, performance.now() - receivedAt);
    render({
      day: view.challenge.day,
      archived: !view.isCurrent || serverNow >= view.challenge.endsAtMs,
      resetSeconds: Math.max(
        0,
        Math.ceil((view.nextResetAtMs - serverNow) / 1000)
      ),
    });
  };
  update();
  const timer = setInterval(update, 1000);
  return () => clearInterval(timer);
}
