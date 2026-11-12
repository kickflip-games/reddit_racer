import * as THREE from 'three';

export const CAR_VISUAL_LENGTH = 3.8;
export const CAR_VISUAL_GROUND_Y = 0.045;
/** Conservative radius shared by both fallback and imported art placements. */
export const CAR_VISUAL_FOOTPRINT = 2.3;
export type CarVisualFrame = {
  x: number;
  z: number;
  heading: number;
  distance: number;
  speed: number;
  acceleration: number;
  lateralAcceleration: number;
  curvature: number;
  slip: number;
  held: boolean;
  racing: boolean;
  reducedMotion: boolean;
  deltaSeconds: number;
};
export type CarVisual = {
  object: THREE.Group;
  readonly kind: 'fallback' | 'kenney';
  installModel(template: THREE.Group): boolean;
  update(frame: Readonly<CarVisualFrame>): void;
  reset(): void;
  getRearContacts(leftOut: THREE.Vector3, rightOut: THREE.Vector3): void;
  dispose(): void;
};
type WheelVisual = {
  node: THREE.Object3D;
  quaternion: THREE.Quaternion;
  radius: number;
};
type Rig = {
  object: THREE.Group;
  body: THREE.Group;
  wheels: WheelVisual[];
  rearLeft: THREE.Vector3;
  rearRight: THREE.Vector3;
  leanLimit: number;
};
const wheelNames = [
  'wheel-front-left',
  'wheel-front-right',
  'wheel-back-left',
  'wheel-back-right',
];

