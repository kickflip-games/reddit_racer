import { createTrackFromPoints } from './track-authoring.ts';
import {
  assessTrackStructure,
  findLongestStraight,
  MIN_START_STRAIGHT,
} from './circuit-validation.ts';
import type { StructuralMetrics } from './circuit-validation.ts';
import type { Track } from './track.ts';

export const GENERATOR_VERSION = 'motif-loop-v1';
export type MotifKind =
  | 'hairpin'
  | 's-bend'
  | 'decreasing-radius'
  | 'sweeper'
  | 'straight'
  | 'recovery'
  | 'overpass'
  | 'gap-jump';
export const MOTIF_KINDS: readonly MotifKind[] = [
  'hairpin',
  's-bend',
  'decreasing-radius',
  'sweeper',
  'straight',
  'recovery',
];
export type GeneratorConfig = {
  width: number;
  lengthMin: number;
  lengthMax: number;
  minRadius: number;
  clearance: number;
  shoulder: number;
  maxAttempts: number;
};
export const DEFAULT_GENERATOR_CONFIG: Readonly<GeneratorConfig> =
  Object.freeze({
    width: 7,
    lengthMin: 350,
    lengthMax: 500,
    minRadius: 10,
    clearance: 2,
    shoulder: 0.8,
    maxAttempts: 12,
  });
type Point = { x: number; z: number };
export type AcceptedCircuitDiagnostics = StructuralMetrics & {
  candidateSeed: string;
  motifs: MotifKind[];
  controlPoints: Point[];
};
export type GenerationDiagnostics = {
  requestedSeed: string;
  version: string;
  config: GeneratorConfig;
  attempts: number;
  fallbackUsed: boolean;
  rejections: { attempt: number; codes: string[] }[];
  accepted: AcceptedCircuitDiagnostics;
};
export type GeneratedCircuit = {
  track: Track;
  diagnostics: GenerationDiagnostics;
};
export type CircuitCandidate = {
  track: Track | null;
  diagnostics: AcceptedCircuitDiagnostics & { codes: string[] };
};

