import { generateBrakingCircuit } from '../shared/braking-course-generator';
import { courseWord, type CourseWord } from '../shared/word-seed';
import { hashTrack, serializeTrack, type Track } from '../shared/track';
import { LINKED_COURSE_VERSION } from '../shared/course-rhythm';
import type { TrackShare } from '../shared/track-share';

export type PracticeCourse = {
  wordCourse?: CourseWord;
  track: Track;
  seed: string;
  fallbackUsed: boolean;
  trackHash: string;
};
export type PracticeCourseCapabilities = {
  layout?: 'flat' | 'elevated';
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
    // Normal practice uses the same checked generator as named courses.
    const generate =
      capabilities.layout === 'flat'
        ? (await import('../shared/circuit-quality')).generateValidatedCircuit
        : generateBrakingCircuit;
    for (
      let attempt = 0;
      attempt < (explicit ? 1 : maximumAttempts);
      attempt++
    ) {
      const selectedSeed = seed ?? freshSeed();
      const result = generate(selectedSeed);
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

const browserCapabilities: PracticeCourseCapabilities = {
  randomValues: (values) => {
    if (!globalThis.crypto?.getRandomValues)
      throw new Error('Secure random values are unavailable.');
    globalThis.crypto.getRandomValues(values);
  },
  hash: hashTrack,
};
const browserGenerator = createPracticeCourseGenerator(browserCapabilities);
const flatBrowserGenerator = createPracticeCourseGenerator({
  ...browserCapabilities,
  layout: 'flat',
});
export async function generateFlatPracticeCourse(
  seed?: string,
  avoidTrackHash?: string
): Promise<PracticeCourse> {
  return flatBrowserGenerator(seed, avoidTrackHash);
}

export async function generatePracticeCourse(
  seed?: string,
  avoidTrackHash?: string
): Promise<PracticeCourse> {
  return browserGenerator(seed, avoidTrackHash);
}

/** Every course word selects the current checked generator. */
export async function generateWordPracticeCourse(
  input: string,
  generator: TrackShare['generator'] = LINKED_COURSE_VERSION
): Promise<PracticeCourse & { wordCourse: CourseWord }> {
  const wordCourse = courseWord(input);
  const result = generateBrakingCircuit(
    wordCourse.seed,
    undefined,
    generator === 'linked-circuits-v3' ? 'linked-circuits-v4' : generator
  );
  if (!result.quality.valid)
    throw new Error('This seed course did not pass the driving checks.');
  // Saved V3/V4 shares use their frozen recipe, including quality selection.
  const track = { ...result.track, generatorVersion: generator };
  let trackHash: string;
  try {
    trackHash = await hashTrack(track);
  } catch {
    trackHash = practiceTrackFingerprint(track);
  }
  return {
    track,
    seed: wordCourse.seed,
    fallbackUsed: result.diagnostics.fallbackUsed,
    trackHash,
    wordCourse,
  };
}

let wordCourseCounter = 0;
/** Random selections expose a word code too, so they can be revisited/shared. */
export async function generateRandomWordPracticeCourse(
  avoidTrackHash?: string
): Promise<PracticeCourse & { wordCourse: CourseWord }> {
  const colors = [
    'amber',
    'jade',
    'silver',
    'coral',
    'golden',
    'violet',
    'scarlet',
    'azure',
  ];
  const places = [
    'brook',
    'meadow',
    'valley',
    'grove',
    'hill',
    'ridge',
    'field',
    'forest',
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    wordCourseCounter++;
    const bytes = new Uint8Array(4);
    try {
      globalThis.crypto.getRandomValues(bytes);
    } catch {
      for (let i = 0; i < bytes.length; i++)
        bytes[i] = Math.floor(Math.random() * 256);
    }
    const suffix = Array.from(bytes, (value) =>
      value.toString(16).padStart(2, '0')
    ).join('');
    const word = `${colors[bytes[0]! % colors.length]}-${places[bytes[1]! % places.length]}-${suffix}-${wordCourseCounter.toString(36)}`;
    const result = await generateWordPracticeCourse(word);
    if (result.trackHash !== avoidTrackHash) return result;
  }
  throw new Error(
    'A different seed course could not be created. Try another seed.'
  );
}
