import { redis } from '@devvit/web/server';
import { validateSubredditId } from '../shared/daily-challenge';
import type { DailyPublicationStore } from './core/daily-publication';

export type DailyPublicationTransaction = {
  multi: () => Promise<void>;
  set: (key: string, value: string) => Promise<unknown>;
  exec: () => Promise<unknown>;
  discard: () => Promise<void>;
  unwatch: () => Promise<unknown>;
};

/** Only the installed Devvit WATCH/MULTI operations needed by this journal. */
export type DailyPublicationRedis = {
  get: (key: string) => Promise<unknown>;
  type: (key: string) => Promise<unknown>;
  watch: (...keys: string[]) => Promise<DailyPublicationTransaction>;
};

class PublicationStorageError extends Error {}

function unavailable(): PublicationStorageError {
  return new PublicationStorageError(
    'Daily publication storage is unavailable.'
  );
}

function invalid(): PublicationStorageError {
  return new PublicationStorageError(
    'Daily publication storage returned invalid data.'
  );
}

/** One permanent journal per community; deployments and UTC days cannot fork it. */
export function dailyPublicationKey(subredditId: string): string {
  validateSubredditId(subredditId);
  return `racer:daily-publication:${subredditId}`;
}

export function createRedisDailyPublicationStore(
  subredditId: string,
  client: DailyPublicationRedis = redis
): DailyPublicationStore {
  const key = dailyPublicationKey(subredditId);

  async function read(): Promise<string | undefined> {
    try {
      const type = await client.type(key);
      if (type !== 'none' && type !== 'string') throw invalid();
      const value = await client.get(key);
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'string') throw invalid();
      // Empty and malformed strings remain exact raw values for the core parser.
      return value;
    } catch (error) {
      if (error instanceof PublicationStorageError) throw error;
      throw unavailable();
    }
  }

  return {
    read,
    async compareAndSwap(expected, next): Promise<boolean> {
      if (
        (expected !== undefined && typeof expected !== 'string') ||
        typeof next !== 'string'
      )
        throw invalid();

      let tx: DailyPublicationTransaction | undefined;
      let multiRequested = false;
      let execReturned = false;
      try {
        tx = await client.watch(key);
        // TxClient.get is a command builder even before MULTI in Devvit 0.15.3.
        if ((await read()) !== expected) return false;
        // Mark before awaiting: a lost MULTI reply may already have opened it.
        multiRequested = true;
        await tx.multi();
        // No expiration: the journal also preserves uncertain-submit recovery.
        await tx.set(key, next);
        try {
          await tx.exec();
          execReturned = true;
        } catch {
          // WATCH conflicts may throw too. Only exact persisted ownership can
          // confirm a write whose EXEC acknowledgement was lost after commit.
        }
        // SDK acknowledgement shape/truthiness never grants ownership. Even an
        // uninformative reply is safe only when ordinary Redis reads prove next.
        return (await read()) === next;
      } catch (error) {
        if (error instanceof PublicationStorageError) throw error;
        throw unavailable();
      } finally {
        // A returned EXEC consumes WATCH/MULTI, including a conflict result.
        // Otherwise release the transaction even after queue/read/EXEC errors.
        if (tx && !execReturned) {
          try {
            if (multiRequested) await tx.discard();
            else await tx.unwatch();
          } catch {
            // EXEC may have committed before throwing, leaving an expired tx.
            // A failed DISCARD must still attempt to release any live WATCH.
            if (multiRequested) {
              try {
                await tx.unwatch();
              } catch {
                /* The transaction is already released or the service is down. */
              }
            }
          }
        }
      }
    },
  };
}
