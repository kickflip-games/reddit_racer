import { generateLinkedFlatCandidate } from './circuit-generator';
import { LINKED_COURSE_VERSION, LINKED_RHYTHM_LIMITS } from './course-rhythm';
import { validateTrack, type Track } from './track';

export type CourseHill = { from: number; span: number; height: number };
const round = (value: number) => Math.round(value * 1e6) / 1e6 || 0;

/** Compact C2 hills leave the standing start and tighter braking corners flat. */
function hillAt(s: number, hill: CourseHill) {
  const t = (s - hill.from) / hill.span;
  if (t <= 0 || t >= 1) return { y: 0, grade: 0, verticalCurvature: 0 };
  return {
    y: hill.height * 64 * t ** 3 * (1 - t) ** 3,
    grade:
      (hill.height * 192 * t ** 2 * (1 - t) ** 2 * (1 - 2 * t)) / hill.span,
    verticalCurvature:
      (hill.height *
        (384 * t - 2304 * t ** 2 + 3840 * t ** 3 - 1920 * t ** 4)) /
      hill.span ** 2,
  };
}

export function addLinkedCourseHills(flat: Track): {
  track: Track;
  hills: CourseHill[];
} {
  const spans: { from: number; span: number }[] = [];
  let start = 0;
  for (let i = 0; i <= flat.samples.length; i++) {
    const sample = flat.samples[i];
    if (
      !sample ||
      sample.s < 22 ||
      sample.s > flat.totalLength - 22 ||
      Math.abs(sample.curvature) > 0.022
    ) {
      const first = flat.samples[start];
      const end = sample?.s ?? flat.totalLength;
      if (first && end - first.s >= 56)
        spans.push({ from: first.s, span: end - first.s });
      start = i + 1;
    }
  }
  // Length then progress is a stable tie-break, independent of sort/runtime quirks.
  const hills = spans
    .sort((a, b) => b.span - a.span || a.from - b.from)
    .slice(0, 2)
    .map((span) => ({
      ...span,
      height: Math.min(5, span.span ** 2 * 0.00032),
    }));
  const track: Track = {
    ...flat,
    generatorVersion: LINKED_COURSE_VERSION,
    schemaVersion: 2,
    samples: flat.samples.map((sample) => {
      const profile = hills.map((hill) => hillAt(sample.s, hill));
      return {
        ...sample,
        y: round(profile.reduce((sum, p) => sum + p.y, 0)),
        grade: round(profile.reduce((sum, p) => sum + p.grade, 0)),
        verticalCurvature: round(
          profile.reduce((sum, p) => sum + p.verticalCurvature, 0)
        ),
      };
    }),
    jumps: [],
  };
  validateTrack(track);
  return { track, hills };
}

/**
 * Reuse the frozen periodic motif-loop construction: shuffled S bends, a single
 * infield return, tightening corners, sweepers and short recovery sections.
 * No opposite-side padding or artificial closing straight. The earlier recipe
 * remains unchanged for its stored courses and golden hashes.
 */
export function generateLinkedCourseCandidate(seed: string, attempt = 1) {
  const candidate = generateLinkedFlatCandidate(seed, attempt);
  if (!candidate.track || candidate.diagnostics.codes.length)
    return { ...candidate, hills: [] };
  const elevated = addLinkedCourseHills(candidate.track);
  const codes = [...candidate.diagnostics.codes];
  if (
    Math.max(...elevated.track.samples.map((p) => p.y ?? 0)) <
    LINKED_RHYTHM_LIMITS.minElevation
  )
    codes.push('missing-elevation');
  if (
    candidate.diagnostics.longestStraight > LINKED_RHYTHM_LIMITS.longestStraight
  )
    codes.push('passive-straight');
  return {
    ...candidate,
    ...elevated,
    diagnostics: { ...candidate.diagnostics, codes },
  };
}
