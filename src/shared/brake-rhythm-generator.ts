import { createTrackFromPoints, type TrackPoint } from './track-authoring';
import { assessTrackStructure } from './circuit-validation';
import { validateTrack, type Track } from './track';

export const BRAKE_RHYTHM_VERSION = 'other-tracks-v2';
export type BrakeMotifKind =
  | 'fast-straight'
  | 'hairpin'
  | 'double-hairpin'
  | 'flowing-s'
  | 'chicane'
  | 'switchback'
  | 'tightening-corner'
  | 'sweeper'
  | 'recovery';
export type BrakeMotifConfig = {
  hairpinRadius: number;
  flowRadius: number;
  entryRadius: number;
  tighteningRadius: number;
  technicalRadius: number;
  straightLength: number;
  recoveryLength: number;
  transitionLength: number;
};
export const BRAKE_MOTIF_DEFAULTS: Readonly<BrakeMotifConfig> = Object.freeze({
  hairpinRadius: 16,
  flowRadius: 95,
  entryRadius: 32,
  tighteningRadius: 27,
  technicalRadius: 20,
  straightLength: 85,
  recoveryLength: 24,
  transitionLength: 5,
});
type Path = {
  points: TrackPoint[];
  x: number;
  z: number;
  heading: number;
  length: number;
};
export type BrakeMotifSection = {
  kind: BrakeMotifKind;
  start: number;
  end: number;
  entryTangent: number;
  exitTangent: number;
  difficulty: 'easy' | 'medium' | 'hard';
};
function path(): Path {
  return { points: [{ x: 0, z: 0 }], x: 0, z: 0, heading: 0, length: 0 };
}
function advance(
  p: Path,
  length: number,
  curvature: (fraction: number) => number
) {
  const count = Math.max(1, Math.ceil(length / 0.2));
  const ds = length / count;
  for (let i = 0; i < count; i++) {
    const turn = curvature((i + 0.5) / count) * ds;
    p.x += Math.cos(p.heading + turn / 2) * ds;
    p.z += Math.sin(p.heading + turn / 2) * ds;
    p.heading += turn;
    p.length += ds;
    p.points.push({ x: p.x, z: p.z });
  }
}
function straight(p: Path, length: number) {
  if (length > 0.000001) advance(p, length, () => 0);
}
/** Bounded linear-curvature ramps remove instantaneous tangent/curvature switches. */
function turn(p: Path, degrees: number, radius: number, transition: number) {
  const angle = (Math.abs(degrees) * Math.PI) / 180,
    ramp = Math.min(transition, (radius * angle) / 3);
  const length = radius * angle + ramp;
  const weight = (t: number) =>
    Math.min(1, (t * length) / ramp, ((1 - t) * length) / ramp);
  const count = Math.ceil(length / 0.2);
  let mean = 0;
  for (let i = 0; i < count; i++) mean += weight((i + 0.5) / count) / count;
  advance(
    p,
    length,
    (t) => ((Math.sign(degrees) * angle) / (length * mean)) * weight(t)
  );
}
function append(p: Path, local: Path) {
  const c = Math.cos(p.heading),
    s = Math.sin(p.heading),
    x = p.x,
    z = p.z;
  for (const point of local.points.slice(1))
    p.points.push({
      x: x + point.x * c - point.z * s,
      z: z + point.x * s + point.z * c,
    });
  p.x = x + local.x * c - local.z * s;
  p.z = z + local.x * s + local.z * c;
  p.heading += local.heading;
  p.length += local.length;
}
export function createBrakeMotif(
  kind: BrakeMotifKind,
  overrides: Partial<BrakeMotifConfig> = {}
): Path {
  const c = { ...BRAKE_MOTIF_DEFAULTS, ...overrides };
  if (
    Object.keys(overrides).some(
      (key) => !Object.hasOwn(BRAKE_MOTIF_DEFAULTS, key)
    ) ||
    !Object.values(c).every(Number.isFinite) ||
    c.hairpinRadius < 11 ||
    c.flowRadius < 20 ||
    c.entryRadius < 20 ||
    c.tighteningRadius < 11 ||
    c.technicalRadius < 11 ||
    c.straightLength < 30 ||
    c.recoveryLength < 10 ||
    c.transitionLength < 2 ||
    c.transitionLength > 12 ||
    Object.values(c).some((v) => v > 200)
  )
    throw new Error('Invalid brake motif configuration');
  const p = path(),
    r = c.transitionLength;
  const u = () => {
    turn(p, -90, c.entryRadius, r);
    straight(p, 16);
    turn(p, 180, c.hairpinRadius, r);
    straight(p, 16);
    turn(p, -90, c.entryRadius, r);
  };
  const slalom = (angle: number, radius: number) => {
    turn(p, -angle, radius, r);
    turn(p, 2 * angle, radius, r);
    turn(p, -angle, radius, r);
  };
  switch (kind) {
    case 'fast-straight':
      straight(p, c.straightLength);
      break;
    case 'recovery':
      straight(p, c.recoveryLength);
      break;
    case 'hairpin':
      u();
      break;
    case 'double-hairpin':
      u();
      straight(p, c.recoveryLength);
      u();
      break;
    case 'flowing-s':
      slalom(12, c.flowRadius);
      break;
    case 'chicane':
      slalom(55, c.technicalRadius);
      break;
    case 'switchback':
      slalom(75, c.technicalRadius);
      break;
    case 'sweeper':
      turn(p, 90, c.flowRadius, r);
      break;
    case 'tightening-corner':
      // Smoothly rises to stronger curvature then relaxes at the exit.
      // Numerical angle normalization guarantees the declared 90-degree tangent.
      {
        const count = 600;
        const weights = Array.from({ length: count }, (_, i) => {
          const t = (i + 0.5) / count;
          return Math.sin(Math.PI * t) * (0.55 + 1.1 * t);
        });
        const sum = weights.reduce((a, b) => a + b, 0) / count;
        const length =
          ((Math.PI / 2) * c.tighteningRadius * Math.max(...weights)) / sum;
        const ds = length / count;
        for (const w of weights) {
          const k = ((w / sum) * (Math.PI / 2)) / length;
          const a = k * ds;
          p.x += Math.cos(p.heading + a / 2) * ds;
          p.z += Math.sin(p.heading + a / 2) * ds;
          p.heading += a;
          p.length += ds;
          p.points.push({ x: p.x, z: p.z });
        }
      }
      break;
  }
  return p;
}
function rng(seed: string) {
  let n = 2166136261;
  for (const c of seed) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

function composeBrakeRhythm(
  seed: string,
  attempt = 1,
  overrides: Partial<BrakeMotifConfig> = {},
  fixedKind?: BrakeMotifKind
) {
  if (
    !seed.length ||
    seed.length > 96 ||
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    attempt > 32
  )
    throw new Error('Invalid rhythm seed/attempt');
  const random = rng(BRAKE_RHYTHM_VERSION + '|' + seed + '|' + attempt);
  const config = {
    ...BRAKE_MOTIF_DEFAULTS,
    hairpinRadius: 14 + random() * 4,
    flowRadius: 90 + random() * 10,
    entryRadius: 28 + random() * 8,
    tighteningRadius: 24 + random() * 6,
    technicalRadius: 18 + random() * 5,
    straightLength: 75 + random() * 25,
    ...overrides,
  };
  const memorable: BrakeMotifKind =
    random() < 0.22 ? 'double-hairpin' : 'hairpin';
  const technical: BrakeMotifKind = random() < 0.5 ? 'chicane' : 'switchback';
  const tighterClosure = memorable !== 'double-hairpin' && random() < 0.3;
  const sides: BrakeMotifKind[][] = [
    ['fast-straight', memorable, 'recovery'],
    memorable === 'double-hairpin' ? ['recovery'] : ['flowing-s', 'recovery'],
    memorable === 'double-hairpin' || tighterClosure
      ? ['recovery']
      : [technical, 'recovery'],
    ['recovery'],
  ];
  if (fixedKind) {
    sides.splice(
      0,
      4,
      fixedKind === 'tightening-corner' || fixedKind === 'sweeper'
        ? ['fast-straight', 'recovery']
        : ['fast-straight', fixedKind, 'recovery'],
      ['recovery'],
      ['recovery'],
      ['recovery']
    );
  }
  const locals = sides.map((kinds) => {
    const p = path();
    for (const kind of kinds) append(p, createBrakeMotif(kind, config));
    return p;
  });
  const widths = [
    Math.max(locals[0]!.x, locals[2]!.x),
    Math.max(locals[1]!.x, locals[3]!.x),
  ];
  const p = path(),
    motifs: BrakeMotifSection[] = [];
  function add(kind: BrakeMotifKind) {
    const start = p.length,
      entryTangent = p.heading;
    append(p, createBrakeMotif(kind, config));
    motifs.push({
      kind,
      start,
      end: p.length,
      entryTangent,
      exitTangent: p.heading,
      difficulty: [
        'hairpin',
        'double-hairpin',
        'switchback',
        'tightening-corner',
      ].includes(kind)
        ? 'hard'
        : 'easy',
    });
  }
  for (let side = 0; side < 4; side++) {
    for (const kind of sides[side]!) add(kind);
    straight(p, widths[side % 2]! - locals[side]!.x);
    add(
      fixedKind
        ? fixedKind === 'tightening-corner'
          ? 'tightening-corner'
          : 'sweeper'
        : tighterClosure && side % 2 === 0
          ? 'tightening-corner'
          : 'sweeper'
    );
  }
  const closure = Math.hypot(p.x, p.z);
  if (closure > 0.02)
    throw new Error('Rhythm composition did not close: ' + closure);
  // Numerical integration endpoints close within millimetres; omit duplicate.
  p.points.pop();
  const flat = createTrackFromPoints(p.points, {
    seed,
    generatorVersion: BRAKE_RHYTHM_VERSION,
    width: 7,
    sampleSpacing: 1,
    checkpointCount: 8,
  });
  const track: Track = {
    ...flat,
    schemaVersion: 2,
    samples: flat.samples.map((s) => ({
      ...s,
      y: 0,
      grade: 0,
      verticalCurvature: 0,
    })),
    jumps: [],
  };
  validateTrack(track);
  const structure = assessTrackStructure(track, {
    minRadius: 10,
    clearance: 2,
    shoulder: 0.8,
  });
  return { track, motifs, config, structure };
}

export function generateBrakeRhythmCandidate(
  seed: string,
  attempt = 1,
  overrides: Partial<BrakeMotifConfig> = {}
) {
  return composeBrakeRhythm(seed, attempt, overrides);
}
/** Isolated motif with neutral straight/sweeper closure, not an accepted random course. */
export function generateFixedBrakeMotifCourse(
  kind: BrakeMotifKind,
  overrides: Partial<BrakeMotifConfig> = {}
) {
  return composeBrakeRhythm(
    'fixed-v2:' + kind,
    1,
    { ...BRAKE_MOTIF_DEFAULTS, ...overrides },
    kind
  );
}
