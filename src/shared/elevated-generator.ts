import { createTrackFromPoints } from './track-authoring.ts';
import {
  assessTrackStructure,
  findLongestStraight,
  segmentsIntersect,
} from './circuit-validation.ts';
import {
  assessTrackQuality,
  ELEVATED_QUALITY_VERSION,
  type ValidatedCircuit,
  type ValidatedDiagnostics,
} from './circuit-quality.ts';
import type {
  GeneratorConfig,
  AcceptedCircuitDiagnostics,
} from './circuit-generator.ts';
import { sampleTrack, validateTrack, type Track } from './track.ts';

export const ELEVATED_GENERATOR_VERSION = 'countryside-circuits-v1';
export const ELEVATED_GENERATOR_CONFIG: Readonly<GeneratorConfig> =
  Object.freeze({
    width: 7,
    lengthMin: 560,
    lengthMax: 720,
    minRadius: 10,
    clearance: 2,
    shoulder: 0.8,
    maxAttempts: 32,
  });
type Point = { x: number; z: number };
const q = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000 || 0;
export function normalizeElevatedGeneratorConfig(
  overrides: Partial<GeneratorConfig> = {}
): GeneratorConfig {
  const c = { ...ELEVATED_GENERATOR_CONFIG, ...overrides };
  if (
    Object.keys(overrides).some(
      (key) => !Object.hasOwn(ELEVATED_GENERATOR_CONFIG, key)
    ) ||
    !Object.values(c).every(Number.isFinite) ||
    c.width < 5 ||
    c.width > 10 ||
    c.lengthMin < 500 ||
    c.lengthMax > 800 ||
    c.lengthMax < c.lengthMin ||
    c.minRadius < 10 ||
    c.minRadius > 30 ||
    c.clearance < 1 ||
    c.clearance > 5 ||
    c.shoulder < 0 ||
    c.shoulder > 2 ||
    !Number.isInteger(c.maxAttempts) ||
    c.maxAttempts < 1 ||
    c.maxAttempts > 32
  )
    throw new Error('Elevated generator configuration is invalid');
  return c;
}
function randomFor(seed: string): () => number {
  let n = 2166136261;
  for (const c of seed) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
function hull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  function half(list: Point[]): Point[] {
    const result: Point[] = [];
    for (const point of list) {
      while (result.length >= 2) {
        const a = result.at(-2),
          b = result.at(-1);
        if (!a || !b || cross(a, b, point) > 0) break;
        result.pop();
      }
      result.push(point);
    }
    return result;
  }
  return [
    ...half(sorted).slice(0, -1),
    ...half([...sorted].reverse()).slice(0, -1),
  ];
}
function spline(controls: Point[], steps = 2048): Point[] {
  return Array.from({ length: steps }, (_, i) => {
    const value = (i * controls.length) / steps,
      index = Math.floor(value),
      t = value - index,
      t2 = t * t,
      t3 = t2 * t;
    const a = controls[(index + controls.length - 1) % controls.length],
      b = controls[index],
      c = controls[(index + 1) % controls.length],
      d = controls[(index + 2) % controls.length];
    if (!a || !b || !c || !d) throw new Error('Incomplete loop controls');
    const wa = (1 - 3 * t + 3 * t2 - t3) / 6,
      wb = (4 - 6 * t2 + 3 * t3) / 6,
      wc = (1 + 3 * t + 3 * t2 - 3 * t3) / 6,
      wd = t3 / 6;
    return {
      x: a.x * wa + b.x * wb + c.x * wc + d.x * wd,
      z: a.z * wa + b.z * wb + c.z * wc + d.z * wd,
    };
  });
}
function length(points: Point[]): number {
  return points.reduce((sum, p, i) => {
    const n = points[(i + 1) % points.length];
    return sum + (n ? Math.hypot(n.x - p.x, n.z - p.z) : 0);
  }, 0);
}
/** C2 compact hill: height, grade and vertical curvature are exactly zero at both ends. */
function bump(
  s: number,
  from: number,
  span: number,
  height: number
): { y: number; grade: number; verticalCurvature: number } {
  const t = (s - from) / span;
  if (t <= 0 || t >= 1) return { y: 0, grade: 0, verticalCurvature: 0 };
  const t2 = t * t,
    t3 = t2 * t,
    t4 = t3 * t,
    t5 = t4 * t,
    t6 = t5 * t;
  return {
    y: height * 64 * (t3 - 3 * t4 + 3 * t5 - t6),
    grade: (height * (192 * t2 - 768 * t3 + 960 * t4 - 384 * t5)) / span,
    verticalCurvature:
      (height * (384 * t - 2304 * t2 + 3840 * t3 - 1920 * t4)) / (span * span),
  };
}
export function addCircuitElevation(flat: Track): Track {
  const track: Track = {
    ...flat,
    schemaVersion: 2,
    samples: flat.samples.map((p) => {
      const jump = bump(p.s, 22, 48, 4);
      const hill = bump(p.s, flat.totalLength * 0.48 - 65, 130, 2.8);
      return {
        ...p,
        curvature: p.curvature || 0,
        y: q(jump.y + hill.y),
        grade: q(jump.grade + hill.grade),
        verticalCurvature: q(jump.verticalCurvature + hill.verticalCurvature),
      };
    }),
  };
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
  return track;
}

