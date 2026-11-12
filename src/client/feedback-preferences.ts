export type MotionPreference = 'system' | 'reduced' | 'full';
export type FeedbackPreferencesSnapshot = {
  muted: boolean;
  motion: MotionPreference;
  reducedMotion: boolean;
};
export type PreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};
export type SystemMotion = {
  readonly reducedMotion: boolean;
  subscribe(listener: (reduced: boolean) => void): () => void;
};
export type FeedbackPreferencesOptions = {
  storage?: PreferenceStorage | null;
  systemMotion?: SystemMotion;
};
export type FeedbackPreferences = {
  readonly snapshot: Readonly<FeedbackPreferencesSnapshot>;
  setMuted(value: boolean): void;
  setMotion(value: MotionPreference): void;
  /** Receives the current snapshot immediately, then only actual changes. */
  subscribe(
    listener: (snapshot: Readonly<FeedbackPreferencesSnapshot>) => void
  ): () => void;
  dispose(): void;
};

export const FEEDBACK_PREFERENCES_KEY = 'reddit-racer:feedback-preferences:v1';

function motion(value: unknown): value is MotionPreference {
  return value === 'system' || value === 'reduced' || value === 'full';
}
function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
function browserMotion(): SystemMotion {
  const query =
    typeof window === 'undefined'
      ? undefined
      : window.matchMedia('(prefers-reduced-motion: reduce)');
  return {
    get reducedMotion() {
      return query?.matches ?? false;
    },
    subscribe(listener) {
      const changed = (): void => listener(query?.matches ?? false);
      query?.addEventListener('change', changed);
      return () => query?.removeEventListener('change', changed);
    },
  };
}

/** Local preferences only; this owner never touches racing input or simulation. */
export function createFeedbackPreferences(
  options: FeedbackPreferencesOptions = {}
): FeedbackPreferences {
  const storage =
    options.storage === undefined ? browserStorage() : options.storage;
  const system = options.systemMotion ?? browserMotion();
  let systemReduced = system.reducedMotion;
  let muted = false;
  let preference: MotionPreference = 'system';
  try {
    const saved = storage?.getItem(FEEDBACK_PREFERENCES_KEY);
    const value: unknown = saved ? JSON.parse(saved) : null;
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      'schemaVersion' in value &&
      value.schemaVersion === 1 &&
      'muted' in value &&
      typeof value.muted === 'boolean' &&
      'motion' in value &&
      motion(value.motion) &&
      Object.keys(value).length === 3
    ) {
      muted = value.muted;
      preference = value.motion;
    }
  } catch {
    /* Unavailable or malformed storage must not prevent play. */
  }
  const makeSnapshot = (): Readonly<FeedbackPreferencesSnapshot> =>
    Object.freeze({
      muted,
      motion: preference,
      reducedMotion:
        preference === 'reduced' || (preference === 'system' && systemReduced),
    });
  let snapshot = makeSnapshot();
  let disposed = false;
  const listeners = new Set<
    (snapshot: Readonly<FeedbackPreferencesSnapshot>) => void
  >();
  function notify(
    listener: (snapshot: Readonly<FeedbackPreferencesSnapshot>) => void
  ): void {
    try {
      listener(snapshot);
    } catch {
      /* Preference subscribers cannot block driving. */
    }
  }
  function changed(persist: boolean): void {
    const next = makeSnapshot();
    if (
      next.muted === snapshot.muted &&
      next.motion === snapshot.motion &&
      next.reducedMotion === snapshot.reducedMotion
    )
      return;
    snapshot = next;
    if (persist) {
      try {
        storage?.setItem(
          FEEDBACK_PREFERENCES_KEY,
          JSON.stringify({ schemaVersion: 1, muted, motion: preference })
        );
      } catch {
        /* The in-memory preference remains usable. */
      }
    }
    for (const listener of listeners) notify(listener);
  }
  const unsubscribe = system.subscribe((reduced) => {
    if (disposed) return;
    systemReduced = reduced;
    changed(false);
  });
  return {
    get snapshot() {
      return snapshot;
    },
    setMuted(value) {
      if (disposed) return;
      if (typeof value !== 'boolean')
        throw new Error('Mute preference must be Boolean');
      muted = value;
      changed(true);
    },
    setMotion(value) {
      if (disposed) return;
      if (!motion(value)) throw new Error('Unsupported motion preference');
      preference = value;
      changed(true);
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      notify(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      listeners.clear();
    },
  };
}
