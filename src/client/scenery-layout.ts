import type { Track } from '../shared/track';
import { sampleTrack } from '../shared/track';
import { handlingForTrack } from '../shared/scored-runtime';
import { circuitTerrainHeight } from './circuit-terrain';
import { getTrackBounds } from './track-renderer';
import type { SceneryKind } from './scene-assets';
import type { GapJump } from '../shared/stunt-course';
import { gripSurfaceAt, type GripZone } from '../shared/slot-grip';

export const SCENERY_VERSION = 'spring-countryside-v1';
export const SCENERY_LIMITS = Object.freeze({
  regions: 40,
  candidates: 18000,
  plants: 5200,
  trees: 260,
  props: 64,
});
export type RegionKind =
  'grove' | 'meadow' | 'woodland' | 'grassland' | 'hedge' | 'clearing';
export type PlantKind =
  'blossom' | 'tree' | 'bush' | 'grass' | 'flower' | 'rock' | 'fence';
export type SceneryOptions = {
  seed?: string;
  regions?: number;
  trees?: number;
  groundCover?: number;
  quality?: 'standard' | 'light';
  wind?: boolean;
  lighting?: 'soft' | 'toon';
  jumps?: readonly GapJump[];
  gripZones?: readonly GripZone[];
};
export type Region = {
  id: number;
  kind: RegionKind;
  x: number;
  z: number;
  rx: number;
  rz: number;
  heading: number;
  phase: number;
  density: number;
};
export type Plant = {
  kind: PlantKind;
  x: number;
  y: number;
  z: number;
  heading: number;
  scale: number;
  radius: number;
  color: string;
  phase: number;
  region: number;
  detail: number;
};
export type RoadField = ReturnType<typeof createRoadField>;
export type GroundSurface = {
  minX: number;
  minZ: number;
  width: number;
  depth: number;
  nx: number;
  nz: number;
  heights: Float32Array;
};
export type SceneryLayout = {
  version: string;
  seed: string;
  regions: Region[];
  plants: Plant[];
  allPlants: Plant[];
  props: SceneryProp[];
  surface: GroundSurface;
  work: { candidates: number; accepted: number; segmentChecks: number };
  options: Required<Pick<SceneryOptions, 'quality' | 'wind' | 'lighting'>>;
};
export type SceneryProp = {
  kind: SceneryKind;
  x: number;
  z: number;
  heading: number;
  radius: number;
  scale?: number;
};
export const SPRING_PALETTE = Object.freeze({
  grass: ['#98ae73', '#a8b980', '#879e65', '#b3bd83'],
  flowers: ['#f0d3a0', '#e9b8bb', '#d9c5df', '#f5e9c7'],
  crowns: ['#dca3ad', '#edc0c0', '#ead9b1', '#f1e1bd'],
  greens: ['#547555', '#66835b', '#789268'],
  bushes: ['#778d59', '#8d9e65', '#5f7e56'],
});

export function sceneryHash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
function randomSource(seed: string) {
  let state = sceneryHash(seed);
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const density = (value: number | undefined) =>
  Number.isFinite(value) ? clamp(value ?? 1, 0, 1.8) : 1;
const pick = <T>(items: readonly T[], random: () => number): T => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error('Empty scenery palette');
  return item;
};

/** Exact closed-segment clearance; cheap AABB rejection precedes distance work. */
export function createRoadField(track: Track) {
  const segments = track.samples.map((a, i) => {
    const b = track.samples[(i + 1) % track.samples.length];
    if (!b) throw new Error('Empty road');
    return {
      a,
      dx: b.x - a.x,
      dz: b.z - a.z,
      halfWidth: Math.max(a.width, b.width) / 2,
    };
  });
  let checks = 0;
  return {
    get checks() {
      return checks;
    },
    sample(x: number, z: number) {
      let clearance = Infinity,
        nearestS = 0;
      for (const { a, dx, dz, halfWidth } of segments) {
        checks++;
        const boxX = Math.max(
          a.x - halfWidth + Math.min(0, dx) - x,
          0,
          x - a.x - halfWidth - Math.max(0, dx)
        );
        const boxZ = Math.max(
          a.z - halfWidth + Math.min(0, dz) - z,
          0,
          z - a.z - halfWidth - Math.max(0, dz)
        );
        if (clearance >= 0 && boxX * boxX + boxZ * boxZ > clearance * clearance)
          continue;
        const length2 = dx * dx + dz * dz;
        const t = length2
          ? clamp(((x - a.x) * dx + (z - a.z) * dz) / length2, 0, 1)
          : 0;
        const edge = Math.hypot(x - a.x - t * dx, z - a.z - t * dz) - halfWidth;
        if (edge < clearance) {
          clearance = edge;
          nearestS = a.s + t * Math.sqrt(length2);
        }
      }
      return { clearance, s: nearestS };
    },
  };
}
export function sceneryClearance(
  track: Track,
  x: number,
  z: number,
  radius: number,
  field = createRoadField(track)
): boolean {
  return (
    Number.isFinite(x + z + radius) &&
    radius >= 0 &&
    field.sample(x, z).clearance >=
      handlingForTrack(track).recoveryDistanceBeyondEdge + 2.3 + radius + 0.35
  );
}

