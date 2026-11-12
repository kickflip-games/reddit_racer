import { validateTrack } from './track.ts';
import type { Track, TrackSample } from './track.ts';

export type TrackPoint = { x: number; z: number; width?: number };
export type TrackAuthoringOptions = {
  seed: string;
  generatorVersion: string;
  width?: number;
  sampleSpacing?: number;
  checkpointCount?: number;
};

export const quantizeGeometry = (value: number): number =>
  Math.round(value * 10_000) / 10_000;
const quantizeDirection = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

/** Authoring only. Resample a dense, smooth closed polyline into authoritative data. */
export function createTrackFromPoints(
  points: TrackPoint[],
  options: TrackAuthoringOptions
): Track {
  const width = options.width ?? 7;
  const spacing = options.sampleSpacing ?? 1;
  const checkpointCount = options.checkpointCount ?? 8;
  if (
    points.length < 8 ||
    points.length > 65_536 ||
    !Number.isFinite(spacing) ||
    spacing < 0.1 ||
    spacing > 10 ||
    !Number.isInteger(checkpointCount) ||
    checkpointCount < 0 ||
    checkpointCount > 128
  ) {
    throw new Error('Invalid track authoring options');
  }
  const source = points.map((point) => {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.z) ||
      !Number.isFinite(point.width ?? width)
    ) {
      throw new Error('Authoring points must be finite');
    }
    return { x: point.x, z: point.z, width: point.width ?? width };
  });
  const lengths = [0];
  let denseLength = 0;
  for (let index = 0; index < source.length; index++) {
    const point = source[index];
    const next = source[(index + 1) % source.length];
    if (!point || !next) throw new Error('Missing authoring point');
    const chord = Math.hypot(next.x - point.x, next.z - point.z);
    if (chord < 0.0001)
      throw new Error('Authoring points must not duplicate the closing point');
    denseLength += chord;
    lengths.push(denseLength);
  }
  const sampleCount = Math.max(8, Math.ceil(denseLength / spacing));
  if (sampleCount > 16_384)
    throw new Error('Authored track exceeds sample budget');
  let segment = 0;
  const vertices = Array.from({ length: sampleCount }, (_, index) => {
    const distance = (index * denseLength) / sampleCount;
    while ((lengths[segment + 1] ?? denseLength) < distance) segment++;
    const point = source[segment];
    const next = source[(segment + 1) % source.length];
    const start = lengths[segment];
    const end = lengths[segment + 1];
    if (!point || !next || start === undefined || end === undefined)
      throw new Error('Incomplete authoring segment');
    const blend = (distance - start) / (end - start);
    return {
      x: quantizeGeometry(point.x + (next.x - point.x) * blend),
      z: quantizeGeometry(point.z + (next.z - point.z) * blend),
      width: quantizeGeometry(point.width + (next.width - point.width) * blend),
    };
  });
  let totalLength = 0;
  const samples: TrackSample[] = vertices.map((point, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const next = vertices[(index + 1) % vertices.length];
    if (!previous || !next) throw new Error('Incomplete resampled course');
    const incomingLength = Math.hypot(
      point.x - previous.x,
      point.z - previous.z
    );
    const outgoingLength = Math.hypot(next.x - point.x, next.z - point.z);
    if (incomingLength < 0.001 || outgoingLength < 0.001)
      throw new Error('Resampled course contains duplicate vertices');
    const ix = (point.x - previous.x) / incomingLength;
    const iz = (point.z - previous.z) / incomingLength;
    const ox = (next.x - point.x) / outgoingLength;
    const oz = (next.z - point.z) / outgoingLength;
    const tangentLength = Math.hypot(ix + ox, iz + oz);
    if (tangentLength < 0.001)
      throw new Error('Track must not reverse direction at a vertex');
    const sample: TrackSample = {
      x: point.x,
      z: point.z,
      s: quantizeGeometry(totalLength),
      tx: quantizeDirection((ix + ox) / tangentLength),
      tz: quantizeDirection((iz + oz) / tangentLength),
      curvature: quantizeDirection(
        Math.atan2(ix * oz - iz * ox, ix * ox + iz * oz) /
          ((incomingLength + outgoingLength) / 2)
      ),
      width: point.width,
    };
    totalLength += outgoingLength;
    return sample;
  });
  totalLength = quantizeGeometry(totalLength);
  const track: Track = {
    schemaVersion: 1,
    generatorVersion: options.generatorVersion,
    seed: options.seed,
    totalLength,
    startS: 0,
    samples,
    checkpoints: Array.from({ length: checkpointCount }, (_, index) => ({
      id: `checkpoint-${index + 1}`,
      s: quantizeGeometry((totalLength * (index + 1)) / (checkpointCount + 1)),
    })),
  };
  validateTrack(track);
  return track;
}

/** Repeatable reference course, separate from the daily procedural generator. */
export function createOvalTrack(
  options: {
    radiusX?: number;
    radiusZ?: number;
    width?: number;
    sampleSpacing?: number;
    seed?: string;
  } = {}
): Track {
  const radiusX = options.radiusX ?? 28;
  const radiusZ = options.radiusZ ?? 42;
  if (
    !Number.isFinite(radiusX) ||
    !Number.isFinite(radiusZ) ||
    radiusX < 5 ||
    radiusZ < 5 ||
    radiusX > 1_000 ||
    radiusZ > 1_000
  ) {
    throw new Error('Oval radii must be 5–1000 metres');
  }
  const points = Array.from({ length: 2048 }, (_, index) => {
    const angle = Math.PI + (index * Math.PI * 2) / 2048;
    return { x: Math.sin(angle) * radiusX, z: Math.cos(angle) * radiusZ };
  });
  return createTrackFromPoints(points, {
    seed: options.seed ?? 'reference-oval',
    generatorVersion: 'reference-oval-v1',
    width: options.width ?? 7,
    sampleSpacing: options.sampleSpacing ?? 1,
  });
}
