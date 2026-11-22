import { createTrackFromPoints, type TrackPoint } from './track-authoring';
import {
  assessTrackStructure,
  findLongestStraight,
} from './circuit-validation';
import { LINKED_COURSE_VERSION } from './course-rhythm';
import type { CircuitCandidate, MotifKind } from './circuit-generator';
import { sampleTrack, validateTrack, type Track } from './track';
import { findTrackCrossings, crossingHeadroom } from './track-crossings';

import {
  courseFamilyForSeed,
  courseRandomFor,
  type CourseFamily,
} from './course-families';
export { courseFamilyForSeed } from './course-families';
/** Periodic uniform cubic B-spline: corners are continuous through the seam. */
function spline(controls: TrackPoint[]): TrackPoint[] {
  return Array.from({ length: 4096 }, (_, i) => {
    const u = (i * controls.length) / 4096,
      k = Math.floor(u),
      t = u - k;
    const weights = [
      (1 - t) ** 3 / 6,
      (4 - 6 * t * t + 3 * t ** 3) / 6,
      (1 + 3 * t + 3 * t * t - 3 * t ** 3) / 6,
      t ** 3 / 6,
    ];
    return weights.reduce(
      (p, w, j) => {
        const c = controls[(k + j + controls.length - 1) % controls.length]!;
        return { x: p.x + c.x * w, z: p.z + c.z * w };
      },
      { x: 0, z: 0 }
    );
  });
}
const length = (points: TrackPoint[]) =>
  points.reduce((sum, p, i) => {
    const n = points[(i + 1) % points.length]!;
    return sum + Math.hypot(n.x - p.x, n.z - p.z);
  }, 0);
