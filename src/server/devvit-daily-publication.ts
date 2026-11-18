import { randomUUID } from 'node:crypto';
import { context, reddit, type Post } from '@devvit/web/server';
import { isRacePostId } from '../shared/today-race-post';
import {
  createDailyPublicationService,
  DailyPublicationError,
  type DailyPublicationPost,
  type DailyPublicationResult,
} from './core/daily-publication';
import { createRedisDailyPublicationStore } from './daily-publication-store';
import { createDevvitDailyService } from './devvit-daily';
import {
  createDevvitTodayRacePostsService,
  readTrustedRacePost,
} from './devvit-today-race-posts';

export const PRIVATE_RACE_APP = 'the-daily-lap';
export const PRIVATE_RACE_COMMUNITY = 'full_throttle_dev_dev';
export const PRIVATE_RACE_SUBREDDIT_ID = 't5_kv7foq';
export const PUBLIC_RACE_COMMUNITY = 'theDailyLap';
export const PUBLIC_RACE_SUBREDDIT_ID = 't5_kyc33w';
export const PUBLICATION_MARKER = 'racerPublicationId';
const maximumReconcilePosts = 20;

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

async function operationId(post: Post): Promise<string | undefined> {
  const data = await post.getPostData();
  if (!data || !(PUBLICATION_MARKER in data)) return undefined;
  const marker = data[PUBLICATION_MARKER];
  if (typeof marker !== 'string') throw new DailyPublicationError('integrity');
  return marker;
}

/** The game client has no publication endpoint or caller-selected scope/date. */
export function createDevvitDailyPublicationService(): {
  ensureToday(): Promise<DailyPublicationResult>;
} {
  return {
    async ensureToday() {
      const scope = await requirePublicationScope({
        appSlug: context.appSlug,
        subredditId: context.subredditId,
        subredditName: context.subredditName,
        getSubreddit: (id) => reddit.getSubredditById(id),
      });
      const posts = new Map<string, Post>();
      async function sdkPost(id: `t3_${string}`): Promise<Post> {
        const cached = posts.get(id);
        if (cached) return cached;
        const found = await reddit.getPostById(id);
        posts.set(found.id, found);
        return found;
      }
      async function lookup(
        id: string
      ): Promise<DailyPublicationPost | undefined> {
        const metadata = await readTrustedRacePost(id, sdkPost);
        if (!metadata) return undefined;
        if (metadata.subredditId !== scope.subredditId)
          throw new DailyPublicationError('integrity');
        const found = posts.get(id);
        return {
          ...metadata,
          operationId: found ? await operationId(found) : undefined,
        };
      }
      const daily = createDevvitDailyService();
      const today = createDevvitTodayRacePostsService(
        daily,
        undefined,
        sdkPost
      );
      const service = createDailyPublicationService({
        store: createRedisDailyPublicationStore(scope.subredditId),
        subredditId: scope.subredditId,
        now: Date.now,
        newOperationId: randomUUID,
        async prepare(day) {
          const record = await daily.getOrCreate({
            subredditId: scope.subredditId,
            day,
          });
          return { day: record.day, challengeHash: record.challengeHash };
        },
        async readCurrentPost(day) {
          const metadata = await today.readRegisteredPost({
            subredditId: scope.subredditId,
            day,
          });
          if (!metadata) return undefined;
          const found = posts.get(metadata.id);
          return {
            ...metadata,
            operationId: found ? await operationId(found) : undefined,
          };
        },
        async submit(input) {
          const post = await reddit.submitCustomPost({
            subredditName: scope.subredditName,
            title: 'The Daily Lap · Daily time attack',
            entry: 'default',
            runAs: 'APP',
            postData: {
              challengeSchema: 1,
              challengeDay: input.day,
              challengeHash: input.challengeHash,
              [PUBLICATION_MARKER]: input.operationId,
            },
          });
          posts.set(post.id, post);
          return {
            id: post.id,
            subredditId: post.subredditId,
            createdAtMs: post.createdAt.getTime(),
            available:
              !post.removed &&
              !post.spam &&
              post.removedByCategory !== 'deleted',
            operationId: input.operationId,
          };
        },
        lookup,
        async repair(input) {
          if (!isRacePostId(input.post.id))
            throw new DailyPublicationError('integrity');
          const post = await sdkPost(input.post.id);
          const boundDaily = createDevvitDailyService(post);
          const bound = await boundDaily.getForPost({
            subredditId: scope.subredditId,
            postId: post.id,
          });
          // mergePostData preserves the public operation marker during repair.
          await post.mergePostData({
            challengeSchema: bound.challenge.schemaVersion,
            challengeDay: bound.challenge.day,
            challengeHash: bound.challenge.challengeHash,
            [PUBLICATION_MARKER]: input.operationId,
          });
          const registered = await createDevvitTodayRacePostsService(
            boundDaily,
            post,
            sdkPost
          ).registerCreatedPost({
            subredditId: scope.subredditId,
            postId: post.id,
          });
          if (!registered) throw new DailyPublicationError('unavailable');
        },
        async reconcile(input) {
          const recent = await reddit
            .getNewPosts({
              subredditName: scope.subredditName,
              limit: maximumReconcilePosts,
              pageSize: maximumReconcilePosts,
            })
            .all();
          if (recent.length > maximumReconcilePosts)
            throw new DailyPublicationError('integrity');
          const candidates = recent.filter(
            (post) =>
              post.subredditId === scope.subredditId &&
              post.authorName.toLowerCase() === scope.appSlug &&
              Number.isSafeInteger(post.createdAt.getTime()) &&
              post.createdAt.getTime() >= input.submittedAtMs - 5_000 &&
              post.createdAt.getTime() <= Date.now() + 5_000
          );
          const checked = await Promise.all(
            candidates.map(async (post) => {
              const marker = await operationId(post);
              if (marker !== input.operationId) return undefined;
              posts.set(post.id, post);
              return lookup(post.id);
            })
          );
          const matches: DailyPublicationPost[] = [];
          for (const post of checked) if (post) matches.push(post);
          // More than one positive result is duplicate evidence, never a winner to guess.
          if (matches.length > 2) throw new DailyPublicationError('integrity');
          return matches;
        },
      });
      return service.ensureToday();
    },
  };
}
