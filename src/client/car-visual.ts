import * as THREE from 'three';
import { softCarShadow, toonMaterial, toonGradient } from './toon-material';
import {
  createRecoveryFeedback,
  type RecoveryVisualFrame,
} from './recovery-feedback';

export const CAR_VISUAL_LENGTH = 3.8;
export const CAR_VISUAL_GROUND_Y = 0.045;
/** Below 0.001 degrees: settle body lean exactly so inactive rendering can stop. */
export const CAR_VISUAL_SETTLE_EPSILON = 0.00001;
/** Conservative radius shared by both fallback and imported art placements. */
export const CAR_VISUAL_FOOTPRINT = 2.3;
export type CarVisualFrame = {
  recovery?: Readonly<RecoveryVisualFrame>;
  suspensionCompression?: number;
  elevation?: number;
  surfaceHeight?: number;
  bank?: number;
  jumpPitch?: number;
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
  countdownBurnout?: boolean;
  reducedMotion: boolean;
  deltaSeconds: number;
};
export type CarVisual = {
  object: THREE.Group;
  readonly kind: 'fallback' | 'kenney';
  installModel(template: THREE.Group): boolean;
  update(frame: Readonly<CarVisualFrame>): boolean;
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
  bodyRestY: number;
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
  object.rotation.order = 'YXZ';
  object.position.y = CAR_VISUAL_GROUND_Y;
  let kind: 'fallback' | 'kenney' = 'fallback';
  let disposed = false;
  let source: THREE.Group | undefined;
  let pitch = 0;
  let roll = 0;
  let braking = false;
  let burnoutAngle = 0;
  let pendingChanged = true;
  const fallbackGeometries = new Set<THREE.BufferGeometry>();
  const fallbackMaterials = new Set<THREE.Material>();
  const lampGeometry = new THREE.BoxGeometry(0.35, 0.14, 0.16);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: '#6f231c' });
  const shadowGeometry = new THREE.PlaneGeometry(2, 2);
  const shadowMaterial = softCarShadow();
  const recovery = createRecoveryFeedback();
  const recoveryGeometry = new THREE.RingGeometry(2.05, 2.18, 48);
  const recoveryMaterial = new THREE.MeshBasicMaterial({
    color: '#ffe09a',
    transparent: true,
    opacity: 0.8,
    // Keep the reset marker legible while a fallen car returns through a deck.
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const recoveryHalo = new THREE.Mesh(recoveryGeometry, recoveryMaterial);
  recoveryHalo.name = 'car-recovery-halo';
  recoveryHalo.rotation.x = -Math.PI / 2;
  recoveryHalo.position.y = 0.025;
  recoveryHalo.renderOrder = 5;
  recoveryHalo.visible = false;
  object.add(recoveryHalo);
  const importedMaterials = new Map<THREE.Material, THREE.Material>();
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.name = 'car-contact-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.matrixAutoUpdate = false;
  const groundMatrix = new THREE.Matrix4();
  const groundPosition = new THREE.Vector3();
  const groundRotation = new THREE.Quaternion();
  const groundScale = new THREE.Vector3();
  const groundEuler = new THREE.Euler();
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
    const paint = new THREE.MeshToonMaterial({
      gradientMap: toonGradient,
      color: '#f57b24',
    });
    const main = ownedMesh(
      new THREE.BoxGeometry(1.85, 0.56, CAR_VISUAL_LENGTH),
      paint
    );
    main.position.y = 0.75;
    const cabin = ownedMesh(
      new THREE.BoxGeometry(1.4, 0.5, 1.55),
      new THREE.MeshToonMaterial({
        gradientMap: toonGradient,
        color: '#263f43',
      })
    );
    cabin.position.set(0, 1.23, -0.13);
    body.add(main, cabin);
    model.add(body);
    const tyreGeometry = new THREE.CylinderGeometry(0.43, 0.43, 0.3, 10);
    tyreGeometry.rotateZ(Math.PI / 2);
    const tyreMaterial = new THREE.MeshToonMaterial({
      gradientMap: toonGradient,
      color: '#24312f',
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
    return {
      object: normalized,
      body,
      wheels,
      rearLeft,
      rearRight,
      leanLimit,
      bodyRestY: body.position.y,
    };
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
    if (disposed) return;
    pendingChanged = true;
    recovery.reset();
    rig.object.visible = true;
    recoveryHalo.visible = false;
    braking = false;
    burnoutAngle = 0;
    pitch = 0;
    roll = 0;
    rig.body.rotation.set(0, 0, 0);
    rig.body.position.y = rig.bodyRestY;
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
      const model = template.clone(true);
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const convert = (source: THREE.Material): THREE.Material => {
          if (!(source instanceof THREE.MeshStandardMaterial)) return source;
          let material = importedMaterials.get(source);
          if (!material) {
            material = toonMaterial(source);
            importedMaterials.set(source, material);
          }
          return material;
        };
        node.material = Array.isArray(node.material)
          ? node.material.map(convert)
          : convert(node.material);
      });
      const next = buildRig(model);
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
      if (disposed) return false;
      let changed = pendingChanged;
      pendingChanged = false;
      const recovering = recovery.update(frame.recovery, frame.reducedMotion);
      if (
        rig.object.visible !== recovering.visible ||
        recoveryHalo.visible !== recovering.active
      ) {
        // Only this player's owned rig blinks. Materials and cached templates
        // remain untouched, and reduced motion keeps a steady halo and car.
        rig.object.visible = recovering.visible;
        recoveryHalo.visible = recovering.active;
        changed = true;
      }
      if (
        object.position.x !== frame.x ||
        object.position.y !== CAR_VISUAL_GROUND_Y + (frame.elevation ?? 0) ||
        object.position.z !== frame.z
      ) {
        object.position.set(
          frame.x,
          CAR_VISUAL_GROUND_Y + (frame.elevation ?? 0),
          frame.z
        );
        changed = true;
      }
      if (object.rotation.x !== (frame.jumpPitch ?? 0)) {
        object.rotation.x = frame.jumpPitch ?? 0;
        changed = true;
      }
      if (object.rotation.z !== (frame.bank ?? 0)) {
        object.rotation.z = frame.bank ?? 0;
        changed = true;
      }
      if (object.rotation.y !== frame.heading) {
        object.rotation.y = frame.heading;
        changed = true;
      }
      // The shadow stays on the ground as the car rises into the air.
      const altitude = Math.max(
        0,
        (frame.elevation ?? 0) - (frame.surfaceHeight ?? 0)
      );
      groundPosition.set(
        frame.x + altitude * 0.375,
        (frame.surfaceHeight ?? 0) + 0.038,
        frame.z - altitude * 0.375
      );
      groundRotation.setFromEuler(
        groundEuler.set(-Math.PI / 2, 0, -frame.heading)
      );
      groundScale.set(1.45 + altitude * 0.12, 2.3 + altitude * 0.17, 1);
      object.updateMatrix();
      groundMatrix.compose(groundPosition, groundRotation, groundScale);
      shadow.matrix.copy(object.matrix).invert().multiply(groundMatrix);
      shadowMaterial.uniforms.opacity!.value = 0.36 / (1 + altitude * 0.18);
      const active = frame.racing && !frame.reducedMotion;
      const bodyY =
        rig.bodyRestY -
        (active
          ? clamp(frame.suspensionCompression ?? 0, -0.035, 0.09) /
            rig.object.scale.y
          : 0);
      if (rig.body.position.y !== bodyY) {
        rig.body.position.y = bodyY;
        changed = true;
      }
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
      let nextPitch = pitch + (targetPitch - pitch) * blend;
      let nextRoll = roll + (targetRoll - roll) * blend;
      if (Math.abs(nextPitch - targetPitch) <= CAR_VISUAL_SETTLE_EPSILON)
        nextPitch = targetPitch;
      if (Math.abs(nextRoll - targetRoll) <= CAR_VISUAL_SETTLE_EPSILON)
        nextRoll = targetRoll;
      if (pitch !== nextPitch || roll !== nextRoll) {
        pitch = nextPitch;
        roll = nextRoll;
        rig.body.rotation.set(pitch, 0, roll);
        changed = true;
      }
      // Decorative rear-wheel rotation only. Never feeds distance or simulation.
      if (frame.countdownBurnout && frame.held && !frame.reducedMotion) {
        const delta = Number.isFinite(frame.deltaSeconds)
          ? clamp(frame.deltaSeconds, 0, 0.05)
          : 0;
        burnoutAngle = (burnoutAngle + delta * 24) % (Math.PI * 2);
      }
      for (const wheel of rig.wheels) {
        spin.setFromAxisAngle(
          axle,
          (frame.distance / wheel.radius +
            (wheel.node.name.startsWith('wheel-back-') ? burnoutAngle : 0)) %
            (Math.PI * 2)
        );
        spin.premultiply(wheel.quaternion);
        if (!wheel.node.quaternion.equals(spin)) {
          wheel.node.quaternion.copy(spin);
          changed = true;
        }
      }
      const nextBraking = frame.racing && !frame.held;
      if (braking !== nextBraking) {
        braking = nextBraking;
        lampMaterial.color.set(braking ? '#ff3026' : '#6f231c');
        changed = true;
      }
      return changed;
    },
    reset,
    getRearContacts(leftOut, rightOut) {
      object.updateWorldMatrix(true, false);
      leftOut.copy(rig.rearLeft).applyMatrix4(object.matrixWorld);
      rightOut.copy(rig.rearRight).applyMatrix4(object.matrixWorld);
    },
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      object.removeFromParent();
      object.clear();
      releaseFallback();
      lampGeometry.dispose();
      lampMaterial.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      recoveryGeometry.dispose();
      recoveryMaterial.dispose();
      for (const material of importedMaterials.values()) material.dispose();
      importedMaterials.clear();
    },
  };
}