const q = (n: number) => Math.round(n * 1e6) / 1e6 || 0;
/** C2 hill, zero at either end; derivatives are used by the authoritative flight model. */
function hill(s: number, from: number, span: number, height: number) {
  const t = (s - from) / span;
  if (t <= 0 || t >= 1) return { y: 0, grade: 0, verticalCurvature: 0 };
  return {
    y: height * 64 * t ** 3 * (1 - t) ** 3,
    grade: (height * 192 * t * t * (1 - t) ** 2 * (1 - 2 * t)) / span,
    verticalCurvature:
      (height * (384 * t - 2304 * t * t + 3840 * t ** 3 - 1920 * t ** 4)) /
      span ** 2,
  };
}
/** Different spatial constructions, not a shuffled inventory around one inward hairpin. */
function controlsFor(family: CourseFamily, random: () => number): TrackPoint[] {
  let pairs: number[][];
  if (family === 'sweeping') {
    // Broad outward lobes with three tightening waists; no inward U hairpin.
    pairs = [
      [-130, -65],
      [-80, -65],
      [-30, -65],
      [20, -65],
      [85, -65],
      [135, -30],
      [145, 30],
      [110, 80],
      [60, 90],
      [35, 55],
      [0, 45],
      [-35, 75],
      [-85, 95],
      [-130, 60],
      [-115, 15],
      [-155, -15],
    ];
  } else if (family === 'switchbacks') {
    // An elongated out-and-back with offset switchbacks on the return leg.
    pairs = [
      [-180, -65],
      [-120, -65],
      [-60, -65],
      [0, -65],
      [60, -65],
      [120, -65],
      [180, -65],
      [205, -30],
      [195, 20],
      [145, 40],
      [105, 15],
      [65, 45],
      [25, 20],
      [-15, 60],
      [-65, 35],
      [-105, 70],
      [-160, 65],
      [-195, 20],
    ];
  } else if (family === 'technical') {
    // Compact multi-inlet circuit with independent north, east and west pockets.
    pairs = [
      [-100, -90],
      [-60, -90],
      [-20, -90],
      [20, -90],
      [70, -90],
      [115, -60],
      [95, -10],
      [55, 5],
      [95, 45],
      [65, 95],
      [20, 75],
      [0, 30],
      [-30, 75],
      [-80, 95],
      [-115, 55],
      [-80, 15],
      [-120, -25],
    ];
  } else if (family === 'crossover') {
    // A small folded east section within a larger asymmetric lap, not two equal lobes.
    pairs = [
      [-180, -90],
      [-120, -90],
      [-60, -90],
      [0, -90],
      [70, -90],
      [130, -80],
      [170, -45],
      [185, 0],
      [155, 30],
      [115, 10],
      [110, -30],
      [145, -60],
      [190, -55],
      [220, -15],
      [215, 45],
      [170, 80],
      [105, 90],
      [65, 50],
      [20, 80],
      [-40, 105],
      [-105, 80],
      [-145, 40],
      [-130, -10],
      [-180, -45],
    ];
  } else {
    // Two broad loopback bowls around a central ridge, with a wide open neck.
    pairs = [
      [-160, -85],
      [-110, -85],
      [-60, -85],
      [-10, -85],
      [45, -85],
      [100, -85],
      [155, -60],
      [175, -10],
      [150, 45],
      [95, 55],
      [55, 20],
      [45, -10],
      [10, -25],
      [-20, 0],
      [-15, 45],
      [-45, 90],
      [-105, 105],
      [-160, 70],
      [-180, 10],
    ];
  }
  const stretch = 0.9 + random() * 0.2,
    depth = 0.9 + random() * 0.2;
  const raw = pairs.map(([x = 0, z = 0], i) => ({
    x: x * stretch,
    z: z * depth + (i > 5 ? (random() - 0.5) * 10 : 0),
  }));
  return family === 'technical'
    ? raw.map((p, i) => ({
        x:
          (raw[(i + raw.length - 1) % raw.length]!.x +
            4 * p.x +
            raw[(i + 1) % raw.length]!.x) /
          6,
        z:
          (raw[(i + raw.length - 1) % raw.length]!.z +
            4 * p.z +
            raw[(i + 1) % raw.length]!.z) /
          6,
      }))
    : raw;
}
export function generateVarietyCandidate(
  seed: string,
  attempt: number
): CircuitCandidate & { hills: [] } {
  const family = courseFamilyForSeed(seed),
    random = courseRandomFor(`variety-v6|${seed}|${attempt}`);
  const controls = controlsFor(family, random);
  let dense = spline(controls);
  const target =
    (family === 'technical'
      ? 560
      : family === 'crossover'
        ? 830
        : family === 'switchbacks'
          ? 760
          : family === 'ridge'
            ? 740
            : 640) +
    random() * (family === 'crossover' ? 60 : 70);
  const scale = target / length(dense),
    angle = random() * Math.PI * 2,
    mirror = random() < 0.5 ? -1 : 1;
  dense = dense.map((p) => ({
    x: scale * (p.x * Math.cos(angle) - p.z * Math.sin(angle)),
    z: mirror * scale * (p.x * Math.sin(angle) + p.z * Math.cos(angle)),
  }));
  const options = {
    seed,
    generatorVersion: LINKED_COURSE_VERSION,
    width: 7,
    sampleSpacing: 1,
    checkpointCount: 8,
  };
  const preview = createTrackFromPoints(dense, options),
    straight = findLongestStraight(preview);
  let s = 0,
    index = 0;
  const from = (straight.startS + 2) % preview.totalLength;
  for (let i = 1; i < dense.length; i++) {
    s += Math.hypot(
      dense[i]!.x - dense[i - 1]!.x,
      dense[i]!.z - dense[i - 1]!.z
    );
    if (s >= from) {
      index = i;
      break;
    }
  }
  const flat = createTrackFromPoints(
    [...dense.slice(index), ...dense.slice(0, index)],
    options
  );
  // Only long-run days have a gap. Every other family remains a road-driving day.
  const jump =
    family === 'switchbacks' && random() < 0.65 && straight.length > 112;
  const hillFrom = family === 'ridge' ? 80 : jump ? 120 : 24,
    hillSpan = family === 'ridge' ? 300 : flat.totalLength - hillFrom - 24;
  const height = family === 'ridge' ? 17 + random() : 9 + random() * 4;
  const track: Track = {
    ...flat,
    schemaVersion: 2,
    jumps: [],
    samples: flat.samples.map((p) => {
      const terrain = hill(p.s, hillFrom, hillSpan, height),
        ramp = jump ? hill(p.s, 22, 48, 4) : hill(p.s, 0, 1, 0),
        ridgeReturn =
          family === 'ridge'
            ? hill(p.s, 430, flat.totalLength - 454, 7)
            : hill(p.s, 0, 1, 0);
      return {
        ...p,
        y: q(terrain.y + ramp.y + ridgeReturn.y),
        grade: q(terrain.grade + ramp.grade + ridgeReturn.grade),
        verticalCurvature: q(
          terrain.verticalCurvature +
            ramp.verticalCurvature +
            ridgeReturn.verticalCurvature
        ),
      };
    }),
  };
  if (family === 'crossover') {
    const crossings = findTrackCrossings(flat);
    const crossing = crossings[0];
    if (crossing && crossings.length === 1) {
      const center = [crossing.lowerS, crossing.upperS].sort(
        (a, b) =>
          Math.min(b, flat.totalLength - b) - Math.min(a, flat.totalLength - a)
      )[0]!;
      track.samples = flat.samples.map((p) => {
        const delta = p.s - center,
          d = Math.abs(delta),
          t = (140 - d) / 100;
        if (d >= 140) return { ...p, y: 0, grade: 0, verticalCurvature: 0 };
        if (d <= 40) return { ...p, y: 12, grade: 0, verticalCurvature: 0 };
        return {
          ...p,
          y: q(12 * t ** 3 * (10 - 15 * t + 6 * t * t)),
          grade: q((-Math.sign(delta) * 12 * 30 * t * t * (1 - t) ** 2) / 100),
          verticalCurvature: q(
            (12 * (60 * t - 180 * t * t + 120 * t ** 3)) / 10000
          ),
        };
      });
    }
  }
  if (jump)
    track.jumps = [
      {
        rampStart: 22,
        takeoff: 42,
        landing: 52,
        rampEnd: 70,
        height: sampleTrack(track, 42).y ?? 0,
      },
    ];
  validateTrack(track);
  const structure = assessTrackStructure(track);
  if (
    family === 'crossover' &&
    (findTrackCrossings(track).length !== 1 || crossingHeadroom(track) < 10)
  )
    structure.codes.push('unsafe-overpass');
  const jumpMotifs: MotifKind[] = ['gap-jump'];
  const motifs: MotifKind[] =
    family === 'sweeping'
      ? ['sweeper', 'decreasing-radius', 's-bend']
      : family === 'technical'
        ? ['s-bend', 'decreasing-radius']
        : family === 'ridge'
          ? ['hairpin', 'sweeper', 's-bend']
          : [
              'straight',
              's-bend',
              'decreasing-radius',
              ...(jump ? jumpMotifs : []),
            ];
  return {
    track,
    hills: [],
    diagnostics: {
      ...structure.metrics,
      candidateSeed: `${seed}:attempt:${attempt}`,
      motifs,
      controlPoints: controls,
      codes: [...structure.codes],
    },
  };
}
