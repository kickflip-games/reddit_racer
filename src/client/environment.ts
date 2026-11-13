import * as THREE from 'three';
import type { Track } from '../shared/track';
import { circuitTerrainHeight } from './circuit-terrain';
import { getTrackBounds } from './track-renderer';
import type { SceneryPlacement } from './scenery';

/** Bounded diorama terrain: road/runoff remains flat; only distant ground rises. */
export function createEnvironment(
  track: Track,
  placements: readonly SceneryPlacement[]
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'race-environment';
  const bounds = getTrackBounds(track, 65);
  const width = bounds.maxX - bounds.minX,
    depth = bounds.maxZ - bounds.minZ;
  const geometry = new THREE.PlaneGeometry(
    width,
    depth,
    Math.min(64, Math.ceil(width / 5)),
    Math.min(64, Math.ceil(depth / 5))
  );
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(
    (bounds.minX + bounds.maxX) / 2,
    0,
    (bounds.minZ + bounds.maxZ) / 2
  );
  const position = geometry.getAttribute('position'),
    colors: number[] = [];
  const palette = ['#94a17b', '#9ca982', '#8b9b75', '#a4af89'].map(
    (c) => new THREE.Color(c)
  );
  const roads = track.samples.filter((_, i) => i % 6 === 0);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i);
    let clearance = Infinity;
    for (const road of roads)
      clearance = Math.min(
        clearance,
        Math.hypot(x - road.x, z - road.z) - road.width / 2
      );
    const noise =
      Math.sin(x * 0.071 + z * 0.031) * Math.cos(z * 0.083 - x * 0.016);
    const rise = Math.min(1, Math.max(0, (clearance - 14) / 18));
    position.setY(
      i,
      -0.12 +
        (track.schemaVersion === 2
          ? circuitTerrainHeight(track, x, z)
          : Math.max(0, noise) * rise * 3.6)
    );
    const color =
      palette[
        Math.abs(Math.floor(x / 18) + Math.floor(z / 21)) % palette.length
      ] ?? palette[0];
    if (color) colors.push(color.r, color.g, color.b);
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
      circuitTerrainHeight(track, placement.x, placement.z) - 0.06,
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
