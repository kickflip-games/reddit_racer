import * as THREE from 'three';

/** Keep imported palette/alpha detail, without a PBR highlight or an outline pass.
 * Textures remain borrowed from the asset cache; callers own the new material.
 */
export function toonMaterial(
  source: THREE.MeshStandardMaterial
): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    color: source.color,
    map: source.map,
    alphaMap: source.alphaMap,
    alphaTest: source.alphaTest,
    transparent: source.transparent,
    opacity: source.opacity,
    side: source.side,
    vertexColors: source.vertexColors,
    depthWrite: source.depthWrite,
    emissive: source.emissive,
    emissiveMap: source.emissiveMap,
    emissiveIntensity: source.emissiveIntensity,
  });
  material.name = source.name;
  return material;
}

/** Soft projected shadow, not a shadow-map render or a baked lightmap. */
export function softCarShadow(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { opacity: { value: 0.29 } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; uniform float opacity;
      void main() {
        vec2 p = abs(vUv * 2.0 - 1.0);
        float silhouette = pow(pow(p.x, 4.0) + pow(p.y, 4.0), 0.25);
        float a = (1.0 - smoothstep(0.45, 1.0, silhouette)) * opacity;
        gl_FragColor = vec4(0.10, 0.14, 0.16, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
