import * as THREE from 'three';
import { ghostPosition, type GhostLap } from './best-ghost';
import { CAR_VISUAL_GROUND_Y, CAR_VISUAL_LENGTH } from './car-visual';
/** Transparent copy of the loaded car, without a trailing line. */
export function createGhostVisual() {
  const object = new THREE.Group();
  const car = new THREE.Group();
  car.name = 'best-lap-ghost-car';
  car.rotation.order = 'YXZ';
  let ready = false;
  let disposed = false;
  const materials = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  object.add(car);
  object.visible = false;
  return {
    object,
    installModel(template: THREE.Group): boolean {
      if (disposed || ready) return ready;
      const clone = template.clone(true);
      clone.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(clone);
      const size = bounds.getSize(new THREE.Vector3());
      if (
        bounds.isEmpty() ||
        !Number.isFinite(size.x + size.y + size.z) ||
        size.z <= 0 ||
        size.y <= 0 ||
        size.x <= 0
      )
        return false;
      const scale = CAR_VISUAL_LENGTH / size.z;
      if (scale < 0.1 || scale > 10) return false;
      const normalized = new THREE.Group();
      normalized.scale.setScalar(scale);
      normalized.position.set(
        (-(bounds.min.x + bounds.max.x) * scale) / 2,
        -bounds.min.y * scale,
        (-(bounds.min.z + bounds.max.z) * scale) / 2
      );
      clone.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const convert = (source: THREE.Material) => {
          let material = materials.get(source);
          if (!material) {
            material = new THREE.MeshBasicMaterial({
              color:
                source instanceof THREE.MeshStandardMaterial ||
                source instanceof THREE.MeshBasicMaterial
                  ? source.color
                  : '#d7f7ff',
              map:
                source instanceof THREE.MeshStandardMaterial ||
                source instanceof THREE.MeshBasicMaterial
                  ? source.map
                  : null,
              transparent: true,
              opacity: 0.38,
              depthWrite: false,
            });
            materials.set(source, material);
          }
          return material;
        };
        node.material = Array.isArray(node.material)
          ? node.material.map(convert)
          : convert(node.material);
        node.castShadow = false;
        node.receiveShadow = false;
      });
      normalized.add(clone);
      car.add(normalized);
      ready = true;
      return true;
    },
    update(lap: GhostLap | null, ticks: number, enabled: boolean) {
      const p =
        lap && enabled && ready && !disposed ? ghostPosition(lap, ticks) : null;
      object.visible = !!p;
      if (!p || !lap) return;
      car.position.set(p[0], p[1] + CAR_VISUAL_GROUND_Y, p[2]);
      const before = ghostPosition(lap, Math.max(0, ticks - 6)) ?? p;
      const after = ghostPosition(lap, Math.min(lap.ticks, ticks + 6)) ?? p;
      const dx = after[0] - before[0],
        dz = after[2] - before[2];
      if (Math.hypot(dx, dz) > 0.0001) {
        car.rotation.y = Math.atan2(dx, dz);
        car.rotation.x = -Math.atan2(after[1] - before[1], Math.hypot(dx, dz));
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of materials.values()) material.dispose();
      materials.clear();
      car.clear();
      object.visible = false;
      // Template geometry/textures remain owned by the shared asset cache.
    },
  };
}