/** One road crosses itself twice in progress; only the later pass is raised. */
export function addOverpassElevation(flat: Track): Track {
  let crossingS = -1;
  for (let i = 0; i < flat.samples.length && crossingS < 0; i++) {
    const a = flat.samples[i],
      b = flat.samples[i + 1];
    if (!a || !b) continue;
    for (let j = i + 20; j < flat.samples.length - 1; j++) {
      const c = flat.samples[j],
        d = flat.samples[j + 1];
      if (
        !c ||
        !d ||
        flat.totalLength - (c.s - a.s) < 20 ||
        !segmentsIntersect(a, b, c, d)
      )
        continue;
      const dx = b.x - a.x,
        dz = b.z - a.z,
        ex = d.x - c.x,
        ez = d.z - c.z;
      const determinant = dx * ez - dz * ex;
      if (Math.abs(determinant) < 1e-9) continue;
      const u = ((c.x - a.x) * dz - (c.z - a.z) * dx) / determinant;
      crossingS = c.s + Math.hypot(ex, ez) * u;
      break;
    }
  }
  if (crossingS < 120 || crossingS > flat.totalLength - 120)
    throw new Error('Crossing has no bridge runway');
  const smooth = (t: number) => t * t * t * (10 + t * (-15 + 6 * t));
  const profile = (s: number) => {
    const distance = Math.abs(s - crossingS),
      t = (94 - distance) / 70;
    if (t <= 0) return { y: 0, grade: 0, verticalCurvature: 0 };
    if (t >= 1) return { y: 6, grade: 0, verticalCurvature: 0 };
    return {
      y: q(6 * smooth(t)),
      grade: q(
        (-Math.sign(s - crossingS) * 6 * 30 * t * t * (1 - t) * (1 - t)) / 70
      ),
      verticalCurvature: q(
        (6 * (60 * t - 180 * t * t + 120 * t * t * t)) / (70 * 70)
      ),
    };
  };
  const track: Track = {
    ...flat,
    schemaVersion: 2,
    samples: flat.samples.map((p) => ({ ...p, ...profile(p.s) })),
  };
  validateTrack(track);
  return track;
}
export function generateElevatedCandidate(
  seed: string,
  attempt = 1,
  config: GeneratorConfig = normalizeElevatedGeneratorConfig()
): {
  track: Track | null;
  accepted: AcceptedCircuitDiagnostics;
  codes: string[];
} {
  const random = randomFor(
    `${ELEVATED_GENERATOR_VERSION}|${seed}|${attempt}|${JSON.stringify({ ...config, maxAttempts: 12 })}`
  );
  const crossing = random() < 0.4;
  let controls: Point[];
  if (crossing) {
    const stretch = 0.9 + random() * 0.2;
    const bulge = 0.85 + random() * 0.3;
    controls = [
      [-90, -70],
      [-55, -43],
      [-20, -16],
      [20, 16],
      [55, 43],
      [90, 70],
      [150, 65],
      [190, 35],
      [145, 0],
      [190, -35],
      [150, -65],
      [90, -70],
      [55, -43],
      [20, -16],
      [-20, 16],
      [-55, 43],
      [-90, 70],
      [-135, 65],
      [-160, 30],
      [-160, -30],
      [-135, -65],
    ].map(([x, z]) => {
      if (x === undefined || z === undefined)
        throw new Error('Missing crossing control');
      return { x: x * stretch, z: z * bulge };
    });
  } else {
    const points = Array.from({ length: 9 + Math.floor(random() * 7) }, () => ({
      x: (random() - 0.5) * 180,
      z: (random() - 0.5) * 180,
    }));
    const ring = hull(points);
    while (ring.length > 4) {
      let shortest = 25,
        remove = -1;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        if (a && b) {
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d < shortest) {
            shortest = d;
            remove = (i + 1) % ring.length;
          }
        }
      }
      if (remove < 0) break;
      ring.splice(remove, 1);
    }
    if (ring.length < 3) throw new Error('Degenerate hull');
    let longest = 0;
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length],
        c = ring[longest],
        d = ring[(longest + 1) % ring.length];
      if (
        a &&
        b &&
        c &&
        d &&
        Math.hypot(b.x - a.x, b.z - a.z) > Math.hypot(d.x - c.x, d.z - c.z)
      )
        longest = i;
    }
    controls = [];
    const notches = 1 + Math.floor(random() * 3);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(longest + i) % ring.length],
        b = ring[(longest + i + 1) % ring.length];
      if (!a || !b) throw new Error('Incomplete hull');
      const dx = b.x - a.x,
        dz = b.z - a.z,
        edge = Math.hypot(dx, dz),
        nx = -dz / edge,
        nz = dx / edge;
      controls.push(a);
      if (i === 0) {
        for (let j = 1; j < 10; j++)
          controls.push({ x: a.x + (dx * j) / 10, z: a.z + (dz * j) / 10 });
      } else {
        const depth =
          edge * (0.14 + random() * 0.3) * (i <= notches ? 1 : -0.35);
        if (i <= notches && edge > 40) {
          for (const [t, inset] of [
            [0.23, 0],
            [0.36, depth],
            [0.64, depth],
            [0.77, 0],
          ]) {
            if (t === undefined || inset === undefined)
              throw new Error('Incomplete notch');
            controls.push({
              x: a.x + dx * t + nx * inset,
              z: a.z + dz * t + nz * inset,
            });
          }
        } else
          controls.push({
            x: (a.x + b.x) / 2 + nx * depth,
            z: (a.z + b.z) / 2 + nz * depth,
          });
      }
    }
  }
  for (let pass = 0; pass < (crossing ? 0 : 3); pass++) {
    const before = controls;
    controls = before.map((p, i) => {
      if (i >= 1 && i <= 8) return p;
      const a = before[(i + before.length - 1) % before.length],
        b = before[(i + 1) % before.length];
      if (!a || !b) throw new Error('Incomplete fairing loop');
      return { x: (a.x + 2 * p.x + b.x) / 4, z: (a.z + 2 * p.z + b.z) / 4 };
    });
  }
  let dense = spline(controls);
  const scale =
    (config.lengthMin + random() * (config.lengthMax - config.lengthMin)) /
    length(dense);
  const angle = random() * Math.PI * 2,
    co = Math.cos(angle),
    si = Math.sin(angle);
  const transform = (p: Point): Point => ({
    x: scale * (p.x * co - p.z * si),
    z: scale * (p.x * si + p.z * co),
  });
  dense = dense.map(transform);
  const empty: AcceptedCircuitDiagnostics = {
    candidateSeed: `${seed}:attempt:${attempt}`,
    motifs: [
      'straight',
      'hairpin',
      's-bend',
      'sweeper',
      crossing ? 'overpass' : 'gap-jump',
    ],
    controlPoints: controls.map(transform),
    length: 0,
    minRadius: 0,
    minClearance: 0,
    longestStraight: 0,
    startStraight: 0,
    directionChanges: 0,
    curvatureProfile: [],
  };
  try {
    const options = {
      seed,
      generatorVersion: ELEVATED_GENERATOR_VERSION,
      width: config.width,
      sampleSpacing: 1,
      checkpointCount: 8,
    };
    const preview = createTrackFromPoints(dense, options);
    const straight = findLongestStraight(preview);
    const from = (straight.startS + 2) % preview.totalLength;
    let cumulative = 0,
      index = 0;
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1],
        b = dense[i];
      if (!a || !b) throw new Error('Incomplete dense loop');
      cumulative += Math.hypot(b.x - a.x, b.z - a.z);
      if (cumulative >= from) {
        index = i;
        break;
      }
    }
    const flat = createTrackFromPoints(
      [...dense.slice(index), ...dense.slice(0, index)],
      options
    );
    const track = crossing
      ? addOverpassElevation(flat)
      : addCircuitElevation(flat);
    const structure = assessTrackStructure(track, {
      minRadius: config.minRadius,
      clearance: config.clearance,
      shoulder: config.shoulder,
    });
    const codes = [...structure.codes];
    if (structure.metrics.startStraight < (crossing ? 75 : 95))
      codes.push('jump-runway');
    if (codes.length)
      return {
        track: null,
        accepted: { ...empty, ...structure.metrics },
        codes,
      };
    return { track, accepted: { ...empty, ...structure.metrics }, codes: [] };
  } catch {
    return { track: null, accepted: empty, codes: ['malformed'] };
  }
}

