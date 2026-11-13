import {
  utcDay,
  utcDayWindow,
  validateSubredditId,
} from '../../shared/daily-challenge.ts';
import { isRacePostId } from '../../shared/today-race-post.ts';

export const MAX_PUBLICATION_CAS_ATTEMPTS = 3;
export const MAX_PUBLICATION_DAY_SELECTIONS = 2;
/** Exceeds the documented 30s request budget; expiry never permits resubmission. */
export const PUBLICATION_SUBMIT_GRACE_MS = 60_000;
export type DailyPublicationStore = {
  read(): Promise<string | undefined>;
  compareAndSwap(expected: string | undefined, next: string): Promise<boolean>;
};
export type DailyPublicationPost = {
  id: string;
  subredditId: string;
  createdAtMs: number;
  available: boolean;
  operationId: string | undefined;
};
export type DailyPublicationPrepared = { day: string; challengeHash: string };
export type DailyPublicationOperation = {
  operationId: string;
  submittedAtMs: number;
  intendedDay: string;
  challengeHash: string;
};
export type DailyPublicationDependencies = {
  store: DailyPublicationStore;
  subredditId: string;
  now(): number;
  newOperationId(): string;
  prepare(day: string): Promise<DailyPublicationPrepared>;
  readCurrentPost(day: string): Promise<DailyPublicationPost | undefined>;
  submit(input: {
    operationId: string;
    day: string;
    challengeHash: string;
  }): Promise<DailyPublicationPost>;
  lookup(postId: string): Promise<DailyPublicationPost | undefined>;
  repair(input: {
    post: DailyPublicationPost;
    operationId: string;
  }): Promise<void>;
  /** Trusted app-author/operation-marker matches only; at most two candidates. */
  reconcile(
    operation: DailyPublicationOperation
  ): Promise<DailyPublicationPost[]>;
};
export type DailyPublicationResult = {
  status: 'ready' | 'busy' | 'uncertain' | 'unavailable';
  day: string;
  postId: string | null;
};
export type DailyPublicationService = {
  ensureToday(): Promise<DailyPublicationResult>;
};
type JournalBase = DailyPublicationOperation & {
  schemaVersion: 1;
  subredditId: string;
};
export type DailyPublicationJournal = JournalBase &
  (
    | { phase: 'submitting' }
    | { phase: 'uncertain' }
    | { phase: 'created'; postId: string; actualCreatedAtMs: number | null }
    | {
        /** Terminal publication settlement, separate from current link availability. */
        phase: 'ready';
        postId: string;
        actualCreatedAtMs: number;
        actualPostDay: string;
        availability: 'available' | 'unavailable';
      }
  );
type Snapshot = { raw: string; journal: DailyPublicationJournal } | undefined;

export class DailyPublicationError extends Error {
  constructor(readonly kind: 'integrity' | 'unavailable') {
    super(
      kind === 'integrity'
        ? 'Stored daily publication data is invalid.'
        : 'Daily race publication is unavailable.'
    );
    this.name = 'DailyPublicationError';
  }
}
function integrity(): never {
  throw new DailyPublicationError('integrity');
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}
function day(value: unknown): string {
  if (typeof value !== 'string') return integrity();
  try {
    utcDayWindow(value);
  } catch {
    return integrity();
  }
  return value;
}
function timestamp(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return false;
  try {
    utcDay(value);
    return true;
  } catch {
    return false;
  }
}

/** Strict permanent schema; unknown fields/versions and damaged state fail closed. */
export function parseDailyPublicationJournal(
  raw: string,
  subredditId: string
): DailyPublicationJournal {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return integrity();
  }
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.subredditId !== subredditId ||
    !validOperationId(value.operationId) ||
    !timestamp(value.submittedAtMs) ||
    typeof value.challengeHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.challengeHash)
  )
    return integrity();
  const base: JournalBase = {
    schemaVersion: 1,
    subredditId,
    operationId: value.operationId,
    submittedAtMs: value.submittedAtMs,
    intendedDay: day(value.intendedDay),
    challengeHash: value.challengeHash,
  };
  const fields = [
    'schemaVersion',
    'subredditId',
    'operationId',
    'submittedAtMs',
    'intendedDay',
    'challengeHash',
    'phase',
  ];
  let parsed: DailyPublicationJournal;
  if (value.phase === 'submitting' || value.phase === 'uncertain') {
    parsed = { ...base, phase: value.phase };
  } else if (value.phase === 'created' || value.phase === 'ready') {
    fields.push('postId', 'actualCreatedAtMs');
    if (!isRacePostId(value.postId)) return integrity();
    if (value.phase === 'created') {
      if (
        value.actualCreatedAtMs !== null &&
        !timestamp(value.actualCreatedAtMs)
      )
        return integrity();
      parsed = {
        ...base,
        phase: 'created',
        postId: value.postId,
        actualCreatedAtMs: value.actualCreatedAtMs,
      };
    } else {
      fields.push('actualPostDay', 'availability');
      if (
        !timestamp(value.actualCreatedAtMs) ||
        day(value.actualPostDay) !== utcDay(value.actualCreatedAtMs) ||
        (value.availability !== 'available' &&
          value.availability !== 'unavailable')
      )
        return integrity();
      parsed = {
        ...base,
        phase: 'ready',
        postId: value.postId,
        actualCreatedAtMs: value.actualCreatedAtMs,
        actualPostDay: utcDay(value.actualCreatedAtMs),
        availability: value.availability,
      };
    }
  } else return integrity();
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    return integrity();
  return parsed;
}
export function serializeDailyPublicationJournal(
  journal: DailyPublicationJournal
): string {
  return JSON.stringify(
    parseDailyPublicationJournal(JSON.stringify(journal), journal.subredditId)
  );
}

