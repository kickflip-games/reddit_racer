import * as THREE from 'three';
import { groundHeightAt } from './scenery-layout';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  type Plant,
  type PlantKind,
  type SceneryLayout,
} from './scenery-layout';

export type VegetationVisual = {
  object: THREE.Group;
  setDetail(quality: 'light' | 'standard', wind: boolean): number;
  update(
    time: number,
    focus: THREE.Vector3,
    reduced: boolean,
    active: boolean
  ): boolean;
  dispose(): void;
};
export const VEGETATION_CHUNK_SIZE = 48;
const vertexShader = `
attribute float aFlex;
attribute float aTint;
attribute float instancePhase;
uniform float uTime;
uniform float uMotion;
uniform vec3 uFocus;
uniform float uToon;
varying vec3 vColor;
void main() {
  vec4 base = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec4 world = instanceMatrix * vec4(position, 1.0);
  float nearby = 1.0 - smoothstep(32.0, 56.0, distance(base.xz, uFocus.xz));
  float flex = aFlex * nearby * uMotion;
  if (flex > 0.001) {
    float phase = instancePhase + base.x * 0.065 + base.z * 0.043;
    float wave = sin(uTime * 0.8 + phase) + sin(uTime * 1.2 + phase * 0.7) * 0.3;
    world.xz += vec2(0.13, 0.065) * wave * flex;
  }
  vec3 n = normalize(mat3(instanceMatrix) * normal);
  float diffuse = max(0.0, dot(n, normalize(vec3(-0.35, 0.88, 0.32))));
  float soft = 0.72 + diffuse * 0.28;
  float toon = diffuse < 0.2 ? 0.68 : (diffuse < 0.7 ? 0.88 : 1.04);
  vColor = color * mix(vec3(1.0), instanceColor, aTint) * mix(soft, toon, uToon);
  gl_Position = projectionMatrix * modelViewMatrix * world;
}`;
const fragmentShader = `varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

function part(
  geometry: THREE.BufferGeometry,
  color: string,
  tint: number,
  flex: (y: number) => number
): THREE.BufferGeometry {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  if (result !== geometry) geometry.dispose();
  result.deleteAttribute('uv');
  const positions = result.getAttribute('position'),
    colors: number[] = [],
    flexibility: number[] = [],
    tints: number[] = [];
  const c = new THREE.Color(color);
  for (let i = 0; i < positions.count; i++) {
    colors.push(c.r, c.g, c.b);
    flexibility.push(flex(positions.getY(i)));
    tints.push(tint);
  }
  result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  result.setAttribute(
    'aFlex',
    new THREE.Float32BufferAttribute(flexibility, 1)
  );
  result.setAttribute('aTint', new THREE.Float32BufferAttribute(tints, 1));
  return result;
}
function makePlantGeometry(kind: PlantKind): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const add = (
    g: THREE.BufferGeometry,
    color: string,
    tint: number,
    flex: (y: number) => number
  ) => pieces.push(part(g, color, tint, flex));
  if (kind === 'blossom' || kind === 'tree') {
    add(
      new THREE.CylinderGeometry(0.13, 0.24, 2.8, 5).translate(0, 1.4, 0),
      '#876b52',
      0,
      () => 0
    );
    for (const [x, y, z, size] of [
      [0, 3.8, 0, 1.85],
      [-1.05, 3.1, 0.15, 1.35],
      [0.85, 3.2, 0.45, 1.4],
      [0.1, 3.05, -0.95, 1.25],
    ]) {
      if (
        x === undefined ||
        y === undefined ||
        z === undefined ||
        size === undefined
      )
        continue;
      const crown =
        kind === 'tree'
          ? new THREE.ConeGeometry(size * 0.8, size * 2.1, 6)
          : new THREE.IcosahedronGeometry(size, 0);
      add(
        crown.scale(1, 0.87, 1).translate(x, y, z),
        '#ffffff',
        1,
        (h) => Math.max(0, h - 2) * 0.18
      );
    }
  } else if (kind === 'bush') {
    for (const [x, y, z, size] of [
      [0, 0.6, 0, 0.85],
      [-0.5, 0.4, 0.1, 0.6],
      [0.45, 0.35, 0.2, 0.55],
    ]) {
      if (
        x === undefined ||
        y === undefined ||
        z === undefined ||
        size === undefined
      )
        continue;
      add(
        new THREE.IcosahedronGeometry(size, 0)
          .scale(1, 0.75, 1)
          .translate(x, y, z),
        '#ffffff',
        1,
        (h) => h * 0.3
      );
    }
  } else if (kind === 'fence') {
    for (const x of [-1.25, 1.25])
      add(
        new THREE.BoxGeometry(0.15, 1.15, 0.15).translate(x, 0.575, 0),
        '#ffffff',
        1,
        () => 0
      );
    for (const y of [0.4, 0.85])
      add(
        new THREE.BoxGeometry(2.8, 0.12, 0.12).translate(0, y, 0),
        '#ffffff',
        1,
        () => 0
      );
  } else if (kind === 'rock')
    add(
      new THREE.IcosahedronGeometry(0.8, 0)
        .scale(1.1, 0.55, 0.75)
        .translate(0, 0.28, 0),
      '#ffffff',
      1,
      () => 0
    );
  else if (kind === 'grass') {
    const p: number[] = [];
    for (let blade = 0; blade < 3; blade++) {
      const a = blade * Math.PI * 0.67,
        dx = Math.cos(a) * 0.19,
        dz = Math.sin(a) * 0.19,
        h = 0.38 + blade * 0.09;
      const triangle = [-dx, 0, -dz, dx, 0, dz, dx * 0.5, h, dz * 0.5];
      p.push(
        ...triangle,
        ...triangle.slice(6, 9),
        ...triangle.slice(3, 6),
        ...triangle.slice(0, 3)
      );
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.computeVertexNormals();
    add(g, '#ffffff', 1, (h) => h / 0.6);
  } else {
    for (let flower = 0; flower < 3; flower++) {
      const x = Math.cos(flower * 2.4) * 0.19,
        z = Math.sin(flower * 2.4) * 0.19,
        h = 0.3 + flower * 0.08;
      add(
        new THREE.ConeGeometry(0.025, h, 3, 1, true).translate(x, h / 2, z),
        '#778657',
        0,
        (y) => y / 0.6
      );
      add(
        new THREE.CircleGeometry(0.14, 5)
          .rotateX(-Math.PI / 2)
          .translate(x, h, z),
        '#ffffff',
        1,
        (y) => y / 0.6
      );
      add(
        new THREE.TetrahedronGeometry(0.04, 0).translate(x, h + 0.035, z),
        '#cba557',
        0,
        (y) => y / 0.6
      );
    }
  }
  const merged = mergeGeometries(pieces, false);
  if (!merged) throw new Error('Incompatible vegetation attributes');
  for (const piece of pieces) piece.dispose();
  return merged;
}

/** Shared geometry/materials, static instance buffers and bounded spatial chunks. */
export function createVegetation(layout: SceneryLayout): VegetationVisual {
  const object = new THREE.Group();
  object.name = 'spring-vegetation';
  const time = { value: 0 },
    motion = { value: 0 },
    focus = { value: new THREE.Vector3() };
  const material = new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      uTime: time,
      uMotion: motion,
      uFocus: focus,
      uToon: { value: layout.options.lighting === 'toon' ? 1 : 0 },
    },
    vertexShader,
    fragmentShader,
  });
  const geometries = new Map<PlantKind, THREE.BufferGeometry>();
  const chunks = new Map<string, Plant[]>();
  // Borrowed Kenney trees replace the first conifers rather than doubling them.
  const borrowedTrees = new Set(
    layout.props
      .filter((p) => p.kind === 'treeSmall')
      .map((p) => `${p.x},${p.z}`)
  );
  for (const plant of layout.allPlants) {
    if (borrowedTrees.has(`${plant.x},${plant.z}`)) continue;
    const key = `${Math.floor(plant.x / VEGETATION_CHUNK_SIZE)},${Math.floor(plant.z / VEGETATION_CHUNK_SIZE)},${plant.kind}`;
    const bucket = chunks.get(key) ?? [];
    bucket.push(plant);
    chunks.set(key, bucket);
  }
  const details: { mesh: THREE.InstancedMesh; full: number; light: number }[] =
    [];
  const dummy = new THREE.Object3D(),
    color = new THREE.Color();
  for (const [key, plants] of chunks) {
    plants.sort((a, b) => a.detail - b.detail);
    const first = plants[0];
    if (!first) continue;
    let geometry = geometries.get(first.kind);
    if (!geometry) {
      geometry = makePlantGeometry(first.kind);
      geometries.set(first.kind, geometry);
    }
    // Per-instance phase belongs to each chunk, while all large vertex buffers are shared.
    const chunkGeometry = new THREE.BufferGeometry();
    for (const name of Object.keys(geometry.attributes)) {
      const attribute = geometry.getAttribute(name);
      chunkGeometry.setAttribute(name, attribute);
    }
    chunkGeometry.setIndex(geometry.index);
    chunkGeometry.setAttribute(
      'instancePhase',
      new THREE.InstancedBufferAttribute(
        new Float32Array(plants.map((p) => p.phase)),
        1
      )
    );
    const instances = new THREE.InstancedMesh(
      chunkGeometry,
      material,
      plants.length
    );
    instances.name = `vegetation-${key}`;
    plants.forEach((p, i) => {
      dummy.position.set(p.x, p.y - 0.015, p.z);
      dummy.rotation.set(0, p.heading, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      instances.setMatrixAt(i, dummy.matrix);
      color.set(p.color);
      instances.setColorAt(i, color);
    });
    instances.computeBoundingSphere();
    if (instances.boundingSphere) instances.boundingSphere.radius += 0.5;
    details.push({
      mesh: instances,
      full: plants.length,
      light: plants.filter(
        (p) => p.kind === 'tree' || p.kind === 'blossom' || p.detail < 0.35
      ).length,
    });
    object.add(instances);
  }
  const shadowGeometry = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
  const alpha = new Float32Array(shadowGeometry.getAttribute('position').count);
  alpha[0] = 0.24;
  shadowGeometry.setAttribute(
    'aOpacity',
    new THREE.Float32BufferAttribute(alpha, 1)
  );
  const shadowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color('#3b5136') } },
    vertexShader: `attribute float aOpacity; varying float vOpacity; void main() { vOpacity = aOpacity; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uColor; varying float vOpacity; void main() { gl_FragColor = vec4(uColor, vOpacity);
#include <colorspace_fragment>
}`,
  });
  const shadowChunks = new Map<string, Plant[]>();
  for (const p of layout.allPlants)
    if (
      !borrowedTrees.has(`${p.x},${p.z}`) &&
      (p.kind === 'tree' || p.kind === 'blossom' || p.kind === 'bush')
    ) {
      const key = `${Math.floor(p.x / VEGETATION_CHUNK_SIZE)},${Math.floor(p.z / VEGETATION_CHUNK_SIZE)}`;
      const bucket = shadowChunks.get(key) ?? [];
      bucket.push(p);
      shadowChunks.set(key, bucket);
    }
  for (const [key, plants] of shadowChunks) {
    plants.sort(
      (a, b) =>
        (a.kind === 'bush' ? a.detail : -1) -
        (b.kind === 'bush' ? b.detail : -1)
    );
    const shadows = new THREE.InstancedMesh(
      shadowGeometry,
      shadowMaterial,
      plants.length
    );
    shadows.name = `vegetation-shadow-${key}`;
    plants.forEach((p, i) => {
      const r = p.radius * 1.2;
      dummy.position.set(
        p.x + r * 0.25,
        groundHeightAt(layout.surface, p.x, p.z) + 0.035,
        p.z + r * 0.18
      );
      dummy.rotation.set(0, p.heading, 0);
      dummy.scale.set(r, 1, r * 0.8);
      dummy.updateMatrix();
      shadows.setMatrixAt(i, dummy.matrix);
    });
    shadows.computeBoundingSphere();
    details.push({
      mesh: shadows,
      full: plants.length,
      light: plants.filter((p) => p.kind !== 'bush' || p.detail < 0.35).length,
    });
    object.add(shadows);
  }
  let disposed = false,
    wasMoving = false;
  let enabledWind = layout.options.wind;
  function setDetail(quality: 'light' | 'standard', wind: boolean): number {
    if (disposed) return 0;
    for (const detail of details)
      detail.mesh.count = quality === 'light' ? detail.light : detail.full;
    enabledWind = wind;
    return quality === 'light'
      ? layout.allPlants.filter(
          (p) => p.kind === 'tree' || p.kind === 'blossom' || p.detail < 0.35
        ).length
      : layout.allPlants.length;
  }
  setDetail(layout.options.quality, enabledWind);
  return {
    object,
    setDetail,
    update(seconds, nextFocus, reduced, active) {
      if (disposed) return false;
      const moving = active && !reduced && enabledWind;
      const changed = moving || moving !== wasMoving;
      motion.value = moving ? 1 : 0;
      if (moving) time.value = seconds % (Math.PI * 1000);
      focus.value.copy(nextFocus);
      wasMoving = moving;
      return changed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      const owned = new Set<THREE.BufferGeometry>([
        ...geometries.values(),
        shadowGeometry,
      ]);
      object.traverse((node) => {
        if (node instanceof THREE.InstancedMesh) {
          node.dispose();
          owned.add(node.geometry);
        }
      });
      for (const geometry of owned) geometry.dispose();
      material.dispose();
      shadowMaterial.dispose();
      object.clear();
    },
  };
}

export function createSceneryOverlay(
  layout: SceneryLayout,
  clearance: boolean,
  trackSamples: readonly {
    x: number;
    z: number;
    width: number;
    tx: number;
    tz: number;
  }[]
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery-debug-overlay';
  const points: number[] = [];
  if (clearance)
    for (let i = 0; i < trackSamples.length; i++) {
      const a = trackSamples[i],
        b = trackSamples[(i + 1) % trackSamples.length];
      if (!a || !b) continue;
      for (const side of [-1, 1]) {
        const da = side * (a.width / 2 + 12),
          db = side * (b.width / 2 + 12);
        points.push(
          a.x - a.tz * da,
          0.18,
          a.z + a.tx * da,
          b.x - b.tz * db,
          0.18,
          b.z + b.tx * db
        );
      }
    }
  else
    for (const r of layout.regions)
      for (let i = 0; i < 48; i++) {
        for (const angle of [
          (i / 48) * Math.PI * 2,
          ((i + 1) / 48) * Math.PI * 2,
        ]) {
          const radius = 1 + 0.15 * Math.sin(angle * 3 + r.phase);
          const x = Math.cos(angle) * r.rx * radius,
            z = Math.sin(angle) * r.rz * radius;
          points.push(
            r.x + x * Math.cos(r.heading) - z * Math.sin(r.heading),
            0.3,
            r.z + x * Math.sin(r.heading) + z * Math.cos(r.heading)
          );
        }
      }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3)
  );
  group.add(
    new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: clearance ? '#ed795b' : '#f4d289',
        depthTest: false,
      })
    )
  );
  return group;
}