export function createCarVisual(): CarVisual {
  const object = new THREE.Group();
  object.name = 'race-car';
  object.position.y = CAR_VISUAL_GROUND_Y;
  let kind: 'fallback' | 'kenney' = 'fallback';
  let disposed = false;
  let source: THREE.Group | undefined;
  let pitch = 0;
  let roll = 0;
  const fallbackGeometries = new Set<THREE.BufferGeometry>();
  const fallbackMaterials = new Set<THREE.Material>();
  const lampGeometry = new THREE.BoxGeometry(0.35, 0.14, 0.16);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: '#6f231c' });
  const shadowGeometry = new THREE.PlaneGeometry(2.65, 4.3);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: '#183529',
    transparent: true,
    opacity: 0.23,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.name = 'car-contact-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.003;
  object.add(shadow);

  function ownedMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material
  ): THREE.Mesh {
    fallbackGeometries.add(geometry);
    fallbackMaterials.add(material);
    return new THREE.Mesh(geometry, material);
  }
  function fallback(): THREE.Group {
    const model = new THREE.Group();
    const body = new THREE.Group();
    body.name = 'body';
    const paint = new THREE.MeshStandardMaterial({
      color: '#f57b24',
      roughness: 0.8,
    });
    const main = ownedMesh(
      new THREE.BoxGeometry(1.85, 0.56, CAR_VISUAL_LENGTH),
      paint
    );
    main.position.y = 0.75;
    const cabin = ownedMesh(
      new THREE.BoxGeometry(1.4, 0.5, 1.55),
      new THREE.MeshStandardMaterial({ color: '#263f43', roughness: 0.55 })
    );
    cabin.position.set(0, 1.23, -0.13);
    body.add(main, cabin);
    model.add(body);
    const tyreGeometry = new THREE.CylinderGeometry(0.43, 0.43, 0.3, 10);
    tyreGeometry.rotateZ(Math.PI / 2);
    const tyreMaterial = new THREE.MeshStandardMaterial({
      color: '#24312f',
      roughness: 1,
    });
    wheelNames.forEach((name, index) => {
      const wheel = ownedMesh(tyreGeometry, tyreMaterial);
      wheel.name = name;
      wheel.position.set(
        index % 2 === 0 ? 0.96 : -0.96,
        0.43,
        index < 2 ? 1.05 : -1.08
      );
      model.add(wheel);
    });
    return model;
  }
  function buildRig(model: THREE.Group): Rig | undefined {
    model.updateMatrixWorld(true);
    const bodyNode = model.getObjectByName('body');
    const wheelNodes = wheelNames.map((name) => model.getObjectByName(name));
    if (!bodyNode || !bodyNode.parent || wheelNodes.some((node) => !node))
      return undefined;
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (
      bounds.isEmpty() ||
      !Number.isFinite(size.x + size.y + size.z) ||
      size.z <= 0 ||
      size.x <= 0 ||
      size.y <= 0
    )
      return undefined;
    const scale = CAR_VISUAL_LENGTH / size.z;
    if (scale < 0.1 || scale > 10) return undefined;
    const normalized = new THREE.Group();
    normalized.name = 'car-model';
    normalized.scale.setScalar(scale);
    normalized.position.set(
      (-(bounds.min.x + bounds.max.x) * scale) / 2,
      -bounds.min.y * scale,
      (-(bounds.min.z + bounds.max.z) * scale) / 2
    );
    normalized.add(model);
    normalized.updateMatrixWorld(true);
    const normalizedBounds = new THREE.Box3().setFromObject(normalized);
    if (
      Math.hypot((size.x * scale) / 2, CAR_VISUAL_LENGTH / 2) >
      CAR_VISUAL_FOOTPRINT
    )
      return undefined;
    const bodyBounds = new THREE.Box3().setFromObject(bodyNode);
    const bodyCenter = bodyBounds.getCenter(new THREE.Vector3());
    const parent = bodyNode.parent;
    const body = new THREE.Group();
    body.name = 'car-body-wrapper';
    body.position.copy(parent.worldToLocal(bodyCenter.clone()));
    parent.add(body);
    parent.updateMatrixWorld(true);
    body.attach(bodyNode);
    normalized.updateMatrixWorld(true);
    const radius = bodyBounds.getSize(new THREE.Vector3()).length() / 2;
    const leanLimit = Math.max(
      0,
      Math.min(0.12, (bodyBounds.min.y - 0.018) / Math.max(radius, 0.1))
    );
    const wheels: WheelVisual[] = [];
    const contacts: THREE.Vector3[] = [];
    for (const wheel of wheelNodes) {
      if (!wheel) return undefined;
      const wheelBounds = new THREE.Box3().setFromObject(wheel);
      const wheelSize = wheelBounds.getSize(new THREE.Vector3());
      const center = wheelBounds.getCenter(new THREE.Vector3());
      const wheelRadius = Math.max(wheelSize.y, wheelSize.z) / 2;
      if (!Number.isFinite(wheelRadius) || wheelRadius <= 0) return undefined;
      contacts.push(
        new THREE.Vector3(center.x, normalizedBounds.min.y, center.z)
      );
      wheels.push({
        node: wheel,
        quaternion: wheel.quaternion.clone(),
        radius: wheelRadius,
      });
    }
    const rearLeft = contacts[2];
    const rearRight = contacts[3];
    if (!rearLeft || !rearRight) return undefined;
    const lamps = new THREE.Group();
    lamps.name = 'rear-brake-lamps';
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
      lamp.position.set(
        side * size.x * scale * 0.3,
        Math.max(0.5, size.y * scale * 0.43),
        -CAR_VISUAL_LENGTH / 2 - 0.018
      );
      lamps.add(lamp);
    }
    normalized.updateMatrixWorld(true);
    body.attach(lamps);
    return { object: normalized, body, wheels, rearLeft, rearRight, leanLimit };
  }
  const initial = buildRig(fallback());
  if (!initial) throw new Error('The fallback car could not be built');
  let rig = initial;
  object.add(rig.object);
  const spin = new THREE.Quaternion();
  const axle = new THREE.Vector3(1, 0, 0);
  const clamp = THREE.MathUtils.clamp;
  function releaseFallback(): void {
    for (const geometry of fallbackGeometries) geometry.dispose();
    for (const material of fallbackMaterials) material.dispose();
    fallbackGeometries.clear();
    fallbackMaterials.clear();
  }
  function reset(): void {
    pitch = 0;
    roll = 0;
    rig.body.rotation.set(0, 0, 0);
    for (const wheel of rig.wheels)
      wheel.node.quaternion.copy(wheel.quaternion);
    lampMaterial.color.set('#6f231c');
  }
  return {
    object,
    get kind() {
      return kind;
    },
    installModel(template) {
      if (disposed) return false;
      if (source === template) return true;
      const next = buildRig(template.clone(true));
      if (!next) return false;
      object.remove(rig.object);
      rig = next;
      object.add(rig.object);
      source = template;
      kind = 'kenney';
      releaseFallback();
      reset();
      return true;
    },
    update(frame) {
      if (disposed) return;
      object.position.set(frame.x, CAR_VISUAL_GROUND_Y, frame.z);
      object.rotation.y = frame.heading;
      const active = frame.racing && !frame.reducedMotion;
      let targetPitch = active
        ? clamp(-frame.acceleration * 0.003, -0.055, 0.055)
        : 0;
      const cornerLoad =
        frame.curvature * frame.speed * frame.speed + frame.lateralAcceleration;
      // +Z forward: positive normal load is toward -X. Lower the outward +X side.
      let targetRoll = active ? clamp(-cornerLoad * 0.0025, -0.085, 0.085) : 0;
      const combined = Math.hypot(targetPitch, targetRoll);
      if (combined > rig.leanLimit) {
        targetPitch *= rig.leanLimit / combined;
        targetRoll *= rig.leanLimit / combined;
      }
      const blend = frame.reducedMotion
        ? 1
        : 1 - Math.exp(-Math.min(0.05, Math.max(0, frame.deltaSeconds)) * 12);
      pitch += (targetPitch - pitch) * blend;
      roll += (targetRoll - roll) * blend;
      rig.body.rotation.set(pitch, 0, roll);
      for (const wheel of rig.wheels) {
        spin.setFromAxisAngle(
          axle,
          (frame.distance / wheel.radius) % (Math.PI * 2)
        );
        wheel.node.quaternion.copy(wheel.quaternion).multiply(spin);
      }
      lampMaterial.color.set(
        frame.racing && !frame.held ? '#ff3026' : '#6f231c'
      );
    },
    reset,
    getRearContacts(leftOut, rightOut) {
      object.updateWorldMatrix(true, false);
      leftOut.copy(rig.rearLeft).applyMatrix4(object.matrixWorld);
      rightOut.copy(rig.rearRight).applyMatrix4(object.matrixWorld);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      object.clear();
      releaseFallback();
      lampGeometry.dispose();
      lampMaterial.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
    },
  };
}
