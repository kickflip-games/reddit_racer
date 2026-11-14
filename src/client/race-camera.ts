import { OrthographicCamera } from 'three';
import { sampleTrack, validateTrack, type Track } from '../shared/track';

export type RaceCameraPose = {
  distance: number;
  lateralOffset: number;
  heading: number;
  speed?: number;
  elevation?: number;
};
export type RaceCameraViewport = {
  width: number;
  height: number;
  insets: { top: number; right: number; bottom: number; left: number };
};
export type RaceCameraUpdate = {
  mode: 'overview' | 'chase';
  deltaSeconds: number;
  reset?: boolean;
  reducedMotion?: boolean;
};
export type RaceCamera = {
  camera: OrthographicCamera;
  readonly renderable: boolean;
  resize(viewport: RaceCameraViewport): boolean;
  update(pose: RaceCameraPose, options: RaceCameraUpdate): boolean;
};
// Fixed diorama angle: the world never turns with the car.
const pitch = (50 * Math.PI) / 180;
const cosine = Math.cos(pitch),
  sine = Math.sin(pitch);
const finite = (n: number): void => {
  if (!Number.isFinite(n)) throw new Error('Camera fields must be finite');
};

/** Stable car-relative framing. Preview is a hero section, rather than a whole-map thumbnail. */
export function createRaceCamera(track: Track): RaceCamera {
  validateTrack(track);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  const start = sampleTrack(track, 0);
  let pose: RaceCameraPose = {
    distance: 0,
    lateralOffset: 0,
    heading: Math.atan2(start.tx, start.tz),
  };
  let viewport: RaceCameraViewport = {
    width: 0,
    height: 0,
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  };
  let mode: RaceCameraUpdate['mode'] = 'overview';
  let initialized = false;
  let renderable = false;
  const forwardX = 0.6,
    forwardZ = 0.8;
  let anchorX = 0,
    anchorZ = 0,
    scale = 14;
  let previous = '';

  function fit(dt: number, reset: boolean): boolean {
    if (!renderable) return false;
    const frame = sampleTrack(track, pose.distance);
    const carX = frame.x + frame.nx * pose.lateralOffset,
      carZ = frame.z + frame.nz * pose.lateralOffset;
    const ahead =
      mode === 'overview'
        ? 21
        : Math.min(36, Math.max(25, (pose.speed ?? 18) * 1.7));
    const elapsed = Math.min(0.1, dt);
    const snap = reset || !initialized;
    const rightX = forwardZ,
      rightZ = -forwardX;
    const points: { x: number; z: number; y: number }[] = [];
    for (let i = 0; i <= 20; i++) {
      const road = sampleTrack(
        track,
        pose.distance - 4 + ((ahead + 4) * i) / 20
      );
      for (const side of [-1, 1])
        points.push({
          x: road.x + road.nx * (road.halfWidth + 0.8) * side,
          z: road.z + road.nz * (road.halfWidth + 0.8) * side,
          y: road.y ?? 0,
        });
    }
    for (const x of [-2.6, 2.6])
      for (const z of [-2.6, 2.6])
        for (const y of [0, (pose.elevation ?? 0) + 2])
          points.push({ x: carX + x, z: carZ + z, y });
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const point of points) {
      const u = point.x * rightX + point.z * rightZ;
      const v =
        (point.x * forwardX + point.z * forwardZ) * cosine + point.y * sine;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const targetU = (minU + maxU) / 2;
    const targetV = (minV + maxV) / 2;
    const desiredX = targetU * rightX + (targetV / cosine) * forwardX;
    const desiredZ = targetU * rightZ + (targetV / cosine) * forwardZ;
    if (snap) {
      anchorX = desiredX;
      anchorZ = desiredZ;
    } else {
      const blend = 1 - Math.exp(-elapsed / 0.12);
      anchorX += (desiredX - anchorX) * blend;
      anchorZ += (desiredZ - anchorZ) * blend;
      if (Math.hypot(desiredX - anchorX, desiredZ - anchorZ) * scale < 0.03) {
        anchorX = desiredX;
        anchorZ = desiredZ;
      }
    }
    const width = viewport.width - viewport.insets.left - viewport.insets.right;
    const height =
      viewport.height - viewport.insets.top - viewport.insets.bottom;
    const u = anchorX * rightX + anchorZ * rightZ,
      v = (anchorX * forwardX + anchorZ * forwardZ) * cosine;
    const radiusU = Math.max(Math.abs(minU - u), Math.abs(maxU - u), 1);
    const radiusV = Math.max(Math.abs(minV - v), Math.abs(maxV - v), 1);
    const fitScale = Math.min(
      width / (2 * radiusU * 1.08),
      height / (2 * radiusV * 1.08),
      viewport.height > viewport.width && viewport.width < 700
        ? 12
        : mode === 'overview'
          ? 22
          : 19
    );
    // The car always fits. Far road edges may crop gently instead of shrinking the car to a speck.
    const carU = carX * rightX + carZ * rightZ,
      carV =
        (carX * forwardX + carZ * forwardZ) * cosine +
        (pose.elevation ?? 0) * sine;
    const carScale = Math.min(
      width / (2 * (Math.abs(carU - u) + 3.4)),
      height / (2 * (Math.abs(carV - v) + 3.4))
    );
    const minimumScale = viewport.width < 700 ? 11.5 : 15;
    const desiredScale = Math.min(
      carScale,
      Math.max(Math.min(minimumScale, height / 26), fitScale)
    );
    if (snap) scale = desiredScale;
    else {
      scale += (desiredScale - scale) * (1 - Math.exp(-elapsed / 0.45));
      if (Math.abs(desiredScale - scale) < 0.0001) scale = desiredScale;
    }
    scale = Math.min(scale, carScale);
    const centerX = viewport.insets.left + width / 2,
      centerY = viewport.insets.top + height / 2;
    const signature = JSON.stringify([
      anchorX,
      anchorZ,
      forwardX,
      forwardZ,
      scale,
      viewport,
      pose.elevation ?? 0,
    ]);
    if (signature === previous) return false;
    previous = signature;
    camera.left = -centerX / scale;
    camera.right = (viewport.width - centerX) / scale;
    camera.top = centerY / scale;
    camera.bottom = -(viewport.height - centerY) / scale;
    camera.position.set(
      anchorX - forwardX * 100 * sine,
      100 * cosine,
      anchorZ - forwardZ * 100 * sine
    );
    camera.lookAt(anchorX, 0, anchorZ);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    initialized = true;
    return true;
  }
  return {
    camera,
    get renderable() {
      return renderable;
    },
    resize(next) {
      for (const n of [
        next.width,
        next.height,
        ...Object.values(next.insets),
      ]) {
        finite(n);
        if (n < 0) throw new Error('Camera dimensions must be nonnegative');
      }
      viewport = { ...next, insets: { ...next.insets } };
      const was = renderable;
      renderable =
        next.width - next.insets.left - next.insets.right > 0.000001 &&
        next.height - next.insets.top - next.insets.bottom > 0.000001;
      return fit(0, !initialized) || was !== renderable;
    },
    update(next, options) {
      for (const n of [
        next.distance,
        next.lateralOffset,
        next.heading,
        next.speed ?? 0,
        next.elevation ?? 0,
        options.deltaSeconds,
      ])
        finite(n);
      if (
        options.deltaSeconds < 0 ||
        (options.mode !== 'overview' && options.mode !== 'chase')
      )
        throw new Error('Invalid camera update');
      const changedMode = mode !== options.mode;
      pose = { ...next };
      mode = options.mode;
      return fit(options.deltaSeconds, options.reset === true || changedMode);
    },
  };
}
