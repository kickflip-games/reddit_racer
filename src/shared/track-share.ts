import { LINKED_COURSE_VERSION } from './course-rhythm';
import { normalizeCourseWord } from './word-seed';
import { hashTrack, type Track } from './track';

export type TrackShare = {
  type: 'racer-track';
  version: 1;
  generator:
    | typeof LINKED_COURSE_VERSION
    | 'linked-circuits-v5'
    | 'linked-circuits-v4'
    | 'linked-circuits-v3';
  seed: string;
  trackHash: string;
};
export function parseTrackShare(raw: string): TrackShare {
  if (raw.length > 1024)
    throw new Error('This shared track link is too large.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('This shared track link is invalid.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('This shared track link is invalid.');
  if (
    !('type' in value) ||
    value.type !== 'racer-track' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('generator' in value) ||
    (value.generator !== LINKED_COURSE_VERSION &&
      value.generator !== 'linked-circuits-v5' &&
      value.generator !== 'linked-circuits-v4' &&
      value.generator !== 'linked-circuits-v3')
  )
    throw new Error(
      'This shared track version is not supported. Ask for a new share.'
    );
  if (
    Object.keys(value).length !== 5 ||
    !('seed' in value) ||
    typeof value.seed !== 'string' ||
    normalizeCourseWord(value.seed) !== value.seed ||
    !('trackHash' in value) ||
    typeof value.trackHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.trackHash)
  )
    throw new Error('This shared track link is invalid.');
  return {
    type: 'racer-track',
    version: 1,
    generator: value.generator,
    seed: value.seed,
    trackHash: value.trackHash,
  };
}
export async function createTrackShare(
  seed: string,
  track: Track
): Promise<TrackShare> {
  if (
    (track.generatorVersion !== LINKED_COURSE_VERSION &&
      track.generatorVersion !== 'linked-circuits-v5' &&
      track.generatorVersion !== 'linked-circuits-v4' &&
      track.generatorVersion !== 'linked-circuits-v3') ||
    normalizeCourseWord(seed) !== seed
  )
    throw new Error('This track cannot be shared with this version.');
  // Shares always use canonical SHA-256, never device-specific practice fallbacks.
  return {
    type: 'racer-track',
    version: 1,
    generator: track.generatorVersion,
    seed,
    trackHash: await hashTrack(track),
  };
}
export async function verifySharedTrack(
  shared: TrackShare,
  track: Track
): Promise<void> {
  if (
    track.generatorVersion !== shared.generator ||
    (await hashTrack(track)) !== shared.trackHash
  )
    throw new Error(
      'This shared track no longer matches this game version. No different track was loaded.'
    );
}
