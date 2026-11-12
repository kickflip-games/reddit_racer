import { sampleTrack, validateTrack } from './track.ts';
import type { Track } from './track.ts';

export type StructuralOptions = {
  minRadius: number;
  clearance: number;
  shoulder: number;
};
export type StructuralMetrics = {
  length: number;
  minRadius: number;
  minClearance: number;
  longestStraight: number;
  startStraight: number;
  directionChanges: number;
  curvatureProfile: number[];
};
export type StructuralAssessment = {
  valid: boolean;
  codes: string[];
  metrics: StructuralMetrics;
};
export const STRAIGHT_CURVATURE_LIMIT = 0.0015;
export const MIN_START_STRAIGHT = 15;

const precision = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
type Point = { x: number; z: number };
const orientation = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - 1e-9 &&
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    p.z >= Math.min(a.z, b.z) - 1e-9 &&
    p.z <= Math.max(a.z, b.z) + 1e-9
  );
}
export function segmentsIntersect(
  a: Point,
  b: Point,
  c: Point,
  d: Point
): boolean {
  const o1 = orientation(a, b, c),
    o2 = orientation(a, b, d),
    o3 = orientation(c, d, a),
    o4 = orientation(c, d, b);
  if (
    ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
    ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
  )
    return true;
  return (
    (Math.abs(o1) < 1e-9 && onSegment(a, b, c)) ||
    (Math.abs(o2) < 1e-9 && onSegment(a, b, d)) ||
    (Math.abs(o3) < 1e-9 && onSegment(c, d, a)) ||
    (Math.abs(o4) < 1e-9 && onSegment(c, d, b))
  );
}
function pointSegmentSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dz = b.z - a.z;
  const fraction = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz))
  );
  const x = p.x - (a.x + fraction * dx),
    z = p.z - (a.z + fraction * dz);
  return x * x + z * z;
}
export function segmentDistance(
  a: Point,
  b: Point,
  c: Point,
  d: Point
): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.sqrt(
    Math.min(
      pointSegmentSquared(a, c, d),
      pointSegmentSquared(b, c, d),
      pointSegmentSquared(c, a, b),
      pointSegmentSquared(d, a, b)
    )
  );
}
function boxDistanceSquared(a: Point, b: Point, c: Point, d: Point): number {
  const dx = Math.max(
    0,
    Math.min(a.x, b.x) - Math.max(c.x, d.x),
    Math.min(c.x, d.x) - Math.max(a.x, b.x)
  );
  const dz = Math.max(
    0,
    Math.min(a.z, b.z) - Math.max(c.z, d.z),
    Math.min(c.z, d.z) - Math.max(a.z, b.z)
  );
  return dx * dx + dz * dz;
}

export function findLongestStraight(track: Track): {
  startS: number;
  length: number;
} {
  let best = { startS: 0, length: 0 };
  let runStart = 0,
    runLength = 0,
    runSamples = 0;
  for (let index = 0; index < track.samples.length * 2; index++) {
    const at = index % track.samples.length;
    const current = track.samples[at],
      next = track.samples[(at + 1) % track.samples.length];
    if (!current || !next) break;
    if (
      Math.abs(current.curvature) <= STRAIGHT_CURVATURE_LIMIT &&
      Math.abs(next.curvature) <= STRAIGHT_CURVATURE_LIMIT
    ) {
      if (runSamples === 0) runStart = index;
      runSamples++;
      runLength +=
        at + 1 === track.samples.length
          ? track.totalLength - current.s
          : next.s - current.s;
      if (
        runStart < track.samples.length &&
        runSamples <= track.samples.length &&
        runLength > best.length
      ) {
        best = { startS: track.samples[runStart]?.s ?? 0, length: runLength };
      }
    } else {
      runLength = 0;
      runSamples = 0;
    }
  }
  return best;
}