/** The exact same triangle interpolation grounds vegetation and the rendered mesh. */
export function createGroundSurface(
  track: Track,
  zones: readonly GripZone[] = []
): GroundSurface {
  const bounds = getTrackBounds(track, 65),
    width = bounds.maxX - bounds.minX,
    depth = bounds.maxZ - bounds.minZ;
  const nx = Math.min(64, Math.ceil(width / 4)),
    nz = Math.min(64, Math.ceil(depth / 4));
  const heights = new Float32Array((nx + 1) * (nz + 1));
  const field = zones.length ? createRoadField(track) : null;
  for (let iz = 0; iz <= nz; iz++)
    for (let ix = 0; ix <= nx; ix++) {
      const x = bounds.minX + (ix * width) / nx,
        z = bounds.minZ + (iz * depth) / nz;
      let y = circuitTerrainHeight(track, x, z) - 0.12;
      if (field) {
        const nearest = field.sample(x, z),
          frame = sampleTrack(track, nearest.s);
        const bank = gripSurfaceAt(track, zones, nearest.s).bank;
        const lateral = (x - frame.x) * frame.nx + (z - frame.z) * frame.nz;
        y -=
          lateral * Math.tan(bank) * clamp((25 - nearest.clearance) / 10, 0, 1);
        if (Math.abs(bank) > 0.001)
          y -= 0.25 * clamp((5 - nearest.clearance) / 5, 0, 1);
      }
      heights[iz * (nx + 1) + ix] = y;
    }
  return {
    minX: bounds.minX,
    minZ: bounds.minZ,
    width,
    depth,
    nx,
    nz,
    heights,
  };
}
export function groundHeightAt(
  surface: GroundSurface,
  x: number,
  z: number
): number {
  const u = clamp(
      ((x - surface.minX) / surface.width) * surface.nx,
      0,
      surface.nx - 0.000001
    ),
    v = clamp(
      ((z - surface.minZ) / surface.depth) * surface.nz,
      0,
      surface.nz - 0.000001
    );
  const ix = Math.floor(u),
    iz = Math.floor(v),
    fx = u - ix,
    fz = v - iz,
    i = iz * (surface.nx + 1) + ix;
  const a = surface.heights[i] ?? -0.12,
    b = surface.heights[i + 1] ?? a,
    c = surface.heights[i + surface.nx + 1] ?? a,
    d = surface.heights[i + surface.nx + 2] ?? a;
  return fx + fz <= 1
    ? a + (b - a) * fx + (c - a) * fz
    : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
export function regionWeight(region: Region, x: number, z: number): number {
  const dx = x - region.x,
    dz = z - region.z,
    c = Math.cos(region.heading),
    s = Math.sin(region.heading);
  const u = (dx * c + dz * s) / region.rx,
    v = (-dx * s + dz * c) / region.rz;
  const wobble =
    1 +
    0.15 * Math.sin(Math.atan2(v, u) * 3 + region.phase) +
    0.1 * Math.sin(x * 0.17 + z * 0.11 + region.phase);
  return Math.max(0, 1 - Math.hypot(u, v) / wobble);
}
export function regionTint(
  layout: Pick<SceneryLayout, 'regions'>,
  x: number,
  z: number
): { kind: RegionKind; weight: number } {
  let kind: RegionKind = 'grassland',
    weight = 0;
  for (const region of layout.regions) {
    const w = regionWeight(region, x, z);
    if (w > weight) {
      kind = region.kind;
      weight = w;
    }
  }
  return { kind, weight };
}

/** Hierarchical regions -> irregular subclusters -> bounded, thinned plant samples. */
export function generateSceneryLayout(
  track: Track,
  options: SceneryOptions = {}
): SceneryLayout {
  const seed = `${track.seed}|${SCENERY_VERSION}|${options.seed ?? 'default'}`;
  const random = randomSource(seed),
    field = createRoadField(track),
    surface = createGroundSurface(track, options.gripZones);
  const regions: Region[] = [],
    plants: Plant[] = [],
    props: SceneryProp[] = [];
  const regionDensity = density(options.regions),
    treeDensity = density(options.trees),
    coverDensity = density(options.groundCover);
  const light = options.quality === 'light';
  let candidates = 0,
    trees = 0;
  const occupied = new Map<string, Plant[]>();
  function plant(
    kind: PlantKind,
    x: number,
    z: number,
    region: number,
    probability = 1,
    heading?: number
  ): void {
    if (
      candidates >= SCENERY_LIMITS.candidates ||
      plants.length >= SCENERY_LIMITS.plants
    )
      return;
    candidates++;
    const r = random();
    if (r > probability) return;
    const tall = kind === 'tree' || kind === 'blossom';
    if (tall && trees >= SCENERY_LIMITS.trees) return;
    const scale = tall
      ? 0.72 + random() * 0.65
      : kind === 'bush'
        ? 0.65 + random() * 0.65
        : 0.7 + random() * 0.7;
    const radius =
      (tall
        ? 2.7
        : kind === 'bush'
          ? 1.35
          : kind === 'rock'
            ? 0.9
            : kind === 'fence'
              ? 2
              : 0.5) * scale;
    if (
      x - radius < surface.minX ||
      x + radius > surface.minX + surface.width ||
      z - radius < surface.minZ ||
      z + radius > surface.minZ + surface.depth
    )
      return;
    const road = field.sample(x, z);
    const required =
      tall || kind === 'bush' || kind === 'rock' || kind === 'fence'
        ? handlingForTrack(track).recoveryDistanceBeyondEdge +
          2.3 +
          radius +
          0.35
        : 1.15 + radius;
    if (road.clearance < required || road.clearance > 70) return;
    if (
      tall &&
      (options.jumps?.some(
        (j) => road.s > j.rampStart - 15 && road.s < j.rampEnd + 18
      ) ||
        Math.abs(sampleTrack(track, road.s).grade ?? 0) > 0.13) &&
      road.clearance < 23
    )
      return;
    const cellX = Math.floor(x / 8),
      cellZ = Math.floor(z / 8);
    if (tall || kind === 'bush' || kind === 'rock' || kind === 'fence') {
      for (let ix = cellX - 1; ix <= cellX + 1; ix++)
        for (let iz = cellZ - 1; iz <= cellZ + 1; iz++)
          for (const other of occupied.get(`${ix},${iz}`) ?? [])
            if (
              Math.hypot(x - other.x, z - other.z) <
              radius + other.radius + 0.2
            )
              return;
    }
    const color = pick(
      kind === 'blossom'
        ? SPRING_PALETTE.crowns
        : kind === 'tree'
          ? SPRING_PALETTE.greens
          : kind === 'flower'
            ? SPRING_PALETTE.flowers
            : kind === 'bush'
              ? SPRING_PALETTE.bushes
              : kind === 'rock'
                ? ['#a29d88', '#b7b09c']
                : kind === 'fence'
                  ? ['#af956d', '#bea47e']
                  : SPRING_PALETTE.grass,
      random
    );
    const detail = random();
    const item: Plant = {
      kind,
      x,
      y: groundHeightAt(surface, x, z),
      z,
      heading: heading ?? random() * Math.PI * 2,
      radius,
      scale,
      color,
      phase: random() * Math.PI * 2,
      region,
      detail,
    };
    plants.push(item);
    if (tall) trees++;
    if (tall || kind === 'bush' || kind === 'rock' || kind === 'fence') {
      const key = `${cellX},${cellZ}`;
      const bucket = occupied.get(key) ?? [];
      bucket.push(item);
      occupied.set(key, bucket);
    }
  }
  const regionKinds: readonly RegionKind[] = [
    'grove',
    'grove',
    'meadow',
    'woodland',
    'woodland',
    'grassland',
    'hedge',
    'clearing',
  ];
  const count = Math.min(
    SCENERY_LIMITS.regions,
    Math.round((18 + track.totalLength / 60) * regionDensity)
  );
  for (let i = 0; i < count; i++) {
    const s = track.totalLength * ((i + 0.15 + random() * 0.7) / count),
      frame = sampleTrack(track, s);
    const side = random() < 0.5 ? -1 : 1,
      offset = frame.halfWidth + 17 + random() * 14;
    let kind = pick(regionKinds, random);
    if (Math.abs(frame.curvature) > 0.05)
      kind = side === -Math.sign(frame.curvature) ? 'grove' : 'meadow';
    else if (
      Math.abs(frame.curvature) > 0.008 &&
      side === -Math.sign(frame.curvature) &&
      i % 3 === 0
    )
      kind = 'meadow';
    if (Math.abs(frame.grade ?? 0) > 0.13) kind = 'clearing';
    const region: Region = {
      id: i,
      kind,
      x: frame.x + frame.nx * side * offset,
      z: frame.z + frame.nz * side * offset,
      rx: kind === 'hedge' ? 27 : 14 + random() * 17,
      rz: kind === 'hedge' ? 7 : 11 + random() * 17,
      heading: Math.atan2(frame.tz, frame.tx) + (random() - 0.5) * 0.7,
      phase: random() * Math.PI * 2,
      density: 0.65 + random() * 0.35,
    };
    regions.push(region);
    if (kind === 'clearing') continue;
    const clusters = Array.from(
      { length: 3 + Math.floor(random() * 4) },
      () => ({
        x: (random() - 0.5) * region.rx,
        z: (random() - 0.5) * region.rz,
      })
    );
    const attempts = Math.round(
      (kind === 'meadow' ? 420 : 250) * Math.max(coverDensity, treeDensity)
    );
    for (let j = 0; j < attempts; j++) {
      const cluster = pick(clusters, random);
      const gaussian = () =>
        (random() + random() + random() + random() - 2) * 0.6;
      const u = cluster.x + gaussian() * region.rx * 0.7,
        v = cluster.z + gaussian() * region.rz * 0.7;
      const x =
          region.x +
          u * Math.cos(region.heading) -
          v * Math.sin(region.heading),
        z =
          region.z +
          u * Math.sin(region.heading) +
          v * Math.cos(region.heading);
      const roll = random();
      const kindOfPlant: PlantKind =
        kind === 'grove' || kind === 'woodland'
          ? roll < 0.19
            ? kind === 'grove'
              ? 'blossom'
              : 'tree'
            : roll < 0.32
              ? 'bush'
              : roll < 0.53
                ? 'flower'
                : 'grass'
          : kind === 'hedge'
            ? roll < 0.5
              ? 'bush'
              : 'grass'
            : roll < 0.03
              ? 'rock'
              : roll < (kind === 'meadow' ? 0.7 : 0.26)
                ? 'flower'
                : 'grass';
      const factor =
        kindOfPlant === 'tree' || kindOfPlant === 'blossom'
          ? treeDensity
          : coverDensity;
      plant(
        kindOfPlant,
        x,
        z,
        i,
        regionWeight(region, x, z) * region.density * factor
      );
    }
  }
  // Unequal short strips leave deliberate gaps instead of lining the entire circuit.
  for (let strip = 0; strip < 24; strip++) {
    const start = random() * track.totalLength,
      length = 9 + random() * 22,
      side = random() < 0.5 ? -1 : 1;
    for (let j = 0; j < 44 * coverDensity; j++) {
      const f = sampleTrack(track, start + random() * length);
      const d = side * (f.halfWidth + 1.7 + random() * 6.5);
      plant(
        random() < 0.57 ? 'flower' : 'grass',
        f.x + f.nx * d,
        f.z + f.nz * d,
        -1,
        0.9
      );
    }
  }
  // Reuse selected Kenney conifers and racing landmarks within the new region layout.
  for (const p of plants
    .filter(
      (p) => p.kind === 'tree' || (p.kind === 'blossom' && p.detail < 0.25)
    )
    .slice(0, 32))
    props.push({
      kind: 'treeSmall',
      x: p.x,
      z: p.z,
      heading: p.heading,
      radius: p.radius,
      scale: Math.min(1, p.scale),
    });
  function prop(kind: SceneryKind, s: number, side: number, along = 0) {
    if (props.length >= SCENERY_LIMITS.props) return;
    const f = sampleTrack(track, s),
      radius = kind === 'pylon' ? 0.6 : 1.1,
      d = side * (f.halfWidth + 13 + radius);
    const x = f.x + f.nx * d + f.tx * along,
      z = f.z + f.nz * d + f.tz * along;
    if (sceneryClearance(track, x, z, radius, field))
      props.push({ kind, x, z, heading: Math.atan2(f.tx, f.tz), radius });
  }
  for (const side of [-1, 1]) {
    prop('flagCheckersSmall', 0, side);
    prop('pylon', 5, side);
  }
  for (const region of regions.filter((r) => r.kind === 'hedge').slice(0, 5)) {
    for (let j = 0; j < 4; j++) {
      const offset = (j - 1.5) * 4;
      plant(
        'fence',
        region.x + Math.cos(region.heading) * offset,
        region.z + Math.sin(region.heading) * offset,
        region.id,
        1,
        -region.heading
      );
    }
  }

  return {
    version: SCENERY_VERSION,
    seed,
    regions,
    allPlants: plants,
    plants: light
      ? plants.filter(
          (p) => p.kind === 'tree' || p.kind === 'blossom' || p.detail < 0.35
        )
      : plants,
    props,
    surface,
    work: {
      candidates,
      accepted: light
        ? plants.filter(
            (p) => p.kind === 'tree' || p.kind === 'blossom' || p.detail < 0.35
          ).length
        : plants.length,
      segmentChecks: field.checks,
    },
    options: {
      quality: light ? 'light' : 'standard',
      wind: options.wind ?? true,
      lighting: options.lighting ?? 'soft',
    },
  };
}
