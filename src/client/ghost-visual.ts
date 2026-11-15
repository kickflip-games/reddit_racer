import * as THREE from 'three';
import { ghostPosition, type GhostLap } from './best-ghost';
/** Small translucent moving marker and a one-second ribbon, never a colliding car. */
export function createGhostVisual() {
  const object = new THREE.Group();
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.65, 8, 6),
    new THREE.MeshBasicMaterial({
      color: '#c9f9ff',
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    })
  );
  const positions = new Float32Array(13 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: '#d8ffff',
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    })
  );
  line.frustumCulled = false;
  object.add(marker, line);
  object.visible = false;
  return {
    object,
    update(lap: GhostLap | null, ticks: number, enabled: boolean) {
      const p = lap && enabled ? ghostPosition(lap, ticks) : null;
      object.visible = !!p;
      if (!p || !lap) return;
      marker.position.set(p[0], p[1] + 0.6, p[2]);
      let count = 0;
      for (let i = 12; i >= 0; i--) {
        const q = ghostPosition(lap, Math.max(0, ticks - i * 10));
        if (!q) continue;
        positions.set([q[0], q[1] + 0.35, q[2]], count++ * 3);
      }
      geometry.setDrawRange(0, count);
      geometry.attributes.position!.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      line.material.dispose();
      marker.geometry.dispose();
      marker.material.dispose();
    },
  };
}
