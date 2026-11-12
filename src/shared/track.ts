/** Canonical data only: no renderer, platform, clock, or authoring dependencies. */
export type TrackSample = {
  x: number;
  z: number;
  s: number;
  tx: number;
  tz: number;
  curvature: number;
  /** Full road width in metres at this cross-section. */
  width: number;
};

export type TrackCheckpoint = { id: string; s: number };

export type Track = {
  schemaVersion: 1;
  generatorVersion: string;
  seed: string;
  totalLength: number;
  startS: 0;
  /** Ordered samples in [0, totalLength); the first point is not duplicated. */
  samples: TrackSample[];
  /** Intermediate checkpoints only; the start/finish is at startS. */
  checkpoints: TrackCheckpoint[];
};

export type TrackFrame = TrackSample & {
  /** Normal and effective width of the linearly interpolated road cross-section. */
  nx: number;
  nz: number;
  halfWidth: number;
};

const minimumSamples = 8;
const maximumSamples = 16_384;
const distanceTolerance = 0.0003;

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length || value.length > 128) {
    throw new Error(`${label} must contain 1–128 characters`);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse untrusted JSON into fresh canonical data, then validate its geometry. */
export function parseTrack(value: unknown): Track {
  if (!record(value)) throw new Error('Track must be an object');
  if (value.schemaVersion !== 1 || value.startS !== 0) {
    throw new Error('Unsupported track schema or start distance');
  }
  if (!Array.isArray(value.samples) || !Array.isArray(value.checkpoints)) {
    throw new Error('Track samples and checkpoints must be arrays');
  }
  if (value.samples.length > maximumSamples || value.checkpoints.length > 128) {
    throw new Error('Track exceeds geometry limits');
  }
  const samples = value.samples.map((sample: unknown): TrackSample => {
    if (!record(sample)) throw new Error('Track sample must be an object');
    return {
      x: finite(sample.x, 'sample.x'),
      z: finite(sample.z, 'sample.z'),
      s: finite(sample.s, 'sample.s'),
      tx: finite(sample.tx, 'sample.tx'),
      tz: finite(sample.tz, 'sample.tz'),
      curvature: finite(sample.curvature, 'sample.curvature'),
      width: finite(sample.width, 'sample.width'),
    };
  });
  const checkpoints = value.checkpoints.map(
    (checkpoint: unknown): TrackCheckpoint => {
      if (!record(checkpoint)) throw new Error('Checkpoint must be an object');
      return {
        id: text(checkpoint.id, 'checkpoint.id'),
        s: finite(checkpoint.s, 'checkpoint.s'),
      };
    }
  );
  const track: Track = {
    schemaVersion: 1,
    generatorVersion: text(value.generatorVersion, 'generatorVersion'),
    seed: text(value.seed, 'seed'),
    totalLength: finite(value.totalLength, 'totalLength'),
    startS: 0,
    samples,
    checkpoints,
  };
  validateTrack(track);
  return track;
}

/** Structural/metric guards. Global self-clearance and playability are #7 gates. */
export function validateTrack(track: Track): void {
  if (track.schemaVersion !== 1 || track.startS !== 0) {
    throw new Error('Unsupported track schema or start distance');
  }
  text(track.generatorVersion, 'generatorVersion');
  text(track.seed, 'seed');
  if (
    !Number.isFinite(track.totalLength) ||
    track.totalLength <= 0 ||
    track.totalLength > 1_000_000
  ) {
    throw new Error('Invalid track length');
  }
  if (
    track.samples.length < minimumSamples ||
    track.samples.length > maximumSamples
  ) {
    throw new Error('Track requires 8–16384 samples');
  }
  const first = track.samples[0];
  if (!first || first.s !== 0)
    throw new Error('First sample must start at zero');
  let cumulativeLength = 0;
  for (let index = 0; index < track.samples.length; index++) {
    const sample = track.samples[index];
    const next = track.samples[(index + 1) % track.samples.length];
    if (!sample || !next) throw new Error('Missing track sample');
    for (const value of [
      sample.x,
      sample.z,
      sample.s,
      sample.tx,
      sample.tz,
      sample.curvature,
      sample.width,
    ]) {
      finite(value, 'sample field');
    }
    if (Math.abs(sample.x) > 100_000 || Math.abs(sample.z) > 100_000) {
      throw new Error('Track coordinates exceed limits');
    }
    if (sample.width < 1 || sample.width > 100)
      throw new Error('Road width must be 1–100 metres');
    if (
      sample.s < 0 ||
      sample.s >= track.totalLength ||
      Math.abs(sample.s - cumulativeLength) > distanceTolerance
    ) {
      throw new Error('Samples must follow increasing cumulative arc length');
    }
    const tangentLength = Math.hypot(sample.tx, sample.tz);
    if (Math.abs(tangentLength - 1) > 0.00001)
      throw new Error('Track tangents must have unit length');
    if ((Math.abs(sample.curvature) * sample.width) / 2 >= 0.9) {
      throw new Error('Road is too wide for its local corner radius');
    }
    const chord = Math.hypot(next.x - sample.x, next.z - sample.z);
    if (chord < 0.001)
      throw new Error('Duplicate or near-duplicate track point');
    if (index < track.samples.length - 1 && next.s <= sample.s) {
      throw new Error('Sample distances must be strictly increasing');
    }
    // Tangents must agree with the forward road, including the closing segment.
    if (
      ((next.x - sample.x) * sample.tx + (next.z - sample.z) * sample.tz) /
        chord <
      0.5
    ) {
      throw new Error('Track tangent opposes its road segment');
    }
    cumulativeLength += chord;
  }
  if (Math.abs(cumulativeLength - track.totalLength) > distanceTolerance) {
    throw new Error('Track length must include the closing segment');
  }
  if (track.checkpoints.length > 128) throw new Error('Too many checkpoints');
  let lastCheckpoint = 0;
  const checkpointIds = new Set<string>();
  for (const checkpoint of track.checkpoints) {
    text(checkpoint.id, 'checkpoint.id');
    if (
      !Number.isFinite(checkpoint.s) ||
      checkpoint.s <= lastCheckpoint ||
      checkpoint.s >= track.totalLength ||
      checkpointIds.has(checkpoint.id)
    ) {
      throw new Error(
        'Checkpoints must have unique IDs and increasing interior distances'
      );
    }
    checkpointIds.add(checkpoint.id);
    lastCheckpoint = checkpoint.s;
  }
}

/** O(log n) sampling of already-validated data. Negative distances wrap too. */
export function sampleTrack(track: Track, distance: number): TrackFrame {
  if (!Number.isFinite(distance))
    throw new Error('Track distance must be finite');
  const wrapped =
    ((distance % track.totalLength) + track.totalLength) % track.totalLength;
  // Exact lap multiples can retain a few floating-point ulps after remainder.
  const s = wrapped < 1e-9 || track.totalLength - wrapped < 1e-9 ? 0 : wrapped;
  let low = 0;
  let high = track.samples.length;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    const sample = track.samples[middle];
    if (!sample) throw new Error('Missing track sample');
    if (sample.s <= s) low = middle;
    else high = middle;
  }
  const current = track.samples[low];
  const next = track.samples[(low + 1) % track.samples.length];
  if (!current || !next) throw new Error('Cannot sample an empty track');
  const endS = low + 1 === track.samples.length ? track.totalLength : next.s;
  const blend = (s - current.s) / (endS - current.s);
  const mix = (a: number, b: number): number => a + (b - a) * blend;
  // Blend the actual cross-section vectors, just as the mesh triangle strip does.
  const edgeX = mix(
    (-current.tz * current.width) / 2,
    (-next.tz * next.width) / 2
  );
  const edgeZ = mix(
    (current.tx * current.width) / 2,
    (next.tx * next.width) / 2
  );
  const halfWidth = Math.hypot(edgeX, edgeZ);
  if (halfWidth <= 0) throw new Error('Degenerate road cross-section');
  const nx = edgeX / halfWidth;
  const nz = edgeZ / halfWidth;
  return {
    x: mix(current.x, next.x),
    z: mix(current.z, next.z),
    s,
    tx: nz,
    tz: -nx,
    curvature: mix(current.curvature, next.curvature),
    width: halfWidth * 2,
    nx,
    nz,
    halfWidth,
  };
}

