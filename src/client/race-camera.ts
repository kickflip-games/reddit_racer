import { OrthographicCamera } from 'three';
import { sampleTrack, validateTrack, type Track } from '../shared/track';

export type RaceCameraPose = {
  /** Unwrapped metres from the start; camera sampling wraps around the circuit. */
  distance: number;
  lateralOffset: number;
  /** Visual car.rotation.y in radians: forward is (sin(heading), cos(heading)). */
  heading: number;
  height?: number;
};
export type RaceCameraViewport = {
  /** Canvas CSS pixels, independent of the renderer's device pixel ratio. */
  width: number;
  height: number;
  insets: { top: number; right: number; bottom: number; left: number };
};
export type RaceCameraUpdate = {
  mode: 'overview' | 'chase';
  deltaSeconds: number;
  reset?: boolean;
};
export type RaceCamera = {
  camera: OrthographicCamera;
  readonly renderable: boolean;
  /** Refits synchronously, including when animation/simulation clocks are paused. */
  resize(viewport: RaceCameraViewport): boolean;
  /** True only when camera matrices or renderability change. */
  update(pose: RaceCameraPose, options: RaceCameraUpdate): boolean;
};

type RoadSection = {
  s: number;
  y: number;
  leftX: number;
  leftZ: number;
  rightX: number;
  rightZ: number;
};
type ProjectedBounds = {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  minDepth: number;
  maxDepth: number;
};
type CameraProjection = {
  anchorU: number;
  anchorV: number;
  scale: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  eyeDistance: number;
  far: number;
};
const projectionFields: readonly (keyof CameraProjection)[] = [
  'anchorU',
  'anchorV',
  'scale',
  'width',
  'height',
  'centerX',
  'centerY',
  'eyeDistance',
  'far',
];

const lookBehind = 5;
const lookAhead = 35;
const shoulder = 0.8;
const roadHeight = 0.08;
// Below a millionth of a CSS pixel there is no usable drawing area. This also
// prevents subnormal viewport numbers from underflowing the projection scale.
const minimumUsablePixels = 0.000001;
// Snap residual easing in screen space so unchanged idle scenes really settle.
const settlingPixels = 0.05;

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function emptyBounds(): ProjectedBounds {
  return {
    minU: Infinity,
    maxU: -Infinity,
    minV: Infinity,
    maxV: -Infinity,
    minDepth: Infinity,
    maxDepth: -Infinity,
  };
}