/** One permanent installation journal guards submissions across UTC boundaries. */
export function createDailyPublicationService(
  deps: DailyPublicationDependencies
): DailyPublicationService {
  validateSubredditId(deps.subredditId);
  function now(): number {
    try {
      const value = deps.now();
      if (!timestamp(value)) throw new DailyPublicationError('unavailable');
      return value;
    } catch {
      throw new DailyPublicationError('unavailable');
    }
  }
  async function io<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DailyPublicationError) throw error;
      throw new DailyPublicationError('unavailable');
    }
  }
  function post(
    value: DailyPublicationPost,
    expectedId?: string
  ): DailyPublicationPost {
    if (
      !record(value) ||
      !isRacePostId(value.id) ||
      value.subredditId !== deps.subredditId ||
      (expectedId !== undefined && value.id !== expectedId) ||
      !timestamp(value.createdAtMs) ||
      typeof value.available !== 'boolean' ||
      (value.operationId !== undefined && !validOperationId(value.operationId))
    )
      return integrity();
    return value;
  }
  async function pointer(
    currentDay: string
  ): Promise<DailyPublicationPost | undefined> {
    const value = await io(() => deps.readCurrentPost(currentDay));
    if (value === undefined) return undefined;
    const checked = post(value);
    if (utcDay(checked.createdAtMs) !== currentDay) return integrity();
    return checked;
  }
  async function read(): Promise<Snapshot> {
    const raw = await io(() => deps.store.read());
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || raw.length > 16_384) return integrity();
    return {
      raw,
      journal: parseDailyPublicationJournal(raw, deps.subredditId),
    };
  }

  async function ensureToday(): Promise<DailyPublicationResult> {
    let casAttempts = 0;
    async function result(
      fallback: DailyPublicationResult['status'],
      knownId?: string
    ): Promise<DailyPublicationResult> {
      const currentDay = utcDay(now());
      const existing = await pointer(currentDay);
      const afterDay = utcDay(now());
      if (afterDay !== currentDay)
        return {
          status: 'unavailable',
          day: afterDay,
          postId: knownId ?? null,
        };
      return {
        status: existing
          ? existing.available
            ? 'ready'
            : 'unavailable'
          : fallback,
        day: currentDay,
        postId: existing?.id ?? knownId ?? null,
      };
    }
    async function change(
      current: Snapshot,
      next: DailyPublicationJournal
    ): Promise<{ accepted: boolean; snapshot: Snapshot }> {
      if (casAttempts >= MAX_PUBLICATION_CAS_ATTEMPTS)
        return { accepted: false, snapshot: await read() };
      casAttempts++;
      const raw = serializeDailyPublicationJournal(next);
      try {
        await deps.store.compareAndSwap(current?.raw, raw);
      } catch {
        // A lost reply can mean the write committed. Only exact positive readback
        // is permission, and only the original fresh-nonce caller can submit.
      }
      const observed = await read();
      return { accepted: observed?.raw === raw, snapshot: observed };
    }
    async function known(
      operationId: string,
      id: string,
      createdAtMs: number | null
    ): Promise<Snapshot> {
      for (let attempt = 0; attempt < MAX_PUBLICATION_CAS_ATTEMPTS; attempt++) {
        const current = await read();
        if (!current || current.journal.operationId !== operationId)
          return current;
        const state = current.journal;
        if (state.phase === 'ready' || state.phase === 'created') {
          if (
            state.postId !== id ||
            (createdAtMs !== null &&
              state.actualCreatedAtMs !== null &&
              state.actualCreatedAtMs !== createdAtMs)
          )
            return integrity();
          if (
            state.phase === 'ready' ||
            state.actualCreatedAtMs !== null ||
            createdAtMs === null
          )
            return current;
        }
        const updated = await change(current, {
          ...base(state),
          phase: 'created',
          postId: id,
          actualCreatedAtMs: createdAtMs,
        });
        const observed = updated.snapshot?.journal;
        if (
          observed?.operationId === operationId &&
          (observed.phase === 'created' || observed.phase === 'ready') &&
          observed.postId !== id
        )
          return integrity();
        if (updated.accepted || observed?.phase === 'ready')
          return updated.snapshot;
        if (casAttempts >= MAX_PUBLICATION_CAS_ATTEMPTS)
          return updated.snapshot;
      }
      return read();
    }
    async function uncertain(operationId: string): Promise<Snapshot> {
      const current = await read();
      if (
        !current ||
        current.journal.operationId !== operationId ||
        current.journal.phase !== 'submitting'
      )
        return current;
      return (
        await change(current, { ...base(current.journal), phase: 'uncertain' })
      ).snapshot;
    }
    async function settle(
      current: Snapshot,
      metadata: DailyPublicationPost | undefined,
      availability: 'available' | 'unavailable'
    ): Promise<DailyPublicationResult> {
      if (!current || current.journal.phase !== 'created')
        return result('unavailable');
      const state = current.journal;
      const createdAtMs = metadata?.createdAtMs ?? state.actualCreatedAtMs;
      if (createdAtMs === null) return result('unavailable', state.postId);
      const latest = await read();
      if (!latest || latest.journal.operationId !== state.operationId)
        return result('unavailable', state.postId);
      if (latest.journal.phase === 'ready') {
        if (latest.journal.postId !== state.postId) return integrity();
        return result('unavailable', state.postId);
      }
      if (
        latest.journal.phase !== 'created' ||
        latest.journal.postId !== state.postId
      )
        return integrity();
      if (
        latest.journal.actualCreatedAtMs !== null &&
        latest.journal.actualCreatedAtMs !== createdAtMs
      )
        return integrity();
      await change(latest, {
        ...base(latest.journal),
        phase: 'ready',
        postId: state.postId,
        actualCreatedAtMs: createdAtMs,
        actualPostDay: utcDay(createdAtMs),
        availability,
      });
      return result('unavailable', state.postId);
    }
    async function resume(
      current: Snapshot,
      supplied?: DailyPublicationPost
    ): Promise<DailyPublicationResult> {
      const operationId = current?.journal.operationId;
      for (let pass = 0; pass < MAX_PUBLICATION_CAS_ATTEMPTS; pass++) {
        if (!current || current.journal.operationId !== operationId)
          return result('busy');
        const state = current.journal;
        if (state.phase === 'ready') return result('unavailable', state.postId);
        if (
          state.phase === 'submitting' &&
          !supplied &&
          now() - state.submittedAtMs < PUBLICATION_SUBMIT_GRACE_MS
        )
          return result('busy');
        if (state.phase === 'submitting' || state.phase === 'uncertain') {
          const candidates = supplied
            ? [supplied]
            : await io(() => deps.reconcile(base(state)));
          if (!Array.isArray(candidates) || candidates.length > 2)
            return integrity();
          const matches = new Map<string, DailyPublicationPost>();
          for (const candidate of candidates) {
            const checked = post(candidate);
            if (checked.operationId !== state.operationId) return integrity();
            const duplicate = matches.get(checked.id);
            if (duplicate && duplicate.createdAtMs !== checked.createdAtMs)
              return integrity();
            matches.set(checked.id, checked);
          }
          if (matches.size > 1) return integrity();
          const positive = matches.values().next().value;
          if (!positive) {
            const observed = await uncertain(state.operationId);
            if (
              observed?.journal.phase === 'created' ||
              observed?.journal.phase === 'ready'
            ) {
              current = observed;
              continue;
            }
            return result('uncertain');
          }
          supplied = positive;
          current = await known(
            state.operationId,
            positive.id,
            positive.createdAtMs
          );
          continue;
        }
        const value =
          supplied?.id === state.postId
            ? supplied
            : await io(() => deps.lookup(state.postId));
        if (value === undefined)
          return settle(current, undefined, 'unavailable');
        const metadata = post(value, state.postId);
        if (
          (metadata.operationId !== undefined &&
            metadata.operationId !== state.operationId) ||
          (state.actualCreatedAtMs !== null &&
            state.actualCreatedAtMs !== metadata.createdAtMs)
        )
          return integrity();
        if (state.actualCreatedAtMs === null) {
          current = await known(
            state.operationId,
            state.postId,
            metadata.createdAtMs
          );
          if (current?.journal.phase !== 'created') continue;
        }
        if (!metadata.available)
          return settle(current, metadata, 'unavailable');
        try {
          await deps.repair({ post: metadata, operationId: state.operationId });
        } catch {
          return result('unavailable', state.postId);
        }
        const advertised = await pointer(utcDay(metadata.createdAtMs));
        if (!advertised) return result('unavailable', state.postId);
        return settle(
          current,
          metadata,
          advertised.available ? 'available' : 'unavailable'
        );
      }
      return result('unavailable', supplied?.id);
    }

    for (
      let selection = 0;
      selection < MAX_PUBLICATION_DAY_SELECTIONS;
      selection++
    ) {
      const currentDay = utcDay(now());
      const existing = await pointer(currentDay);
      const current = await read();
      if (utcDay(now()) !== currentDay) continue;
      if (existing) {
        // A link can be used without erasing an unrelated unresolved operation.
        if (
          current &&
          current.journal.phase !== 'ready' &&
          (existing.operationId === current.journal.operationId ||
            (current.journal.phase === 'created' &&
              current.journal.postId === existing.id))
        ) {
          const adopted = await known(
            current.journal.operationId,
            existing.id,
            existing.createdAtMs
          );
          return resume(adopted, existing);
        }
        return {
          status: existing.available ? 'ready' : 'unavailable',
          day: currentDay,
          postId: existing.id,
        };
      }
      if (current && current.journal.phase !== 'ready') return resume(current);
      if (
        current?.journal.phase === 'ready' &&
        currentDay <=
          (current.journal.intendedDay > current.journal.actualPostDay
            ? current.journal.intendedDay
            : current.journal.actualPostDay)
      )
        return {
          status: 'unavailable',
          day: currentDay,
          postId: current.journal.postId,
        };
      const prepared = await io(() => deps.prepare(currentDay));
      if (
        !record(prepared) ||
        prepared.day !== currentDay ||
        typeof prepared.challengeHash !== 'string' ||
        !/^[a-f0-9]{64}$/.test(prepared.challengeHash)
      )
        return integrity();
      if (utcDay(now()) !== currentDay) continue;
      let operationId: string;
      try {
        operationId = deps.newOperationId();
      } catch {
        throw new DailyPublicationError('unavailable');
      }
      if (
        !validOperationId(operationId) ||
        operationId === current?.journal.operationId
      )
        return integrity();
      const claim: DailyPublicationJournal = {
        schemaVersion: 1,
        subredditId: deps.subredditId,
        operationId,
        intendedDay: currentDay,
        challengeHash: prepared.challengeHash,
        submittedAtMs: now(),
        phase: 'submitting',
      };
      const claimed = await change(current, claim);
      if (!claimed.accepted) return result('busy');
      // Only this fresh-nonce invocation reaches the external side effect. A later
      // invocation seeing this same durable record can only reconcile/repair it.
      let submitted: DailyPublicationPost;
      try {
        submitted = await deps.submit({
          operationId,
          day: currentDay,
          challengeHash: prepared.challengeHash,
        });
      } catch {
        const observed = await uncertain(operationId);
        return observed?.journal.operationId === operationId
          ? resume(observed)
          : result('busy');
      }
      if (
        !record(submitted) ||
        !isRacePostId(submitted.id) ||
        submitted.subredditId !== deps.subredditId
      ) {
        await uncertain(operationId);
        return integrity();
      }
      try {
        const captured = await known(
          operationId,
          submitted.id,
          timestamp(submitted.createdAtMs) ? submitted.createdAtMs : null
        );
        if (captured?.journal.operationId !== operationId)
          return await result('busy', submitted.id);
        const valid =
          timestamp(submitted.createdAtMs) &&
          typeof submitted.available === 'boolean';
        return await resume(
          captured,
          valid ? post(submitted, submitted.id) : undefined
        );
      } catch (error) {
        if (
          error instanceof DailyPublicationError &&
          error.kind === 'integrity'
        )
          throw error;
        // A confirmed Reddit creation must remain navigable even if subsequent
        // persistence/repair is unavailable. The permanent guard is not released.
        return {
          status: 'unavailable',
          day: utcDay(now()),
          postId: submitted.id,
        };
      }
    }
    return result('unavailable');
  }
  return { ensureToday };
}

function base(journal: DailyPublicationJournal): JournalBase {
  return {
    schemaVersion: 1,
    subredditId: journal.subredditId,
    operationId: journal.operationId,
    intendedDay: journal.intendedDay,
    challengeHash: journal.challengeHash,
    submittedAtMs: journal.submittedAtMs,
  };
}