export const ELEVATED_RESERVE_SEED = 'country-reserve-0';
export const ELEVATED_RESERVE_ATTEMPT = 1;
export function generateElevatedCircuit(
  seed: string,
  overrides: Partial<GeneratorConfig> = {}
): ValidatedCircuit {
  if (typeof seed !== 'string' || !seed.length || seed.length > 96)
    throw new Error('Circuit seed must contain 1–96 characters');
  const config = normalizeElevatedGeneratorConfig(overrides);
  const diagnostics: ValidatedDiagnostics = {
    requestedSeed: seed,
    version: ELEVATED_GENERATOR_VERSION,
    config,
    attempts: 0,
    fallbackUsed: false,
    rejections: [],
    accepted: {
      candidateSeed: '',
      motifs: [],
      controlPoints: [],
      length: 0,
      minRadius: 0,
      minClearance: 0,
      longestStraight: 0,
      startStraight: 0,
      directionChanges: 0,
      curvatureProfile: [],
    },
    qualityVersion: ELEVATED_QUALITY_VERSION,
    qualityAttempts: 0,
    qualityRejections: [],
    validationWork: {
      candidates: 0,
      qualityAssessments: 0,
      reserveAssessments: 0,
      controllerRuns: 0,
      simulatedTicks: 0,
      replayChecks: 0,
    },
  };
  function assess(track: Track) {
    const quality = assessTrackQuality(track, {
      structure: {
        minRadius: config.minRadius,
        clearance: config.clearance,
        shoulder: config.shoulder,
      },
    });
    diagnostics.validationWork.qualityAssessments++;
    diagnostics.validationWork.controllerRuns += quality.work.controllerRuns;
    diagnostics.validationWork.simulatedTicks += quality.work.simulatedTicks;
    diagnostics.validationWork.replayChecks += quality.work.replayChecks;
    return quality;
  }
  for (
    let attempt = 1;
    attempt <= config.maxAttempts && diagnostics.qualityAttempts < 8;
    attempt++
  ) {
    diagnostics.attempts = attempt;
    diagnostics.validationWork.candidates++;
    const candidate = generateElevatedCandidate(seed, attempt, config);
    if (!candidate.track) {
      diagnostics.rejections.push({ attempt, codes: candidate.codes });
      continue;
    }
    diagnostics.qualityAttempts++;
    const quality = assess(candidate.track);
    if (!quality.valid) {
      diagnostics.rejections.push({
        attempt,
        codes: quality.codes.map((c) => `quality:${c}`),
      });
      diagnostics.qualityRejections.push({
        attempt,
        candidateSeed: candidate.accepted.candidateSeed,
        codes: quality.codes,
      });
      continue;
    }
    diagnostics.accepted = candidate.accepted;
    return { track: candidate.track, diagnostics, quality };
  }
  const reserve = generateElevatedCandidate(
    ELEVATED_RESERVE_SEED,
    ELEVATED_RESERVE_ATTEMPT,
    config
  );
  diagnostics.validationWork.candidates++;
  diagnostics.validationWork.reserveAssessments++;
  if (!reserve.track)
    throw new Error(
      `Elevated reserve is structurally invalid: ${reserve.codes.join(',')}`
    );
  const quality = assess(reserve.track);
  if (!quality.valid)
    throw new Error(
      `Elevated reserve fails quality: ${quality.codes.join(',')}`
    );
  diagnostics.accepted = reserve.accepted;
  diagnostics.fallbackUsed = true;
  return { track: reserve.track, diagnostics, quality };
}