/** Essential framing only: no clock, input, preference or simulation ownership. */
export function createRaceCamera(track: Track): RaceCamera {
  validateTrack(track);
  const pitch = ((track.schemaVersion === 2 ? 40 : 15) * Math.PI) / 180;
  const cosine = Math.cos(pitch),
    sine = Math.sin(pitch);
  const maximumScale = track.schemaVersion === 2 ? 12 : 9;
  function addPoint(
    bounds: ProjectedBounds,
    x: number,
    y: number,
    z: number
  ): void {
    const v = -z * cosine + y * sine;
    const depth = y * cosine + z * sine;
    bounds.minU = Math.min(bounds.minU, x);
    bounds.maxU = Math.max(bounds.maxU, x);
    bounds.minV = Math.min(bounds.minV, v);
    bounds.maxV = Math.max(bounds.maxV, v);
    bounds.minDepth = Math.min(bounds.minDepth, depth);
    bounds.maxDepth = Math.max(bounds.maxDepth, depth);
  }

  function addSection(bounds: ProjectedBounds, section: RoadSection): void {
    addPoint(bounds, section.leftX, section.y, section.leftZ);
    addPoint(bounds, section.rightX, section.y, section.rightZ);
  }

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const sections: RoadSection[] = track.samples.map((sample) => ({
    s: sample.s,
    y: (sample.y ?? 0) + roadHeight,
    leftX: sample.x + sample.tz * (sample.width / 2 + shoulder),
    leftZ: sample.z - sample.tx * (sample.width / 2 + shoulder),
    rightX: sample.x - sample.tz * (sample.width / 2 + shoulder),
    rightZ: sample.z + sample.tx * (sample.width / 2 + shoulder),
  }));
  const overview = emptyBounds();
  for (const section of sections) addSection(overview, section);
  const start = sampleTrack(track, track.startS);
  let pose: RaceCameraPose = {
    distance: 0,
    lateralOffset: 0,
    heading: Math.atan2(start.tx, start.tz),
  };
  let mode: RaceCameraUpdate['mode'] = 'overview';
  let viewport: RaceCameraViewport = {
    width: 0,
    height: 0,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  let renderable = false;
  let initialized = false;
  let pendingReset = false;
  let anchorU = 0;
  let anchorV = 0;
  let scale = 1;
  let previousProjection: CameraProjection | undefined;

  function wrap(distance: number): number {
    const wrapped =
      ((distance % track.totalLength) + track.totalLength) % track.totalLength;
    return wrapped < 1e-9 || track.totalLength - wrapped < 1e-9 ? 0 : wrapped;
  }

  /** Index of the section at/before s, in O(log n). */
  function sectionIndex(s: number): number {
    let low = 0;
    let high = sections.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      const sample = sections[middle];
      if (!sample) throw new Error('Missing camera road section');
      if (sample.s <= s) low = middle;
      else high = middle;
    }
    return low;
  }

  function addCut(bounds: ProjectedBounds, distance: number): void {
    const s = wrap(distance);
    const index = sectionIndex(s);
    const current = sections[index];
    const next = sections[(index + 1) % sections.length];
    if (!current || !next) throw new Error('Missing camera road section');
    const end = index + 1 === sections.length ? track.totalLength : next.s;
    const blend = (s - current.s) / (end - current.s);
    // Interpolate the actual rendered shoulder edges, rather than offsetting an
    // interpolated unit normal, which would bow away from the linear strip.
    addPoint(
      bounds,
      current.leftX + (next.leftX - current.leftX) * blend,
      current.y + (next.y - current.y) * blend,
      current.leftZ + (next.leftZ - current.leftZ) * blend
    );
    addPoint(
      bounds,
      current.rightX + (next.rightX - current.rightX) * blend,
      current.y + (next.y - current.y) * blend,
      current.rightZ + (next.rightZ - current.rightZ) * blend
    );
  }

  function requiredBounds(): ProjectedBounds {
    let bounds: ProjectedBounds;
    if (mode === 'overview' || track.totalLength <= lookBehind + lookAhead) {
      bounds = { ...overview };
    } else {
      bounds = emptyBounds();
      const from = wrap(pose.distance + track.startS - lookBehind);
      const to = from + lookBehind + lookAhead;
      addCut(bounds, from);
      addCut(bounds, to);
      let index = sectionIndex(from) + 1;
      // At most one lap is visited, even for short tracks or seam-crossing views.
      for (let visited = 0; visited < sections.length; visited++, index++) {
        const sample = sections[index % sections.length];
        if (!sample) throw new Error('Missing camera road section');
        const unwrapped =
          sample.s + (index >= sections.length ? track.totalLength : 0);
        if (unwrapped >= to) break;
        addSection(bounds, sample);
      }
    }
    const frame = sampleTrack(track, track.startS + pose.distance);
    const centerX = frame.x + frame.nx * pose.lateralOffset;
    const centerZ = frame.z + frame.nz * pose.lateralOffset;
    const forwardX = Math.sin(pose.heading);
    const forwardZ = Math.cos(pose.heading);
    for (const fore of [-2, 2]) {
      for (const side of [-1.1, 1.1]) {
        for (const height of [0, 1.8]) {
          addPoint(
            bounds,
            centerX + forwardX * fore - forwardZ * side,
            height + (pose.height ?? 0),
            centerZ + forwardZ * fore + forwardX * side
          );
        }
      }
    }
    return bounds;
  }

  function applyProjection(bounds: ProjectedBounds): boolean {
    const { width, height, insets } = viewport;
    const centerX = insets.left + (width - insets.left - insets.right) / 2;
    const centerY = insets.top + (height - insets.top - insets.bottom) / 2;
    const anchorZ = -anchorV / cosine;
    const anchorDepth = anchorZ * sine;
    // Keep the depth envelope in front of the near plane even in large overviews.
    const eyeDistance = Math.max(
      72 / cosine,
      bounds.maxDepth - anchorDepth + 2
    );
    const far = Math.max(400, eyeDistance + anchorDepth - bounds.minDepth + 10);
    const projection: CameraProjection = {
      anchorU,
      anchorV,
      scale,
      width,
      height,
      centerX,
      centerY,
      eyeDistance,
      far,
    };
    const previous = previousProjection;
    if (
      previous &&
      projectionFields.every((key) => projection[key] === previous[key])
    ) {
      return false;
    }
    camera.left = -centerX / scale;
    camera.right = (width - centerX) / scale;
    camera.top = centerY / scale;
    camera.bottom = -(height - centerY) / scale;
    camera.far = far;
    camera.position.set(
      anchorU,
      eyeDistance * cosine,
      anchorZ + eyeDistance * sine
    );
    camera.lookAt(anchorU, 0, anchorZ);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    previousProjection = projection;
    return true;
  }

  function fit(deltaSeconds: number, reset: boolean, resize: boolean): boolean {
    if (!renderable) return false;
    const bounds = requiredBounds();
    const targetU = (bounds.minU + bounds.maxU) / 2;
    const targetV = (bounds.minV + bounds.maxV) / 2;
    const snap = reset || pendingReset || !initialized;
    const shortLandscape = viewport.width > viewport.height;
    // Long-gap race handling belongs to the caller; only visual easing is bounded.
    const elapsed = Math.min(deltaSeconds, 0.1);
    if (snap) {
      anchorU = targetU;
      anchorV = targetV;
    } else if (elapsed > 0) {
      const blend = 1 - Math.exp(-elapsed / (shortLandscape ? 0.08 : 0.14));
      anchorU += (targetU - anchorU) * blend;
      anchorV += (targetV - anchorV) * blend;
      if (
        Math.hypot(targetU - anchorU, targetV - anchorV) * scale <
        settlingPixels
      ) {
        anchorU = targetU;
        anchorV = targetV;
      }
    }
    const radiusU = Math.max(
      Math.abs(bounds.minU - anchorU),
      Math.abs(bounds.maxU - anchorU)
    );
    const radiusV = Math.max(
      Math.abs(bounds.minV - anchorV),
      Math.abs(bounds.maxV - anchorV)
    );
    const margin = shortLandscape ? 1.1 : 1.12;
    const halfWidth =
      (viewport.width - viewport.insets.left - viewport.insets.right) / 2;
    const halfHeight =
      (viewport.height - viewport.insets.top - viewport.insets.bottom) / 2;
    const requiredScale = Math.min(
      halfWidth / (radiusU * margin),
      halfHeight / (radiusV * margin),
      maximumScale
    );
    if (snap || resize || requiredScale < scale) scale = requiredScale;
    else if (elapsed > 0) {
      scale += (requiredScale - scale) * (1 - Math.exp(-elapsed / 0.8));
      if (
        (requiredScale - scale) * Math.max(radiusU, radiusV) <
        settlingPixels
      ) {
        scale = requiredScale;
      }
    }
    // Safety always wins over easing, including after an abrupt off-road pose.
    scale = Math.min(scale, requiredScale);
    pendingReset = false;
    initialized = true;
    return applyProjection(bounds);
  }

  return {
    camera,
    get renderable(): boolean {
      return renderable;
    },
    resize(next: RaceCameraViewport): boolean {
      for (const [name, value] of Object.entries({
        width: next.width,
        height: next.height,
        ...next.insets,
      })) {
        finite(value, `Camera ${name}`);
        if (value < 0) throw new Error(`Camera ${name} must be nonnegative`);
      }
      const previouslyRenderable = renderable;
      viewport = { ...next, insets: { ...next.insets } };
      renderable =
        next.width - next.insets.left - next.insets.right >
          minimumUsablePixels &&
        next.height - next.insets.top - next.insets.bottom >
          minimumUsablePixels;
      const changed = fit(0, !previouslyRenderable, true);
      return changed || previouslyRenderable !== renderable;
    },
    update(next: RaceCameraPose, options: RaceCameraUpdate): boolean {
      finite(next.distance, 'Camera distance');
      finite(next.lateralOffset, 'Camera lateral offset');
      finite(next.heading, 'Camera heading');
      finite(next.height ?? 0, 'Camera height');
      finite(options.deltaSeconds, 'Camera elapsed time');
      if (options.deltaSeconds < 0)
        throw new Error('Camera elapsed time must be nonnegative');
      if (options.mode !== 'overview' && options.mode !== 'chase')
        throw new Error('Invalid camera mode');
      pendingReset ||= options.reset === true || options.mode !== mode;
      pose = { ...next };
      mode = options.mode;
      return fit(options.deltaSeconds, false, false);
    },
  };
}
