import type { Replay } from './replay';

export const LINKED_COURSE_VERSION = 'linked-circuits-v3';
export const LINKED_QUALITY_VERSION = 'linked-quality-v2';
/** V2 searches more candidates without weakening any acceptance threshold. */
export const LINKED_CANDIDATE_BUDGET = 32;
export const LINKED_QUALITY_BUDGET = 12;
/** Versioned acceptance limits; also enforced when a daily record is created. */
export const LINKED_RHYTHM_LIMITS = Object.freeze({
  longestStraight: 65,
  longestThrottleTicks: 8 * 120,
  minElevation: 1,
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
