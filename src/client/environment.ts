import * as THREE from 'three';
import type { Track } from '../shared/track';
import type { SceneryPlacement } from './scenery';
import {
  generateSceneryLayout,
  groundHeightAt,
  regionTint,
  createRoadField,
  sceneryHash,
  type SceneryLayout,
} from './scenery-layout';

/** Bounded diorama terrain: road/runoff remains flat; only distant ground rises. */
export function createEnvironment(
  track: Track,
  placements: readonly SceneryPlacement[],
  layout: SceneryLayout = generateSceneryLayout(track)
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'race-environment';
  const surface = layout.surface;
  const geometry = new THREE.PlaneGeometry(
    surface.width,
    surface.depth,
    surface.nx,
    surface.nz
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(
    surface.minX + surface.width / 2,
    0,
    surface.minZ + surface.depth / 2
  );
  const position = geometry.getAttribute('position'),
    colors: number[] = [];
  const field = createRoadField(track),
    phase = (sceneryHash(layout.seed) / 4294967296) * Math.PI * 2;
  const base = new THREE.Color('#4eaa65'),
    light = new THREE.Color('#91c976'),
    dark = new THREE.Color('#2d7863'),
    soil = new THREE.Color('#c7ae79');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i);
    position.setY(i, surface.heights[i] ?? -0.12);
    const noise =
      Math.sin(x * 0.031 + phase) * Math.cos(z * 0.037 - phase) * 0.5 + 0.5;
    const patch = regionTint(layout, x, z),
      road = field.sample(x, z);
    const color = base.clone().lerp(light, noise * 0.35);
    if (
      patch.kind === 'grove' ||
      patch.kind === 'woodland' ||
      patch.kind === 'hedge'
    )
      color.lerp(dark, patch.weight * 0.65);
    else color.lerp(light, patch.weight * 0.4);
    if (road.clearance > 0.8 && road.clearance < 3.5)
      color.lerp(soil, Math.max(0, Math.sin(road.s * 0.09 + phase)) * 0.5);
    colors.push(color.r, color.g, color.b);
  }
  geometry.computeVertexNormals();
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  // A single opaque pass: broad world-space colour patches plus three diffuse
  // bands. No screen-space outlines, textures, postprocessing or extra geometry.
  const ground = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      vertexColors: true,
      vertexShader: `varying vec3 vTint; varying vec3 vNormal; varying vec2 vWorld;
      void main() {
        vTint = color; vNormal = normal; vWorld = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
      fragmentShader: `varying vec3 vTint; varying vec3 vNormal; varying vec2 vWorld;
      void main() {
        float light = dot(normalize(vNormal), normalize(vec3(-30.0,80.0,30.0)));
        float band = light < 0.45 ? 0.66 : (light < 0.8 ? 0.84 : 1.0);
        float field = sin(vWorld.x * 0.028 + sin(vWorld.y * 0.019)) * cos(vWorld.y * 0.031);
        float patchMask = smoothstep(-0.1, 0.04, field);
        vec3 tint = mix(vTint * vec3(0.83,0.94,1.02), vTint * vec3(1.04,1.04,0.91), patchMask);
        gl_FragColor = vec4(tint * band, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    })
  );
  ground.name = 'diorama-terrain';
  group.add(ground);
  // One static instance buffer for soft tree/barrier contact shadows.
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {},
    vertexShader:
      `varying vec2 vUv; void main() { vUv = uv; vec4 p = vec4(position, 1.0); #ifdef USE_INSTANCING\np = instanceMatrix * p;\n#endif\ngl_Position = projectionMatrix * modelViewMatrix * p; }`.replace(
        ' #ifdef',
        '\n#ifdef'
      ),
    fragmentShader: `varying vec2 vUv; void main() { float r = length(vUv * 2.0 - 1.0); float a = (1.0 - smoothstep(0.25, 1.0, r)) * 0.27; gl_FragColor = vec4(0.16, 0.19, 0.14, a); }`,
  });
  // Trees from the newer vegetation batches also need grounding. Cap coverage
  // deterministically, and keep all projections in this one static draw call.
  const shadowPlacements = [
    ...placements.map((p) => ({
      x: p.x,
      z: p.z,
      tree: p.kind === 'treeSmall',
      scale: p.scale ?? 1,
    })),
    ...layout.plants
      .filter((p) => p.kind === 'tree' || p.kind === 'blossom')
      .slice(0, 256)
      .map((p) => ({ x: p.x, z: p.z, tree: true, scale: p.scale * 0.75 })),
  ];
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    material,
    shadowPlacements.length
  );
  shadows.name = 'scenery-contact-shadows';
  const dummy = new THREE.Object3D();
  shadowPlacements.forEach((placement, i) => {
    const tree = placement.tree;
    dummy.position.set(
      placement.x + (tree ? 1.2 : 0.3),
      groundHeightAt(surface, placement.x, placement.z) + 0.035,
      placement.z - (tree ? 1.2 : 0.3)
    );
    dummy.rotation.set(-Math.PI / 2, 0, -Math.PI / 4);
    dummy.scale.set(
      (tree ? 5.4 : 2.8) * placement.scale,
      (tree ? 7.2 : 2) * placement.scale,
      1
    );
    dummy.updateMatrix();
    shadows.setMatrixAt(i, dummy.matrix);
  });
  shadows.computeBoundingSphere();
  group.add(shadows);
  return group;
}
