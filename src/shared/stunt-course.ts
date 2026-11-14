import type { GripZone } from './slot-grip.ts';
import { createTrackFromPoints, type TrackPoint } from './track-authoring.ts';
import { type Track, type TrackJump } from './track.ts';

export type GapJump = TrackJump;
export type StuntCourse = {
  track: Track;
  jumps: GapJump[];
  gripZones: GripZone[];
};
export type TrackSection = { name: string; points: TrackPoint[]; turn: number };

/** Local +X entry, tangent-continuous pieces, measured in metres. */
export function straightSection(
  length: number,
  name = 'straight'
): TrackSection {
  const count = Math.ceil(length * 4);
  return {
    name,
    turn: 0,
    points: Array.from({ length: count + 1 }, (_, i) => ({
      x: (length * i) / count,
      z: 0,
    })),
  };
}

export function turnSection(
  radius: number,
  degrees: number,
  name: string
): TrackSection {
  const angle = (degrees * Math.PI) / 180;
  const count = Math.ceil(Math.abs(angle) * radius * 4);
  const sign = Math.sign(angle);
  return {
    name,
    turn: angle,
    points: Array.from({ length: count + 1 }, (_, i) => {
      const theta = (Math.abs(angle) * i) / count;
      return {
        x: radius * Math.sin(theta),
        z: sign * radius * (1 - Math.cos(theta)),
      };
    }),
  };
}

/** Compose reusable sections without smoothing away their authored shapes. */
export function createStuntCourse(mirrored = false): StuntCourse {
  const sections = [
    straightSection(120, 'gap-jump run-up'),
    turnSection(25, 90, 'hairpin entry'),
    straightSection(35),
    turnSection(14, -180, 'hairpin'),
    straightSection(35),
    turnSection(25, 90, 'hairpin exit'),
    straightSection(40),
    turnSection(55, 180, 'loop sweeper'),
    straightSection(60, 'back straight'),
    turnSection(20, 45, 'chicane entry'),
    turnSection(20, -90, 'chicane switchback'),
    turnSection(20, 45, 'chicane exit'),
    straightSection(208 - 40 * Math.SQRT2, 'back straight'),
    turnSection(30, 90, 'home bend'),
    straightSection(50),
    turnSection(30, 90, 'home bend'),
    straightSection(30),
  ];
  const points: TrackPoint[] = [];
  let x = 0,
    z = 0,
    heading = 0;
  for (const section of sections) {
    const cosine = Math.cos(heading),
      sine = Math.sin(heading);
    for (const point of section.points.slice(0, -1))
      points.push({
        x: (x + point.x * cosine - point.z * sine) * 0.75,
        z: (z + point.x * sine + point.z * cosine) * 0.75 * (mirrored ? -1 : 1),
      });
    const end = section.points.at(-1),
      previous = section.points.at(-2);
    if (!end || !previous) throw new Error('Incomplete track section');
    x += end.x * cosine - end.z * sine;
    z += end.x * sine + end.z * cosine;
    heading += section.turn;
  }
  return {
    track: createTrackFromPoints(points, {
      seed: mirrored ? 'stunt-mirrored' : 'stunt-classic',
      generatorVersion: 'section-stunts-v1',
      width: 7,
      sampleSpacing: 0.5,
    }),
    gripZones: [
      { startS: 141, endS: 183, surface: 'dry', bank: mirrored ? 0.12 : -0.12 },
      { startS: 431, endS: 495, surface: 'wet', bank: 0 },
    ],
    jumps: [
      { rampStart: 32, takeoff: 42, landing: 52, rampEnd: 64, height: 2 },
    ],
  };
}

export function jumpRoadHeight(jumps: readonly GapJump[], s: number): number {
  for (const jump of jumps) {
    if (s >= jump.rampStart && s <= jump.takeoff)
      return (
        (jump.height * (s - jump.rampStart)) / (jump.takeoff - jump.rampStart)
      );
    if (s >= jump.landing && s <= jump.rampEnd)
      return (jump.height * (jump.rampEnd - s)) / (jump.rampEnd - jump.landing);
  }
  return 0;
}
