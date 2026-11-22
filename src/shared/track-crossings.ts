import { sampleTrack, type Track } from './track';
import { segmentDistance } from './circuit-validation';

export const BRIDGE_FASCIA_DEPTH = 0.55;
export const CROSSING_CLEAR_RADIUS = 32;
export type TrackCrossing = {
  x: number;
  z: number;
  lowerS: number;
  upperS: number;
  lowerY: number;
  upperY: number;
  angle: number;
};

/** Derived from canonical geometry; arc distance, never XZ, identifies a deck. */
export function findTrackCrossings(track: Track): TrackCrossing[] {
  const result: TrackCrossing[] = [];
  const points = track.samples;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j]!,
        d = points[(j + 1) % points.length]!;
      if (
        Math.min(a.x, b.x) > Math.max(c.x, d.x) ||
        Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
        Math.min(a.z, b.z) > Math.max(c.z, d.z) ||
        Math.max(a.z, b.z) < Math.min(c.z, d.z)
      )
        continue;
      const ux = b.x - a.x,
        uz = b.z - a.z,
        vx = d.x - c.x,
        vz = d.z - c.z;
      const determinant = ux * vz - uz * vx;
      if (Math.abs(determinant) < 1e-9) continue;
      const t = ((c.x - a.x) * vz - (c.z - a.z) * vx) / determinant;
      const u = ((c.x - a.x) * uz - (c.z - a.z) * ux) / determinant;
      if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
      const sa = a.s + t * ((points[i + 1]?.s ?? track.totalLength) - a.s);
      const sb = c.s + u * ((points[j + 1]?.s ?? track.totalLength) - c.s);
      const ya = sampleTrack(track, sa).y ?? 0,
        yb = sampleTrack(track, sb).y ?? 0;
      const lower = ya <= yb;
      result.push({
        x: a.x + t * ux,
        z: a.z + t * uz,
        lowerS: lower ? sa : sb,
        upperS: lower ? sb : sa,
        lowerY: Math.min(ya, yb),
        upperY: Math.max(ya, yb),
        angle: Math.acos(
          Math.min(
            1,
            Math.abs(
              (ux * vx + uz * vz) / (Math.hypot(ux, uz) * Math.hypot(vx, vz))
            )
          )
        ),
      });
    }
  }
  return result;
}

/** Conservative full-width sweep, including both shoulders and the bridge fascia.
 * Endpoint extrema bound every level road cross-section in each linear segment.
 * Capsule overlap overestimates the rendered strips, so this cannot miss an edge.
 */
export function crossingHeadroom(track: Track): number {
  let minimum = Infinity;
  const points = track.samples;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!,
      b = points[(i + 1) % points.length]!;
    for (let j = i + 2; j < points.length; j++) {
      const c = points[j]!,
        d = points[(j + 1) % points.length]!;
      const arc = Math.min(c.s - a.s, track.totalLength - (c.s - a.s));
      if (arc < 25) continue;
      const radius =
        (Math.max(a.width, b.width) + Math.max(c.width, d.width)) / 2 + 1.6;
      if (
        Math.min(a.x, b.x) - radius > Math.max(c.x, d.x) ||
        Math.max(a.x, b.x) + radius < Math.min(c.x, d.x) ||
        Math.min(a.z, b.z) - radius > Math.max(c.z, d.z) ||
        Math.max(a.z, b.z) + radius < Math.min(c.z, d.z)
      )
        continue;
      if (segmentDistance(a, b, c, d) > radius) continue;
      const separation = Math.max(
        Math.min(a.y ?? 0, b.y ?? 0) - Math.max(c.y ?? 0, d.y ?? 0),
        Math.min(c.y ?? 0, d.y ?? 0) - Math.max(a.y ?? 0, b.y ?? 0)
      );
      minimum = Math.min(minimum, separation - BRIDGE_FASCIA_DEPTH);
    }
  }
  return minimum;
}
