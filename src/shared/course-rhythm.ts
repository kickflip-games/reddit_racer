import type { Replay } from './replay';

export const LINKED_COURSE_VERSION = 'linked-circuits-v7';
/** Both recipes use the same driving rules; V6 geometry remains frozen. */
export const isVarietyCourseVersion = (version: string): boolean =>
  version === LINKED_COURSE_VERSION || version === 'linked-circuits-v6';
export type LinkedCourseVersion =
  | typeof LINKED_COURSE_VERSION
  | 'linked-circuits-v6'
  | 'linked-circuits-v5'
  | 'linked-circuits-v4';
export const LINKED_QUALITY_VERSION = 'linked-quality-v3';
/** V2 searches more candidates without weakening any acceptance threshold. */
export const LINKED_CANDIDATE_BUDGET = 32;
/** V7 may assess every candidate; retained recipes keep their original 12. */
export const LINKED_QUALITY_BUDGET = LINKED_CANDIDATE_BUDGET;
/** Versioned acceptance limits; also enforced when a daily record is created. */
export const LINKED_RHYTHM_LIMITS = Object.freeze({
  longestStraight: 230,
  longestThrottleTicks: 12 * 120,
  minElevation: 8,
});

/** Time without a sustained brake input; sub-0.1-second taps cannot reset it. */
export function longestThrottleTicks(
  replay: Replay,
  minimumBrakeTicks = 12
): number {
  let longest = 0;
  let from: number | null = null;
  for (let i = 0; i < replay.transitions.length; i++) {
    const transition = replay.transitions[i];
    if (!transition) continue;
    const end = replay.transitions[i + 1]?.tick ?? replay.endTick;
    if (transition.held) from ??= transition.tick;
    else if (end - transition.tick >= minimumBrakeTicks && from !== null) {
      longest = Math.max(longest, transition.tick - from);
      from = null;
    }
  }
  if (from !== null) longest = Math.max(longest, replay.endTick - from);
  return longest;
}

/** Earlier routes keep their original acceptance policy. V6 permits deliberate long runs. */
export const rhythmLimitsFor = (version: string) =>
  isVarietyCourseVersion(version)
    ? LINKED_RHYTHM_LIMITS
    : { longestStraight: 65, longestThrottleTicks: 8 * 120, minElevation: 1 };