/** Geometry/corridor gates only. Full simulated quality and difficulty are issue #7. */
export function assessTrackStructure(
  track: Track,
  options: StructuralOptions = { minRadius: 10, clearance: 2, shoulder: 0.8 }
): StructuralAssessment {
  const empty: StructuralMetrics = {
    length: Number.isFinite(track.totalLength) ? track.totalLength : 0,
    minRadius: 0,
    minClearance: 0,
    longestStraight: 0,
    startStraight: 0,
    directionChanges: 0,
    curvatureProfile: [],
  };
  if (
    ![options.minRadius, options.clearance, options.shoulder].every(
      Number.isFinite
    ) ||
    options.minRadius <= 0 ||
    options.clearance < 0 ||
    options.shoulder < 0
  ) {
    return { valid: false, codes: ['invalid-options'], metrics: empty };
  }
  try {
    validateTrack(track);
  } catch {
    return { valid: false, codes: ['malformed-track'], metrics: empty };
  }
  const codes = new Set<string>();
  let maximumCurvature = 0;
  for (let index = 0; index < track.samples.length; index++) {
    const previous =
      track.samples[(index + track.samples.length - 1) % track.samples.length];
    const sample = track.samples[index];
    const next = track.samples[(index + 1) % track.samples.length];
    if (!previous || !sample || !next) continue;
    const incomingLength = Math.hypot(
      sample.x - previous.x,
      sample.z - previous.z
    );
    const outgoingLength = Math.hypot(next.x - sample.x, next.z - sample.z);
    const ix = (sample.x - previous.x) / incomingLength;
    const iz = (sample.z - previous.z) / incomingLength;
    const ox = (next.x - sample.x) / outgoingLength;
    const oz = (next.z - sample.z) / outgoingLength;
    const geometricCurvature =
      Math.atan2(ix * oz - iz * ox, ix * ox + iz * oz) /
      ((incomingLength + outgoingLength) / 2);
    const tangentLength = Math.hypot(ix + ox, iz + oz);
    if (
      Math.abs(geometricCurvature - sample.curvature) > 0.000002 ||
      tangentLength < 0.000001 ||
      Math.abs((ix + ox) / tangentLength - sample.tx) > 0.000002 ||
      Math.abs((iz + oz) / tangentLength - sample.tz) > 0.000002
    )
      codes.add('frame-consistency');
    maximumCurvature = Math.max(
      maximumCurvature,
      Math.abs(sample.curvature),
      Math.abs(geometricCurvature)
    );
  }
  const minRadius = maximumCurvature > 0 ? 1 / maximumCurvature : 1_000_000;
  if (minRadius < options.minRadius) codes.add('corner-radius');
  const widestHalfRoad = Math.max(
    ...track.samples.map((sample) => sample.width / 2)
  );
  if (minRadius <= widestHalfRoad + options.shoulder + 0.1)
    codes.add('corridor-fold');
  let minClearance = Infinity;
  for (let a = 0; a < track.samples.length; a++) {
    const p = track.samples[a],
      q = track.samples[(a + 1) % track.samples.length];
    if (!p || !q) continue;
    for (let b = a + 2; b < track.samples.length; b++) {
      if (a === 0 && b === track.samples.length - 1) continue;
      const r = track.samples[b],
        s = track.samples[(b + 1) % track.samples.length];
      if (!r || !s) continue;
      const boxSquared = boxDistanceSquared(p, q, r, s);
      if (boxSquared <= 1e-12 && segmentsIntersect(p, q, r, s))
        codes.add('centerline-intersection');
      const arc = Math.min(r.s - p.s, track.totalLength - (r.s - p.s));
      const corridorWidths =
        (Math.max(p.width, q.width) + Math.max(r.width, s.width)) / 2 +
        2 * options.shoulder;
      const localExclusion = Math.min(
        2 * (corridorWidths + options.clearance),
        Math.PI * options.minRadius * 0.8
      );
      // Nearby cross-sections intentionally form one road. Radius and intersection
      // gates cover local folds; this test covers separate portions of the circuit.
      if (arc <= localExclusion) continue;
      const improvementDistance = minClearance + corridorWidths;
      if (
        Number.isFinite(improvementDistance) &&
        boxSquared > improvementDistance * improvementDistance
      )
        continue;
      const gap = segmentDistance(p, q, r, s) - corridorWidths;
      minClearance = Math.min(minClearance, gap);
      if (gap < options.clearance) codes.add('road-clearance');
    }
  }
  const longestStraight = findLongestStraight(track);
  let startStraight = 0;
  for (let index = 0; index < track.samples.length; index++) {
    const sample = track.samples[index],
      next = track.samples[(index + 1) % track.samples.length];
    if (
      !sample ||
      !next ||
      Math.abs(sample.curvature) > STRAIGHT_CURVATURE_LIMIT ||
      Math.abs(next.curvature) > STRAIGHT_CURVATURE_LIMIT
    )
      break;
    startStraight =
      index + 1 === track.samples.length ? track.totalLength : next.s;
  }
  const curvatureProfile = Array.from({ length: 64 }, (_, index) =>
    precision(sampleTrack(track, (index / 64) * track.totalLength).curvature)
  );
  let lastSign = 0,
    directionChanges = 0;
  for (const curvature of curvatureProfile) {
    const sign = Math.abs(curvature) < 0.003 ? 0 : Math.sign(curvature);
    if (sign && lastSign && sign !== lastSign) directionChanges++;
    if (sign) lastSign = sign;
  }
  const metrics: StructuralMetrics = {
    length: track.totalLength,
    minRadius: precision(minRadius),
    minClearance: Number.isFinite(minClearance) ? precision(minClearance) : 0,
    longestStraight: precision(longestStraight.length),
    startStraight: precision(startStraight),
    directionChanges,
    curvatureProfile,
  };
  return { valid: codes.size === 0, codes: [...codes], metrics };
}
