import { slotBrakingMarkers } from '../shared/slot-grip';
import * as THREE from 'three';
import { HANDLING } from '../shared/simulation';
import { sampleTrack, type Track } from '../shared/track';
import { CAR_VISUAL_FOOTPRINT } from './car-visual';
import type { SceneryAssets, SceneryKind } from './scene-assets';

export const MAX_SCENERY_INSTANCES = 64;
export const MAX_SCENERY_CANDIDATES = 300;
export const SCENERY_GROUND_Y = -0.045;
export type SceneryPlacement = {
  kind: SceneryKind;
  x: number;
  z: number;
  heading: number;
  radius: number;
};
export type SceneryVisual = {
  object: THREE.Group;
  installAssets(assets: SceneryAssets): boolean;
  dispose(): void;
};
const heights: Record<SceneryKind, number> = {
  treeSmall: 7,
  barrierRed: 0.8,
  barrierWhite: 0.8,
  pylon: 0.8,
  flagCheckersSmall: 3.1,
};
const footprints: Record<SceneryKind, number> = {
  treeSmall: 1.8,
  barrierRed: 1.1,
  barrierWhite: 1.1,
  pylon: 0.6,
  flagCheckersSmall: 1.1,
};
const clearancePadding = 0.35;

/** Includes the closing segment and varying road widths, not only nearby samples. */
export function hasSceneryClearance(
  track: Track,
  x: number,
  z: number,
  radius: number
): boolean {
  if (!Number.isFinite(x + z + radius) || radius < 0) return false;
  for (let index = 0; index < track.samples.length; index++) {
    const a = track.samples[index];
    const b = track.samples[(index + 1) % track.samples.length];
    if (!a || !b) return false;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared > 0
        ? THREE.MathUtils.clamp(
            ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared,
            0,
            1
          )
        : 0;
    const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    const required =
      Math.max(a.width, b.width) / 2 +
      HANDLING.recoveryDistanceBeyondEdge +
      CAR_VISUAL_FOOTPRINT +
      radius +
      clearancePadding;
    if (distance < required) return false;
  }
  return track.samples.length > 0;
}

/** Purposeful tree groves and short fence runs; rejected positions stay empty. */
export function buildSceneryPlacements(track: Track): SceneryPlacement[] {
  const placements: SceneryPlacement[] = [];
  let candidates = 0;
  function place(
    kind: SceneryKind,
    distance: number,
    side: number,
    along = 0,
    extra = 0
  ): void {
    if (
      ++candidates > MAX_SCENERY_CANDIDATES ||
      placements.length >= MAX_SCENERY_INSTANCES
    )
      return;
    const frame = sampleTrack(track, distance);
    const radius = footprints[kind];
    const lateral =
      side *
      (frame.halfWidth +
        HANDLING.recoveryDistanceBeyondEdge +
        CAR_VISUAL_FOOTPRINT +
        radius +
        1.5 +
        extra);
    const x = frame.x + frame.nx * lateral + frame.tx * along;
    const z = frame.z + frame.nz * lateral + frame.tz * along;
    if (!hasSceneryClearance(track, x, z, radius)) return;
    if (
      placements.some(
        (other) =>
          Math.hypot(x - other.x, z - other.z) < radius + other.radius + 0.45
      )
    )
      return;
    placements.push({
      kind,
      x,
      z,
      heading: Math.atan2(frame.tx, frame.tz),
      radius,
    });
  }
  let seedHash = 2166136261;
  for (const character of track.seed)
    seedHash = Math.imul(seedHash ^ character.charCodeAt(0), 16777619);
  const shift = ((seedHash >>> 0) % 23) / 230;
  const corners = slotBrakingMarkers(track).map((marker) => marker.cornerS);
  const groveDistances = [
    track.totalLength * 0.04,
    ...corners,
    ...Array.from(
      { length: 8 },
      (_, index) => track.totalLength * ((index / 8 + shift) % 1)
    ),
  ].slice(0, 12);
  for (const [cluster, distance] of groveDistances.entries()) {
    const bend = sampleTrack(track, distance).curvature;
    const side =
      Math.abs(bend) > 0.015 ? -Math.sign(bend) : cluster % 2 === 0 ? 1 : -1;
    for (const [along, extra] of [
      [-3, 0],
      [0, 3.5],
      [3, 0],
    ]) {
      if (along !== undefined && extra !== undefined)
        place('treeSmall', distance, side, along, extra);
    }
  }
  for (let section = 0; section < 3; section++) {
    const distance =
      corners[section] ?? track.totalLength * (0.16 + section * 0.29);
    const side = section % 2 === 0 ? -1 : 1;
    for (let fence = 0; fence < 4; fence++)
      place(
        fence % 2 === 0 ? 'barrierRed' : 'barrierWhite',
        distance,
        side,
        fence * 1.65 - 2.475
      );
  }
  for (const side of [-1, 1]) {
    place('flagCheckersSmall', 0, side);
    place('pylon', 5, side, 0, 1);
    place('pylon', 9, side, 0, 1);
  }
  return placements;
}

