import * as THREE from 'three';
import type { DrivingVfxFrame } from './driving-vfx';

/** Presentation only: duration comes from the actual practice physics input. */
export function driftStage(
  seconds: number | undefined
): 'off' | 'drift' | 'release' {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0)
    return 'off';
  return seconds > 0.65 ? 'release' : 'drift';
}

/** Fixed 16-quad budget, one draw call, no per-frame geometry or particles. */
export function createDriftSparks() {
  const count = 16;
  const positions = new Float32Array(count * 12);
  const indices = new Uint16Array(count * 6);
  for (let i = 0; i < count; i++) {
    const v = i * 4;
    indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
  }
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3).setUsage(
    THREE.DynamicDrawUsage
  );
  geometry.setAttribute('position', attribute);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    color: '#6cecff',
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const object = new THREE.Mesh(geometry, material);
  object.name = 'practice-drift-sparks';
  object.frustumCulled = false;
  object.visible = false;
  const reset = () => {
    const changed = object.visible;
    object.visible = false;
    geometry.setDrawRange(0, 0);
    return changed;
  };
  return {
    object,
    reset,
    update(frame: Readonly<DrivingVfxFrame>) {
      const seconds = frame.practiceDriftSeconds;
      const stage = driftStage(seconds);
      if (
        stage === 'off' ||
        frame.reducedMotion ||
        frame.phase !== 'racing' ||
        frame.state.status !== 'running' ||
        frame.state.speed <= 5 ||
        frame.state.offRoad ||
        frame.state.recovering ||
        frame.state.vertical?.airborne
      )
        return reset();
      const dx = frame.rearLeft.x - frame.rearRight.x;
      const dz = frame.rearLeft.z - frame.rearRight.z;
      const width = Math.hypot(dx, dz);
      if (
        !Number.isFinite(
          width + frame.rearLeft.y + frame.rearRight.y + frame.state.tick
        ) ||
        width < 0.001
      )
        return reset();
      const sx = dx / width,
        sz = dz / width;
      const strength = Math.min(1, (seconds ?? 0) / 0.65);
      const visibleCount = 4 + Math.floor(strength * 4) * 2;
      const halfWidth = Math.max(
        0.035,
        Math.min(0.12, 1.3 / Math.max(1, frame.cssPixelsPerMetre))
      );
      for (let i = 0; i < visibleCount; i++) {
        const contact = i % 2 === 0 ? frame.rearLeft : frame.rearRight;
        const side = i % 2 === 0 ? 1 : -1;
        const age = (frame.state.tick / 30 + i * 0.618) % 1;
        const back = 0.08 + age * (1.2 + strength * 1.0);
        const out = side * (0.08 + age * (0.3 + (i % 3) * 0.15));
        for (let corner = 0; corner < 4; corner++) {
          const along = back + (corner < 2 ? 0 : 0.35 + age * 0.3);
          const across = out + (corner % 2 ? halfWidth : -halfWidth);
          const offset = i * 12 + corner * 3;
          positions[offset] = contact.x + sz * along + sx * across;
          positions[offset + 1] =
            contact.y + 0.15 + Math.sin(age * Math.PI) * 0.12;
          positions[offset + 2] = contact.z - sx * along + sz * across;
        }
      }
      material.color.set(stage === 'release' ? '#ff9c36' : '#6cecff');
      geometry.setDrawRange(0, visibleCount * 6);
      attribute.needsUpdate = true;
      object.visible = true;
      return true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