/** Lateral metres along the same cross-section used by the visible road mesh. */
export function roadPointAt(
  track: Track,
  distance: number,
  lateral: number
): { x: number; z: number } {
  if (!Number.isFinite(lateral))
    throw new Error('Lateral distance must be finite');
  const frame = sampleTrack(track, distance);
  return { x: frame.x + frame.nx * lateral, z: frame.z + frame.nz * lateral };
}

/** Fixed key order is the hash/transport contract, independent of object insertion order. */
export function serializeTrack(track: Track): string {
  validateTrack(track);
  return JSON.stringify({
    schemaVersion: track.schemaVersion,
    generatorVersion: track.generatorVersion,
    seed: track.seed,
    totalLength: track.totalLength,
    startS: track.startS,
    samples: track.samples.map(({ x, z, s, tx, tz, curvature, width }) => ({
      x,
      z,
      s,
      tx,
      tz,
      curvature,
      width,
    })),
    checkpoints: track.checkpoints.map(({ id, s }) => ({ id, s })),
  });
}

/** For storage/integrity, never required by the rendering or driving frame loop. */
export async function hashTrack(track: Track): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      'Track hashing requires Web Crypto (Node or a secure browser context)'
    );
  const bytes = new TextEncoder().encode(serializeTrack(track));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}