export function createScenery(track: Track): SceneryVisual {
  const object = new THREE.Group();
  object.name = 'track-scenery';
  const placements = buildSceneryPlacements(track);
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  const themedMaterials = new Map<THREE.Material, THREE.Material>();
  let disposed = false;
  let installed: SceneryAssets | undefined;
  function mesh(geometry: THREE.BufferGeometry, color: string): THREE.Mesh {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    ownedGeometries.add(geometry);
    ownedMaterials.add(material);
    return new THREE.Mesh(geometry, material);
  }
  function fallbackAssets(): Record<SceneryKind, THREE.Group> {
    const tree = new THREE.Group();
    const trunk = mesh(
      new THREE.CylinderGeometry(0.2, 0.28, 2.4, 5),
      '#896e50'
    );
    trunk.position.y = 1.2;
    const crown = mesh(new THREE.ConeGeometry(1.3, 5.1, 6), '#557650');
    crown.position.y = 4.45;
    tree.add(trunk, crown);
    function barrier(color: string): THREE.Group {
      const group = new THREE.Group();
      const block = mesh(new THREE.BoxGeometry(1.45, 0.8, 0.7), color);
      block.position.y = 0.4;
      group.add(block);
      return group;
    }
    const pylon = new THREE.Group();
    const cone = mesh(new THREE.ConeGeometry(0.37, 0.8, 6), '#ef8c3a');
    cone.position.y = 0.4;
    pylon.add(cone);
    const flag = new THREE.Group();
    const pole = mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 3.1, 5),
      '#e8eadb'
    );
    pole.position.set(-0.6, 1.55, 0);
    flag.add(pole);
    for (let index = 0; index < 4; index++) {
      const square = mesh(
        new THREE.BoxGeometry(0.6, 0.45, 0.05),
        index % 2 === 0 ? '#f8f0d6' : '#283b36'
      );
      square.position.set(
        index < 2 ? -0.3 : 0.3,
        index % 2 === 0 ? 2.83 : 2.38,
        0
      );
      flag.add(square);
    }
    return {
      treeSmall: tree,
      barrierRed: barrier('#d75e4b'),
      barrierWhite: barrier('#f0e8d0'),
      pylon,
      flagCheckersSmall: flag,
    };
  }
  const fallback = fallbackAssets();
  function themeMaterial(
    kind: SceneryKind,
    material: THREE.Material
  ): THREE.Material {
    if (!(material instanceof THREE.MeshStandardMaterial)) return material;
    const color =
      kind === 'treeSmall'
        ? material.name === 'grass'
          ? '#647c55'
          : material.name === 'bark'
            ? '#8a6746'
            : undefined
        : kind === 'barrierRed'
          ? '#d86049'
          : kind === 'barrierWhite'
            ? '#f4e5c7'
            : undefined;
    if (!color) return material;
    const existing = themedMaterials.get(material);
    if (existing) return existing;
    const themed = material.clone();
    themed.color.set(color);
    themedMaterials.set(material, themed);
    ownedMaterials.add(themed);
    return themed;
  }
  function batch(assets: SceneryAssets): THREE.Group {
    const group = new THREE.Group();
    for (const kind of [
      'treeSmall',
      'barrierRed',
      'barrierWhite',
      'pylon',
      'flagCheckersSmall',
    ]) {
      if (
        kind !== 'treeSmall' &&
        kind !== 'barrierRed' &&
        kind !== 'barrierWhite' &&
        kind !== 'pylon' &&
        kind !== 'flagCheckersSmall'
      )
        continue;
      const template = assets[kind] ?? fallback[kind];
      template.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(template);
      const size = bounds.getSize(new THREE.Vector3());
      const scale = heights[kind] / size.y;
      if (
        bounds.isEmpty() ||
        !Number.isFinite(scale) ||
        scale <= 0 ||
        (Math.hypot(size.x, size.z) * scale) / 2 > footprints[kind] + 0.001
      )
        continue;
      const relevant = placements.filter(
        (placement) => placement.kind === kind
      );
      if (relevant.length === 0) continue;
      const normalize = new THREE.Matrix4().makeTranslation(
        -(bounds.min.x + bounds.max.x) / 2,
        -bounds.min.y,
        -(bounds.min.z + bounds.max.z) / 2
      );
      const placementMatrix = new THREE.Matrix4();
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const uniformScale = new THREE.Vector3(scale, scale, scale);
      const up = new THREE.Vector3(0, 1, 0);
      template.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const material = assets[kind]
          ? Array.isArray(node.material)
            ? node.material.map((source) => themeMaterial(kind, source))
            : themeMaterial(kind, node.material)
          : node.material;
        const instances = new THREE.InstancedMesh(
          node.geometry,
          material,
          relevant.length
        );
        instances.name = `scenery-${kind}`;
        instances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        relevant.forEach((placement, index) => {
          position.set(placement.x, SCENERY_GROUND_Y, placement.z);
          // Barriers are authored along +X; align their long axis with the road.
          quaternion.setFromAxisAngle(
            up,
            placement.heading -
              (kind === 'barrierRed' || kind === 'barrierWhite'
                ? Math.PI / 2
                : 0)
          );
          placementMatrix.compose(position, quaternion, uniformScale);
          matrix
            .copy(placementMatrix)
            .multiply(normalize)
            .multiply(node.matrixWorld);
          instances.setMatrixAt(index, matrix);
        });
        instances.instanceMatrix.needsUpdate = true;
        instances.computeBoundingSphere();
        group.add(instances);
      });
    }
    return group;
  }
  function disposeBatches(group: THREE.Group): void {
    group.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) node.dispose();
    });
    group.clear();
  }
  let current = batch(fallback);
  object.add(current);
  return {
    object,
    installAssets(assets) {
      if (disposed || Object.keys(assets).length === 0) return false;
      if (installed === assets) return true;
      const next = batch(assets);
      object.remove(current);
      disposeBatches(current);
      current = next;
      object.add(current);
      installed = assets;
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      disposeBatches(current);
      object.clear();
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
    },
  };
}
