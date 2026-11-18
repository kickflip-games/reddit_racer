import { utcDay } from '../shared/daily-challenge';
import {
  DailyPublicationError,
  type DailyPublicationResult,
} from './core/daily-publication';

export const PRIVATE_RACE_APP = 'full-throttle-dev';
export const PRIVATE_RACE_COMMUNITY = 'full_throttle_dev_dev';
export const PRIVATE_RACE_SUBREDDIT_ID = 't5_kv7foq';
export const PUBLIC_RACE_COMMUNITY = 'theDailyLap';
export const PUBLIC_RACE_SUBREDDIT_ID = 't5_kyc33w';
export const PUBLICATION_MARKER = 'racerPublicationId';

type PublicationScope = {
  appSlug: string;
  subredditId: `t5_${string}`;
  subredditName: string;
};
export type PublicationScopeInput = {
  appSlug: unknown;
  subredditId: unknown;
  subredditName: unknown;
  getSubreddit: (id: `t5_${string}`) => Promise<
    | {
        id: string;
        name: string;
        type: string;
      }
    | undefined
  >;
};

function isSubredditId(value: unknown): value is `t5_${string}` {
  return typeof value === 'string' && /^t5_[a-z0-9]+$/.test(value);
}

/** Both destinations are explicitly authorized; no caller can add a community. */
const publicationScopes: readonly (PublicationScope & { type: string })[] = [
  {
    appSlug: PRIVATE_RACE_APP,
    subredditId: PRIVATE_RACE_SUBREDDIT_ID,
    subredditName: PRIVATE_RACE_COMMUNITY,
    type: 'private',
  },
  {
    appSlug: PRIVATE_RACE_APP,
    subredditId: PUBLIC_RACE_SUBREDDIT_ID,
    subredditName: PUBLIC_RACE_COMMUNITY,
    type: 'public',
  },
];

/** Request-local SDK context and a matching live community read gate every write. */
export async function requirePublicationScope(
  input: PublicationScopeInput
): Promise<PublicationScope> {
  if (
    !isSubredditId(input.subredditId) ||
    typeof input.subredditName !== 'string'
  )
    throw new DailyPublicationError('unavailable');
  const name = input.subredditName.toLowerCase();
  const scope = publicationScopes.find(
    (candidate) =>
      candidate.appSlug === input.appSlug &&
      candidate.subredditId === input.subredditId &&
      candidate.subredditName.toLowerCase() === name
  );
  if (!scope) throw new DailyPublicationError('unavailable');
  const checked = await input.getSubreddit(scope.subredditId);
  if (
    !checked ||
    checked.id !== scope.subredditId ||
    checked.name.toLowerCase() !== scope.subredditName.toLowerCase() ||
    checked.type !== scope.type
  )
    throw new DailyPublicationError('unavailable');
  return {
    appSlug: scope.appSlug,
    subredditId: scope.subredditId,
    subredditName: scope.subredditName,
  };
}

/** Legacy cutover release: intentionally no SDK, Redis, or publication writes.
 * Existing race/leaderboard handlers are unchanged. Reinstall the recorded prior
 * legacy version to resume publication if the new-app handover is rolled back.
 */
export function createDevvitDailyPublicationService(): {
  ensureToday(): Promise<DailyPublicationResult>;
} {
  return {
    async ensureToday() {
      return { status: 'unavailable', day: utcDay(Date.now()), postId: null };
    },
  };
}
