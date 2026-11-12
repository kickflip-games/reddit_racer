import { createTrackFromPoints } from '../track-authoring.ts';
import {
  generateCircuit,
  FALLBACK_CIRCUIT_SEED,
} from '../circuit-generator.ts';
import type { Track } from '../track.ts';

export function oscillatingCurvatureFixture(): Track {
  return createTrackFromPoints(
    Array.from({ length: 4096 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 4096;
      const radius = 60 + 0.02 * Math.sin(angle * 90);
      return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
    }),
    {
      seed: 'oscillating-curvature',
      generatorVersion: 'broken-quality-fixture',
      width: 7,
    }
  );
}
export function unsafeStartSeamFixture(): Track {
  const reserve = generateCircuit(FALLBACK_CIRCUIT_SEED).track;
  let index = 0;
  for (let at = 1; at < reserve.samples.length; at++) {
    const sample = reserve.samples[at],
      selected = reserve.samples[index];
    if (
      sample &&
      selected &&
      Math.abs(sample.curvature) > Math.abs(selected.curvature)
    )
      index = at;
  }
  return createTrackFromPoints(
    [...reserve.samples.slice(index), ...reserve.samples.slice(0, index)],
    {
      seed: 'unsafe-start-seam',
      generatorVersion: 'broken-quality-fixture',
      width: 7,
    }
  );
}
export function unfinishableDurationFixture(): Track {
  const reserve = generateCircuit(FALLBACK_CIRCUIT_SEED).track;
  return createTrackFromPoints(
    reserve.samples.map((sample) => ({ x: sample.x * 10, z: sample.z * 10 })),
    {
      seed: 'unfinishable-duration',
      generatorVersion: 'broken-quality-fixture',
      width: 7,
      sampleSpacing: 5,
    }
  );
}
export function overlappingCorridorFixture(): Track {
  const points: { x: number; z: number }[] = [];
  for (let index = 0; index < 96; index++) {
    const angle = (index * Math.PI) / 96;
    points.push({ x: 5 * Math.cos(angle), z: 40 + 5 * Math.sin(angle) });
  }
  for (let index = 0; index < 400; index++)
    points.push({ x: -5, z: 40 - (index / 400) * 80 });
  for (let index = 0; index < 96; index++) {
    const angle = Math.PI + (index * Math.PI) / 96;
    points.push({ x: 5 * Math.cos(angle), z: -40 + 5 * Math.sin(angle) });
  }
  for (let index = 0; index < 400; index++)
    points.push({ x: 5, z: -40 + (index / 400) * 80 });
  return createTrackFromPoints(points, {
    seed: 'overlapping-corridor',
    generatorVersion: 'broken-quality-fixture',
    width: 7,
  });
}
