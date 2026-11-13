import * as THREE from 'three';
import type { Track } from '../shared/track';
import { getTrackBounds } from './track-renderer';

/** Runoff remains level through the entire recoverable driving envelope. */
export function circuitTerrainHeight(
  track: Track,
  x: number,
  z: number
): number {
  if (track.schemaVersion !== 2) return 0;
  let clearance = Infinity;
  for (let i = 0; i < track.samples.length; i++) {
    const a = track.samples[i],
      b = track.samples[(i + 1) % track.samples.length];
    if (!a || !b) continue;
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))
    );
    clearance = Math.min(
      clearance,
      Math.hypot(x - a.x - dx * t, z - a.z - dz * t) -
        Math.max(a.width, b.width) / 2
    );
  }
  if (clearance <= 21) return 0;
  const envelope = Math.min(1, (clearance - 21) / 16);
  const waves = 1.8 + Math.sin(x * 0.043) * 1.1 + Math.cos(z * 0.051) * 0.9;
  const bounds = getTrackBounds(track, 30);
  const edge = Math.max(
    0,
    Math.min(
      1,
      (x - bounds.minX) / 20,
      (bounds.maxX - x) / 20,
      (z - bounds.minZ) / 20,
      (bounds.maxZ - z) / 20
    )
  );
  return Math.max(0, waves) * envelope * envelope * edge * edge;
}

/** A single small faceted mesh; flat ground uses the scene background. */
export function createCircuitTerrain(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'circuit-terrain';
  const bounds = getTrackBounds(track, 30),
    step = 7;
  const positions: number[] = [],
    colors: number[] = [];
  const base = new THREE.Color('#77a55b'),
    raised = new THREE.Color('#92b968');
  for (let x = bounds.minX; x < bounds.maxX; x += step) {
    for (let z = bounds.minZ; z < bounds.maxZ; z += step) {
      const points = [
        [x, z],
        [x + step, z],
        [x, z + step],
        [x + step, z + step],
      ].map(([px, pz]) => {
        if (px === undefined || pz === undefined)
          throw new Error('Missing terrain corner');
        return { x: px, z: pz, y: circuitTerrainHeight(track, px, pz) };
      });
      if (points.every((p) => p.y === 0)) continue;
      for (const i of [0, 2, 1, 1, 2, 3]) {
        const p = points[i];
        if (!p) throw new Error('Missing terrain vertex');
        positions.push(p.x, p.y - 0.02, p.z);
        const color = base.clone().lerp(raised, Math.min(1, p.y / 4));
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true })
  );
  group.add(mesh);
  return group;
}