export function normalizeGeneratorConfig(
  overrides: Partial<GeneratorConfig> = {}
): GeneratorConfig {
  const config = { ...DEFAULT_GENERATOR_CONFIG, ...overrides };
  if (
    Object.keys(overrides).some(
      (key) => !Object.hasOwn(DEFAULT_GENERATOR_CONFIG, key)
    ) ||
    !Object.values(config).every(Number.isFinite) ||
    config.width < 5 ||
    config.width > 10 ||
    config.lengthMin < 300 ||
    config.lengthMax > 600 ||
    config.lengthMax < config.lengthMin ||
    config.minRadius < 7 ||
    config.minRadius > 50 ||
    config.clearance < 1 ||
    config.clearance > 10 ||
    config.shoulder < 0 ||
    config.shoulder > 2 ||
    !Number.isInteger(config.maxAttempts) ||
    config.maxAttempts < 1 ||
    config.maxAttempts > 12
  )
    throw new Error('Generator configuration exceeds supported bounds');
  return config;
}
function checkSeed(seed: string): void {
  if (typeof seed !== 'string' || !seed.length || seed.length > 96)
    throw new Error('Circuit seed must contain 1–96 characters');
}
function randomFor(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++)
    state = Math.imul(state ^ seed.charCodeAt(index), 16777619) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const a = result[index],
      b = result[swap];
    if (a !== undefined && b !== undefined) {
      result[index] = b;
      result[swap] = a;
    }
  }
  return result;
}
function pointAt(angle: number, radius: number): Point {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
function splinePoint(controls: Point[], position: number): Point {
  const index = Math.floor(position),
    t = position - index;
  const weights = [
    (1 - t) ** 3 / 6,
    (3 * t ** 3 - 6 * t * t + 4) / 6,
    (-3 * t ** 3 + 3 * t * t + 3 * t + 1) / 6,
    t ** 3 / 6,
  ];
  let x = 0,
    z = 0;
  for (let offset = 0; offset < 4; offset++) {
    const control = controls[(index + offset) % controls.length],
      weight = weights[offset];
    if (!control || weight === undefined)
      throw new Error('Incomplete spline control group');
    x += control.x * weight;
    z += control.z * weight;
  }
  return { x, z };
}
function closedLength(points: Point[]): number {
  return points.reduce((length, point, index) => {
    const next = points[(index + 1) % points.length];
    return next
      ? length + Math.hypot(next.x - point.x, next.z - point.z)
      : length;
  }, 0);
}
function hairpinControls(
  angle: number,
  span: number,
  random: () => number
): Point[] {
  const halfSpan = span / 2;
  const halfMouth = Math.sin(halfSpan);
  const mouthHeight = Math.cos(halfSpan);
  const turnRadius = 0.24 + random() * 0.03;
  const mouthRadius = 0.22 + random() * 0.03;
  const bottomCenter = turnRadius + 0.03 + random() * 0.04;
  const points: Point[] = [];
  const line = (from: Point, to: Point): void => {
    const count = Math.max(
      1,
      Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.13)
    );
    for (let index = 0; index < count; index++) {
      const fraction = index / count;
      points.push({
        x: from.x + (to.x - from.x) * fraction,
        z: from.z + (to.z - from.z) * fraction,
      });
    }
  };
  const arc = (
    center: Point,
    radius: number,
    from: number,
    to: number
  ): void => {
    const count = Math.max(2, Math.ceil((Math.abs(to - from) * radius) / 0.13));
    for (let index = 0; index < count; index++) {
      const theta = from + ((to - from) * index) / count;
      points.push({
        x: center.x + radius * Math.cos(theta),
        z: center.z + radius * Math.sin(theta),
      });
    }
  };
  line(
    { x: -halfMouth, z: mouthHeight },
    { x: -turnRadius - mouthRadius, z: mouthHeight }
  );
  arc(
    { x: -turnRadius - mouthRadius, z: mouthHeight - mouthRadius },
    mouthRadius,
    Math.PI / 2,
    0
  );
  line(
    { x: -turnRadius, z: mouthHeight - mouthRadius },
    { x: -turnRadius, z: bottomCenter }
  );
  arc({ x: 0, z: bottomCenter }, turnRadius, Math.PI, Math.PI * 2);
  line(
    { x: turnRadius, z: bottomCenter },
    { x: turnRadius, z: mouthHeight - mouthRadius }
  );
  arc(
    { x: turnRadius + mouthRadius, z: mouthHeight - mouthRadius },
    mouthRadius,
    Math.PI,
    Math.PI / 2
  );
  line(
    { x: turnRadius + mouthRadius, z: mouthHeight },
    { x: halfMouth, z: mouthHeight }
  );
  const middle = angle + halfSpan;
  return points.map((point) => ({
    x: Math.cos(middle) * point.z - Math.sin(middle) * point.x,
    z: Math.sin(middle) * point.z + Math.cos(middle) * point.x,
  }));
}

