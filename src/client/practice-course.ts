import { hashTrack, serializeTrack, type Track } from '../shared/track';

export type PracticeCourse = {
  track: Track;
  seed: string;
  fallbackUsed: boolean;
  trackHash: string;
};
export type PracticeCourseCapabilities = {
  randomValues?: (values: Uint8Array<ArrayBuffer>) => void;
  hash?: (track: Track) => Promise<string>;
  now?: () => number;
  random?: () => number;
};
type PracticeCourseGenerator = (
  seed?: string,
  avoidTrackHash?: string
) => Promise<PracticeCourse>;
const maximumAttempts = 3;

/** Unranked local identity only; this is never a daily hash or score authority. */
export function practiceTrackFingerprint(track: Track): string {
  const value = serializeTrack(track);
  let first = 0x811c9dc5,
    second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `practice-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

/** Narrow capability injection keeps HTTP/random-path tests independent of globals. */
export function createPracticeCourseGenerator(
  capabilities: PracticeCourseCapabilities
): PracticeCourseGenerator {
  let fallbackCounter = 0;
  function freshSeed(): string {
    if (capabilities.randomValues) {
      try {
        const values = new Uint8Array(16);
        capabilities.randomValues(values);
        return `practice-${Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('')}`;
      } catch {
        // Practice needs variety, not a cryptographic identity or admission token.
      }
    }
    fallbackCounter++;
    const now = (capabilities.now ?? Date.now)();
    const random = (capabilities.random ?? Math.random)();
    return `practice-${now.toString(36)}-${fallbackCounter.toString(36)}-${Math.floor(random * 0xffffffff).toString(36)}`;
  }
  async function identity(track: Track): Promise<string> {
    if (capabilities.hash) {
      try {
        return await capabilities.hash(track);
      } catch {
        // Insecure local phone-LAN HTTP may not expose crypto.subtle.
      }
    }
    return practiceTrackFingerprint(track);
  }
  return async (seed, avoidTrackHash) => {
    const explicit = seed !== undefined;
    if (
      explicit &&
      (typeof seed !== 'string' || seed.length < 1 || seed.length > 96)
    )
      throw new RangeError(
        'Practice track seeds must contain 1–96 characters.'
      );
    // Heavy generator/controller search code is downloaded only when choosing practice.
    const { generateValidatedCircuit } =
      await import('../shared/circuit-quality');
    for (
      let attempt = 0;
      attempt < (explicit ? 1 : maximumAttempts);
      attempt++
    ) {
      const selectedSeed = seed ?? freshSeed();
      const result = generateValidatedCircuit(selectedSeed);
      if (!result.quality.valid)
        throw new Error(
          'This practice course did not pass the driving checks.'
        );
      const trackHash = await identity(result.track);
      if (explicit || trackHash !== avoidTrackHash)
        return {
          track: result.track,
          seed: selectedSeed,
          fallbackUsed: result.diagnostics.fallbackUsed,
          trackHash,
        };
    }
    throw new Error(
      'A different practice course could not be created after 3 attempts. Try another seed.'
    );
  };
}

const browserGenerator = createPracticeCourseGenerator({
  randomValues: (values) => {
    if (!globalThis.crypto?.getRandomValues)
      throw new Error('Secure random values are unavailable.');
    globalThis.crypto.getRandomValues(values);
  },
  hash: hashTrack,
});

export async function generatePracticeCourse(
  seed?: string,
  avoidTrackHash?: string
): Promise<PracticeCourse> {
  return browserGenerator(seed, avoidTrackHash);
}
