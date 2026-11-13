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
  const base = new THREE.Color('#829e68'),
    light = new THREE.Color('#a6b87f'),
    dark = new THREE.Color('#65885d'),
    soil = new THREE.Color('#b6a27b');
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
  // The sun and hemisphere are static. Bake their diffuse light into the ground
  // once, avoiding derivative normals and lighting across the whole screen each frame.
  const normals = geometry.getAttribute('normal');
  const skyLight = new THREE.Color('#fff1d3').multiplyScalar(2.1);
  const groundLight = new THREE.Color('#71806a').multiplyScalar(2.1);
  const sunLight = new THREE.Color('#fff0d6').multiplyScalar(2.4);
  const sunDirection = new THREE.Vector3(-30, 80, 30).normalize();
  const normal = new THREE.Vector3(),
    lighting = new THREE.Color(),
    direct = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    normal.fromBufferAttribute(normals, i);
    direct.copy(sunLight).multiplyScalar(Math.max(0, normal.dot(sunDirection)));
    lighting
      .copy(groundLight)
      .lerp(skyLight, (normal.y + 1) / 2)
      .add(direct)
      .multiplyScalar(1 / Math.PI);
    colors[i * 3] = (colors[i * 3] ?? 0) * lighting.r;
    colors[i * 3 + 1] = (colors[i * 3 + 1] ?? 0) * lighting.g;
    colors[i * 3 + 2] = (colors[i * 3 + 2] ?? 0) * lighting.b;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true })
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
    fragmentShader: `varying vec2 vUv; void main() { float r = length(vUv * 2.0 - 1.0); float a = (1.0 - smoothstep(0.25, 1.0, r)) * 0.19; gl_FragColor = vec4(0.16, 0.19, 0.14, a); }`,
  });
  const shadows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    material,
    placements.length
  );
  shadows.name = 'scenery-contact-shadows';
  const dummy = new THREE.Object3D();
  placements.forEach((placement, i) => {
    const tree = placement.kind === 'treeSmall';
    dummy.position.set(
      placement.x + (tree ? 1.2 : 0.3),
      groundHeightAt(surface, placement.x, placement.z) + 0.035,
      placement.z + (tree ? 1.5 : 0.3)
    );
    dummy.rotation.set(-Math.PI / 2, 0, -0.4);
    dummy.scale.set(tree ? 5.4 : 2.8, tree ? 7.2 : 2, 1);
    dummy.updateMatrix();
    shadows.setMatrixAt(i, dummy.matrix);
  });
  shadows.computeBoundingSphere();
  group.add(shadows);
  return group;
}