function controlsFor(random: () => number): {
  controls: Point[];
  motifs: MotifKind[];
} {
  const sectorCount = 6 + Math.floor(random() * 3);
  const extras = Array.from({ length: sectorCount - 6 }, (): MotifKind =>
    random() < 0.5 ? 's-bend' : 'sweeper'
  );
  const motifs = shuffle([...MOTIF_KINDS, ...extras], random);
  const weights = Array.from(
    { length: sectorCount },
    () => 0.9 + random() * 0.2
  );
  const hairpinSpan = 1.35 + random() * 0.15;
  const remainingWeight = weights.reduce(
    (sum, value, index) => sum + (motifs[index] === 'hairpin' ? 0 : value),
    0
  );
  let controls: Point[] = [];
  const straightLocks = new Set<number>();
  let hairpinRange: { start: number; end: number } | undefined;
  let angle = 0;
  for (let sector = 0; sector < sectorCount; sector++) {
    const motif = motifs[sector],
      weight = weights[sector];
    if (!motif || weight === undefined)
      throw new Error('Incomplete motif ring');
    const span =
      motif === 'hairpin'
        ? hairpinSpan
        : (weight / remainingWeight) * (Math.PI * 2 - hairpinSpan);
    const amplitude = (0.55 + random() * 0.35) * (span / (Math.PI / 3)) ** 2;
    if (motif === 'hairpin') {
      const start = controls.length;
      controls.push(...hairpinControls(angle, span, random));
      hairpinRange = { start, end: controls.length };
    } else if (motif === 'straight' || motif === 'recovery') {
      const count = motif === 'recovery' ? 12 : 10;
      const from = pointAt(angle, 1),
        to = pointAt(angle + span, 1);
      for (let index = 0; index < count; index++) {
        const fraction = index / count;
        if (index > 0 && index < count - 1) straightLocks.add(controls.length);
        controls.push({
          x: from.x + (to.x - from.x) * fraction,
          z: from.z + (to.z - from.z) * fraction,
        });
      }
    } else {
      const radii =
        motif === 's-bend'
          ? [1, 0.6, 0.68, 1.18]
          : motif === 'decreasing-radius'
            ? [1, 1, 1.12, 1.23]
            : [1, 1.02, 1.05, 1.02];
      const fractions =
        motif === 'decreasing-radius'
          ? [0, 0.28, 0.58, 0.82]
          : [0, 0.25, 0.5, 0.75];
      for (let index = 0; index < radii.length; index++) {
        const radius = radii[index],
          fraction = fractions[index];
        if (radius === undefined || fraction === undefined)
          throw new Error('Incomplete motif controls');
        controls.push(
          pointAt(angle + span * fraction, 1 + (radius - 1) * amplitude)
        );
      }
    }
    angle += span;
  }
  const fairingIndices = new Set<number>();
  if (hairpinRange)
    for (
      let index = hairpinRange.start - 3;
      index < hairpinRange.end + 3;
      index++
    )
      fairingIndices.add((index + controls.length) % controls.length);
  for (let pass = 0; pass < 4; pass++) {
    const previous = controls;
    controls = previous.map((point, index) => {
      if (straightLocks.has(index) || (pass >= 2 && !fairingIndices.has(index)))
        return point;
      const before = previous[(index + previous.length - 1) % previous.length];
      const after = previous[(index + 1) % previous.length];
      if (!before || !after) throw new Error('Incomplete fairing ring');
      return {
        x: (before.x + point.x * 2 + after.x) / 4,
        z: (before.z + point.z * 2 + after.z) / 4,
      };
    });
  }
  return { controls, motifs };
}

