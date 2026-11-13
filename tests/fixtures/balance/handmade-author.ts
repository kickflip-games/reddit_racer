import { createTrackFromPoints } from '../../../src/shared/track-authoring.ts';
import type { Track } from '../../../src/shared/track.ts';

type Point = { x: number; z: number };
// One independently drawn Cartesian outline, not generator output or seed search.
// Bottom straight -> outer right approach -> infield U -> left return/recovery.
export const HANDMADE_CONTROLS: readonly Point[] = [
  { x: -60, z: 60 },
  { x: -40, z: 60 },
  { x: -20, z: 60 },
  { x: 0, z: 60 },
  { x: 20, z: 60 },
  { x: 40, z: 60 },
  { x: 60, z: 60 },
  { x: 80, z: 45 },
  { x: 90, z: 25 },
  { x: 90, z: 5 },
  { x: 80, z: -15 },
  { x: 60, z: -25 },
  { x: 40, z: -25 },
  { x: 25, z: -15 },
  { x: 25, z: 5 },
  { x: 25, z: 25 },
  { x: 10, z: 40 },
  { x: -10, z: 40 },
  { x: -25, z: 25 },
  { x: -25, z: 5 },
  { x: -25, z: -15 },
  { x: -40, z: -35 },
  { x: -60, z: -45 },
  { x: -80, z: -35 },
  { x: -95, z: -15 },
  { x: -95, z: 5 },
  { x: -90, z: 30 },
  { x: -75, z: 50 },
];
export const HANDMADE_SCALE = 0.8;

/** Periodic uniform cubic B-spline; C2 joins and no special closure seam. */
function authoredPolyline(): Point[] {
  const points: Point[] = [];
  const count = HANDMADE_CONTROLS.length;
  for (let segment = 0; segment < count; segment++) {
    // Begin inside four collinear controls, giving a genuine straight start.
    const index = (segment + 2) % count;
    const a = HANDMADE_CONTROLS[(index + count - 1) % count];
    const b = HANDMADE_CONTROLS[index];
    const c = HANDMADE_CONTROLS[(index + 1) % count];
    const d = HANDMADE_CONTROLS[(index + 2) % count];
    if (!a || !b || !c || !d) throw Error('Incomplete handmade controls');
    for (let step = 0; step < 64; step++) {
      const t = step / 64,
        t2 = t * t,
        t3 = t2 * t;
      const wa = (1 - 3 * t + 3 * t2 - t3) / 6,
        wb = (4 - 6 * t2 + 3 * t3) / 6;
      const wc = (1 + 3 * t + 3 * t2 - 3 * t3) / 6,
        wd = t3 / 6;
      points.push({
        x: HANDMADE_SCALE * (a.x * wa + b.x * wb + c.x * wc + d.x * wd),
        z: HANDMADE_SCALE * (a.z * wa + b.z * wb + c.z * wc + d.z * wd),
      });
    }
  }
  return points;
}

export function authorHandmadeReference(): Track {
  return createTrackFromPoints(authoredPolyline(), {
    seed: 'handmade-braking-reference-v1',
    generatorVersion: 'handmade-reference-v1',
    width: 7,
    sampleSpacing: 1,
    checkpointCount: 8,
  });
}
