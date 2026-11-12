import {
  DailyChallengeError,
  utcDay,
  utcDayWindow,
} from './daily-challenge.ts';

export type TodayRacePostView = {
  schemaVersion: 1;
  currentDay: string;
  serverNowMs: number;
  nextResetAtMs: number;
  status: 'ready' | 'not-ready';
  post: { postId: string; url: string } | null;
};

export function isRacePostId(value: unknown): value is `t3_${string}` {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    /^t3_[a-z0-9]+$/.test(value)
  );
}

/** No stored URL, subreddit name or browser-selected redirect is trusted. */
export function canonicalRacePostUrl(postId: string): string {
  if (!isRacePostId(postId))
    throw new DailyChallengeError('integrity', 'Race post ID is invalid');
  return `https://www.reddit.com/comments/${postId.slice(3)}/`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, expected: string[]): void {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new DailyChallengeError(
      'integrity',
      'Today race post fields are missing or unsupported'
    );
}

export function parseTodayRacePostView(value: unknown): TodayRacePostView {
  if (!record(value))
    throw new DailyChallengeError('integrity', 'Today race post is malformed');
  if (value.schemaVersion !== 1)
    throw new DailyChallengeError(
      'unsupported',
      'Today race post schema is unsupported'
    );
  fields(value, [
    'schemaVersion',
    'currentDay',
    'serverNowMs',
    'nextResetAtMs',
    'status',
    'post',
  ]);
  if (
    typeof value.currentDay !== 'string' ||
    typeof value.serverNowMs !== 'number' ||
    !Number.isSafeInteger(value.serverNowMs) ||
    value.serverNowMs < 0 ||
    typeof value.nextResetAtMs !== 'number' ||
    (value.status !== 'ready' && value.status !== 'not-ready')
  )
    throw new DailyChallengeError(
      'integrity',
      'Today race post metadata is invalid'
    );
  try {
    if (
      utcDay(value.serverNowMs) !== value.currentDay ||
      utcDayWindow(value.currentDay).endsAtMs !== value.nextResetAtMs
    )
      throw new Error('window');
  } catch {
    throw new DailyChallengeError(
      'integrity',
      'Today race post UTC window is inconsistent'
    );
  }
  let post: TodayRacePostView['post'] = null;
  if (value.post !== null) {
    if (!record(value.post))
      throw new DailyChallengeError('integrity', 'Race post link is malformed');
    fields(value.post, ['postId', 'url']);
    if (
      !isRacePostId(value.post.postId) ||
      value.post.url !== canonicalRacePostUrl(value.post.postId)
    )
      throw new DailyChallengeError('integrity', 'Race post link is invalid');
    post = { postId: value.post.postId, url: value.post.url };
  }
  if ((value.status === 'ready') !== (post !== null))
    throw new DailyChallengeError(
      'integrity',
      'Today race post readiness is inconsistent'
    );
  return {
    schemaVersion: 1,
    currentDay: value.currentDay,
    serverNowMs: value.serverNowMs,
    nextResetAtMs: value.nextResetAtMs,
    status: value.status,
    post,
  };
}