/** One bounded inspectable candidate; accepted output is still structural, not ranked quality. */
export function generateCircuitCandidate(
  seed: string,
  attempt = 1,
  overrides: Partial<GeneratorConfig> = {}
): CircuitCandidate {
  checkSeed(seed);
  const config = normalizeGeneratorConfig(overrides);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 12)
    throw new Error('Candidate attempt must be 1–12');
  const candidateSeed = `${seed}:attempt:${attempt}`;
  const fingerprint = JSON.stringify({
    width: config.width,
    lengthMin: config.lengthMin,
    lengthMax: config.lengthMax,
    minRadius: config.minRadius,
    clearance: config.clearance,
    shoulder: config.shoulder,
  });
  const random = randomFor(
    `${GENERATOR_VERSION}|${candidateSeed}|${fingerprint}`
  );
  const { controls, motifs } = controlsFor(random);
  const rotation = random() * Math.PI * 2,
    cosine = Math.cos(rotation),
    sine = Math.sin(rotation);
  const stretch = 0.9 + random() * 0.2;
  const transform = (point: Point): Point => ({
    x: point.x * stretch * cosine - (point.z / stretch) * sine,
    z: point.x * stretch * sine + (point.z / stretch) * cosine,
  });
  const transformedControls = controls.map(transform);
  let dense = Array.from({ length: 2048 }, (_, index) =>
    splinePoint(transformedControls, (index * controls.length) / 2048)
  );
  const targetLength =
    config.lengthMin + random() * (config.lengthMax - config.lengthMin);
  const scale = targetLength / closedLength(dense);
  dense = dense.map((point) => ({ x: point.x * scale, z: point.z * scale }));
  const controlPoints = transformedControls.map((point) => ({
    x: point.x * scale,
    z: point.z * scale,
  }));
  if (random() < 0.5) {
    dense.reverse();
    motifs.reverse();
  }
  const empty: AcceptedCircuitDiagnostics = {
    candidateSeed,
    motifs,
    controlPoints,
    length: targetLength,
    minRadius: 0,
    minClearance: 0,
    longestStraight: 0,
    startStraight: 0,
    directionChanges: 0,
    curvatureProfile: [],
  };
  let track: Track;
  try {
    const options = {
      seed,
      generatorVersion: GENERATOR_VERSION,
      width: config.width,
      sampleSpacing: 1,
      checkpointCount: 8,
    };
    const preview = createTrackFromPoints(dense, options);
    const straight = findLongestStraight(preview);
    const moveIntoStraight = Math.min(
      3,
      Math.max(0, straight.length - MIN_START_STRAIGHT - 1)
    );
    const startDistance =
      (straight.startS + moveIntoStraight) % preview.totalLength;
    let denseDistance = 0,
      startIndex = 0;
    for (let index = 1; index < dense.length; index++) {
      const previous = dense[index - 1],
        current = dense[index];
      if (!previous || !current) break;
      denseDistance += Math.hypot(
        current.x - previous.x,
        current.z - previous.z
      );
      if (denseDistance >= startDistance) {
        startIndex = index;
        break;
      }
    }
    dense = [...dense.slice(startIndex), ...dense.slice(0, startIndex)];
    track = createTrackFromPoints(dense, options);
  } catch {
    return {
      track: null,
      diagnostics: { ...empty, codes: ['authoring-geometry'] },
    };
  }
  const assessment = assessTrackStructure(track, config);
  const codes = [...assessment.codes];
  if (assessment.metrics.startStraight < MIN_START_STRAIGHT)
    codes.push('start-straight');
  if (assessment.metrics.directionChanges < 2) codes.push('corner-variety');
  if (
    track.totalLength < config.lengthMin - 0.2 ||
    track.totalLength > config.lengthMax + 0.2
  )
    codes.push('track-length');
  return {
    track,
    diagnostics: {
      ...assessment.metrics,
      candidateSeed,
      motifs,
      controlPoints,
      codes,
    },
  };
}

// This generated reserve candidate is pinned and structurally regression-tested.
export const FALLBACK_CIRCUIT_SEED = 'reserve-motif-v1';
export const FALLBACK_CIRCUIT_ATTEMPT = 1;

export function generateCircuit(
  seed: string,
  overrides: Partial<GeneratorConfig> = {}
): GeneratedCircuit {
  checkSeed(seed);
  const config = normalizeGeneratorConfig(overrides);
  const rejections: GenerationDiagnostics['rejections'] = [];
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const candidate = generateCircuitCandidate(seed, attempt, config);
    if (candidate.track && candidate.diagnostics.codes.length === 0) {
      const { codes: _codes, ...accepted } = candidate.diagnostics;
      return {
        track: candidate.track,
        diagnostics: {
          requestedSeed: seed,
          version: GENERATOR_VERSION,
          config,
          attempts: attempt,
          fallbackUsed: false,
          rejections,
          accepted,
        },
      };
    }
    rejections.push({ attempt, codes: candidate.diagnostics.codes });
  }
  const reserve = generateCircuitCandidate(
    FALLBACK_CIRCUIT_SEED,
    FALLBACK_CIRCUIT_ATTEMPT,
    config
  );
  if (!reserve.track || reserve.diagnostics.codes.length > 0)
    throw new Error(
      `No circuit passed bounded generation; reserve is incompatible with configuration (${reserve.diagnostics.codes.join(', ')})`
    );
  const { codes: _codes, ...accepted } = reserve.diagnostics;
  return {
    track: reserve.track,
    diagnostics: {
      requestedSeed: seed,
      version: GENERATOR_VERSION,
      config,
      attempts: config.maxAttempts,
      fallbackUsed: true,
      rejections,
      accepted,
    },
  };
}
