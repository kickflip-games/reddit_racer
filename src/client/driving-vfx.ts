import * as THREE from 'three';
import { SIMULATION_HZ, type SimulationState } from '../shared/simulation';
import type { RacePhase } from '../shared/race-rules';
import type { Track } from '../shared/track';

export const DRIVING_VFX_LIMITS = Object.freeze({
  speedStreaks: 8,
  smokeParticles: 48,
  dustParticles: 48,
  skidQuads: 384,
  particleBirthsPerSecond: 32,
  particleBirthsPerUpdate: 4,
  skidSamplesPerSecondPerWheel: 30,
  maximumTickGap: 24,
  maximumSkidLength: 1.5,
  minimumSkidSpacing: 0.35,
  skidLifetimeSeconds: 6,
});
type ContactPoint = Readonly<{ x: number; y: number; z: number }>;
export type DrivingVfxFrame = {
  state: Readonly<SimulationState>;
  phase: RacePhase;
  held: boolean;
  acceleration: number;
  rearLeft: ContactPoint;
  rearRight: ContactPoint;
  deltaSeconds: number;
  cssPixelsPerMetre: number;
  reducedMotion: boolean;
};
export type DrivingVfx = {
  object: THREE.Group;
  update(frame: Readonly<DrivingVfxFrame>): boolean;
  reset(): void;
  dispose(): void;
};
type ParticlePool = {
  object: THREE.Points;
  update(deltaSeconds: number): void;
  emit(x: number, y: number, z: number, driftX: number, driftZ: number): void;
  flush(): boolean;
  reset(): void;
  dispose(): void;
};
const skidHeight = 0.043;
const skidHalfWidth = 0.09;
const roadMargin = 0.06;
const epsilon = 1e-9;

function cross(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number
): number {
  return (bx - ax) * (pz - az) - (bz - az) * (px - ax);
}
function inTriangle(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number
): boolean {
  const a = cross(ax, az, bx, bz, px, pz);
  const b = cross(bx, bz, cx, cz, px, pz);
  const c = cross(cx, cz, ax, az, px, pz);
  return !(
    (a < -epsilon || b < -epsilon || c < -epsilon) &&
    (a > epsilon || b > epsilon || c > epsilon)
  );
}
function intersect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number
): boolean {
  if (
    Math.max(ax, bx) < Math.min(cx, dx) - epsilon ||
    Math.max(cx, dx) < Math.min(ax, bx) - epsilon ||
    Math.max(az, bz) < Math.min(cz, dz) - epsilon ||
    Math.max(cz, dz) < Math.min(az, bz) - epsilon
  )
    return false;
  const a = cross(ax, az, bx, bz, cx, cz),
    b = cross(ax, az, bx, bz, dx, dz);
  const c = cross(cx, cz, dx, dz, ax, az),
    d = cross(cx, cz, dx, dz, bx, bz);
  return a * b <= epsilon && c * d <= epsilon;
}

/** Exact canonical cross-sections, including the closing segment. No visual mesh queries. */
function createRoadContainment(track: Track): (quad: Float64Array) => boolean {
  const sections = track.samples.map((sample, index) => {
    const next = track.samples[(index + 1) % track.samples.length];
    if (!next) throw new Error('Cannot create effects for an empty track');
    const halfA = Math.max(0, sample.width / 2 - roadMargin);
    const halfB = Math.max(0, next.width / 2 - roadMargin);
    const ax = sample.x + sample.tz * halfA,
      az = sample.z - sample.tx * halfA;
    const bx = sample.x - sample.tz * halfA,
      bz = sample.z + sample.tx * halfA;
    const cx = next.x + next.tz * halfB,
      cz = next.z - next.tx * halfB;
    const dx = next.x - next.tz * halfB,
      dz = next.z + next.tx * halfB;
    return {
      ax,
      az,
      bx,
      bz,
      cx,
      cz,
      dx,
      dz,
      minX: Math.min(ax, bx, cx, dx),
      maxX: Math.max(ax, bx, cx, dx),
      minZ: Math.min(az, bz, cz, dz),
      maxZ: Math.max(az, bz, cz, dz),
    };
  });
  function contains(x: number, z: number): boolean {
    for (const s of sections) {
      if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
      if (
        inTriangle(x, z, s.ax, s.az, s.bx, s.bz, s.cx, s.cz) ||
        inTriangle(x, z, s.bx, s.bz, s.dx, s.dz, s.cx, s.cz)
      )
        return true;
    }
    return false;
  }
  return (q) => {
    const ax = q[0],
      az = q[1],
      bx = q[2],
      bz = q[3],
      cx = q[4],
      cz = q[5],
      dx = q[6],
      dz = q[7];
    if (
      ax === undefined ||
      az === undefined ||
      bx === undefined ||
      bz === undefined ||
      cx === undefined ||
      cz === undefined ||
      dx === undefined ||
      dz === undefined
    )
      return false;
    if (
      !contains(ax, az) ||
      !contains(bx, bz) ||
      !contains(cx, cz) ||
      !contains(dx, dz) ||
      !contains((ax + bx + cx + dx) / 4, (az + bz + cz + dz) / 4)
    )
      return false;
    const minX = Math.min(ax, bx, cx, dx),
      maxX = Math.max(ax, bx, cx, dx),
      minZ = Math.min(az, bz, cz, dz),
      maxZ = Math.max(az, bz, cz, dz);
    // All corners being inside does not rule out crossing a concave road boundary.
    // Reject every boundary crossing (and a boundary enclosed by this small quad).
    for (const s of sections) {
      if (s.maxX < minX || s.minX > maxX || s.maxZ < minZ || s.minZ > maxZ)
        continue;
      for (let side = 0; side < 2; side++) {
        const ex = side === 0 ? s.ax : s.bx,
          ez = side === 0 ? s.az : s.bz;
        const fx = side === 0 ? s.cx : s.dx,
          fz = side === 0 ? s.cz : s.dz;
        if (
          inTriangle(ex, ez, ax, az, bx, bz, cx, cz) ||
          inTriangle(ex, ez, bx, bz, dx, dz, cx, cz)
        )
          return false;
        if (
          intersect(ax, az, bx, bz, ex, ez, fx, fz) ||
          intersect(bx, bz, dx, dz, ex, ez, fx, fz) ||
          intersect(dx, dz, cx, cz, ex, ez, fx, fz) ||
          intersect(cx, cz, ax, az, ex, ez, fx, fz)
        )
          return false;
      }
    }
    return true;
  };
}

function particleMask(): THREE.DataTexture {
  const size = 16,
    data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const nx = Math.abs(((x + 0.5) / size) * 2 - 1),
        ny = Math.abs(((y + 0.5) / size) * 2 - 1);
      const edge = Math.min(0.87 - nx, 0.96 - ny - nx * 0.55);
      const index = (y * size + x) * 4;
      data[index] = 255;
      data[index + 1] = 255;
      data[index + 2] = 255;
      data[index + 3] = Math.round(
        THREE.MathUtils.clamp(edge * 14, 0, 1) * 255
      );
    }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createParticlePool(
  name: string,
  capacity: number,
  mask: THREE.Texture,
  color: string,
  lifetime: number,
  opacity: number,
  random: () => number
): ParticlePool {
  const positions = new Float32Array(capacity * 3),
    colors = new Float32Array(capacity * 4);
  const velocities = new Float32Array(capacity * 3),
    remaining = new Float32Array(capacity);
  const tint = new THREE.Color(color);
  for (let i = 0; i < capacity; i++) {
    colors[i * 4] = tint.r;
    colors[i * 4 + 1] = tint.g;
    colors[i * 4 + 2] = tint.b;
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3).setUsage(
    THREE.DynamicDrawUsage
  );
  const colorAttribute = new THREE.BufferAttribute(colors, 4).setUsage(
    THREE.DynamicDrawUsage
  );
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', colorAttribute);
  geometry.setDrawRange(0, 0);
  const material = new THREE.PointsMaterial({
    map: mask,
    size: 6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const object = new THREE.Points(geometry, material);
  object.name = name;
  object.frustumCulled = false;
  object.renderOrder = 2;
  let count = 0,
    overwrite = 0,
    dirty = false;
  return {
    object,
    update(delta) {
      if (count === 0 || delta === 0) return;
      for (let i = 0; i < count;) {
        const life = (remaining[i] ?? 0) - delta;
        if (life <= 0) {
          dirty = true;
          count--;
          for (let axis = 0; axis < 3; axis++) {
            positions[i * 3 + axis] = positions[count * 3 + axis] ?? 0;
            velocities[i * 3 + axis] = velocities[count * 3 + axis] ?? 0;
          }
          remaining[i] = remaining[count] ?? 0;
          colors[i * 4 + 3] = colors[count * 4 + 3] ?? 0;
          colors[count * 4 + 3] = 0;
          continue;
        }
        remaining[i] = life;
        for (let axis = 0; axis < 3; axis++) {
          const index = i * 3 + axis;
          const before = positions[index];
          positions[index] =
            (positions[index] ?? 0) + (velocities[index] ?? 0) * delta;
          if (positions[index] !== before) dirty = true;
        }
        const beforeAlpha = colors[i * 4 + 3];
        colors[i * 4 + 3] = opacity * (life / lifetime) ** 2;
        if (colors[i * 4 + 3] !== beforeAlpha) dirty = true;
        i++;
      }
    },
    emit(x, y, z, driftX, driftZ) {
      const slot = count < capacity ? count++ : overwrite++ % capacity;
      positions[slot * 3] = x;
      positions[slot * 3 + 1] = y + 0.03;
      positions[slot * 3 + 2] = z;
      velocities[slot * 3] = driftX + (random() - 0.5) * 0.8;
      velocities[slot * 3 + 1] = 0.3 + random() * 0.7;
      velocities[slot * 3 + 2] = driftZ + (random() - 0.5) * 0.8;
      remaining[slot] = lifetime;
      colors[slot * 4 + 3] = opacity;
      dirty = true;
    },
    flush() {
      if (!dirty) return false;
      geometry.setDrawRange(0, count);
      position.clearUpdateRanges();
      colorAttribute.clearUpdateRanges();
      if (count > 0) {
        position.addUpdateRange(0, count * 3);
        colorAttribute.addUpdateRange(0, count * 4);
      }
      position.needsUpdate = true;
      colorAttribute.needsUpdate = true;
      dirty = false;
      return true;
    },
    reset() {
      count = 0;
      overwrite = 0;
      remaining.fill(0);
      for (let i = 0; i < capacity; i++) colors[i * 4 + 3] = 0;
      geometry.setDrawRange(0, 0);
      position.clearUpdateRanges();
      colorAttribute.clearUpdateRanges();
      position.needsUpdate = true;
      colorAttribute.needsUpdate = true;
      dirty = false;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Eight small world-space ribbons alongside the car, never a full-screen overlay. */
function createSpeedStreaks() {
  const count = DRIVING_VFX_LIMITS.speedStreaks;
  const positions = new Float32Array(count * 12);
  const colors = new Float32Array(count * 16);
  const indices = new Uint16Array(count * 6);
  const tint = new THREE.Color('#e3ffe8');
  for (let i = 0; i < count; i++) {
    const v = i * 4;
    indices.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    for (let j = 0; j < 4; j++) {
      colors[i * 16 + j * 4] = tint.r;
      colors[i * 16 + j * 4 + 1] = tint.g;
      colors[i * 16 + j * 4 + 2] = tint.b;
    }
  }
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3).setUsage(
    THREE.DynamicDrawUsage
  );
  const color = new THREE.BufferAttribute(colors, 4).setUsage(
    THREE.DynamicDrawUsage
  );
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', color);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(geometry, material);
  material.forceSinglePass = true;
  object.name = 'car-speed-streaks';
  object.visible = false;
  object.frustumCulled = false;
  let tick = -1;
  const reset = (): boolean => {
    tick = -1;
    const visible = geometry.drawRange.count > 0;
    object.visible = false;
    geometry.setDrawRange(0, 0);
    return visible;
  };
  return {
    object,
    reset,
    update(frame: Readonly<DrivingVfxFrame>): boolean {
      const state = frame.state;
      if (
        frame.reducedMotion ||
        frame.phase !== 'racing' ||
        state.status !== 'running' ||
        state.recovering ||
        state.recoveryTicksRemaining > 0 ||
        state.speed <= 18 ||
        !Number.isFinite(
          state.speed +
            frame.rearLeft.x +
            frame.rearLeft.y +
            frame.rearLeft.z +
            frame.rearRight.x +
            frame.rearRight.y +
            frame.rearRight.z
        ) ||
        !Number.isSafeInteger(state.tick) ||
        state.tick < 0
      )
        return reset();
      if (tick === state.tick) return false;
      tick = state.tick;
      const nx = frame.rearLeft.x - frame.rearRight.x;
      const nz = frame.rearLeft.z - frame.rearRight.z;
      const width = Math.hypot(nx, nz);
      if (width < 0.001) return reset();
      const sideX = nx / width,
        sideZ = nz / width;
      const forwardX = -sideZ,
        forwardZ = sideX;
      const cx = (frame.rearLeft.x + frame.rearRight.x) / 2;
      const cy = (frame.rearLeft.y + frame.rearRight.y) / 2;
      const cz = (frame.rearLeft.z + frame.rearRight.z) / 2;
      const strength = THREE.MathUtils.clamp((state.speed - 18) / 10, 0, 1);
      for (let i = 0; i < count; i++) {
        const phase = ((state.tick / SIMULATION_HZ) * 1.8 + i * 0.618) % 1;
        const side = (i % 2 ? -1 : 1) * (width / 2 + 0.35 + (i % 3) * 0.3);
        const back = 0.3 + phase * 3.5;
        const length = 0.65 + strength * 1.9;
        const fade = Math.sin(phase * Math.PI) * strength * 0.55;
        for (let corner = 0; corner < 4; corner++) {
          const along = -back - (corner < 2 ? 0 : length);
          const across = side + (corner % 2 ? 1 : -1) * 0.055;
          const offset = i * 12 + corner * 3;
          positions[offset] = cx + forwardX * along + sideX * across;
          positions[offset + 1] = cy + 0.32 + (i % 3) * 0.18;
          positions[offset + 2] = cz + forwardZ * along + sideZ * across;
          colors[i * 16 + corner * 4 + 3] = corner < 2 ? fade : 0;
        }
      }
      object.visible = true;
      geometry.setDrawRange(0, count * 6);
      position.clearUpdateRanges();
      color.clearUpdateRanges();
      position.addUpdateRange(0, positions.length);
      color.addUpdateRange(0, colors.length);
      position.needsUpdate = true;
      color.needsUpdate = true;
      return true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createDrivingVfx(
  track: Track,
  options: { noiseSeed?: number; followContactHeight?: boolean } = {}
): DrivingVfx {
  if (track.samples.length < 8 || track.samples.length > 16_384)
    throw new Error('Effects require a bounded canonical track');
  const object = new THREE.Group();
  object.name = 'driving-effects';
  let seed = options.noiseSeed ?? 0x6d2b79f5;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError('Visual noise seed must be an unsigned integer');
  const initialSeed = seed || 0x6d2b79f5;
  seed = initialSeed;
  const random = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  const speedStreaks = createSpeedStreaks();
  const mask = particleMask();
  const smoke = createParticlePool(
    'tyre-smoke',
    DRIVING_VFX_LIMITS.smokeParticles,
    mask,
    '#d9ddcb',
    0.85,
    0.32,
    random
  );
  const dust = createParticlePool(
    'offroad-dust',
    DRIVING_VFX_LIMITS.dustParticles,
    mask,
    '#c3ac7e',
    0.6,
    0.32,
    random
  );
  const particleSizes: readonly [ParticlePool, number, number, number][] = [
    [smoke, 0.9, 2.5, 12],
    [dust, 0.65, 2, 9],
  ];
  const positions = new Float32Array(DRIVING_VFX_LIMITS.skidQuads * 12),
    colors = new Float32Array(DRIVING_VFX_LIMITS.skidQuads * 16);
  const indices = new Uint16Array(DRIVING_VFX_LIMITS.skidQuads * 6),
    lives = new Float32Array(DRIVING_VFX_LIMITS.skidQuads);
  const tint = new THREE.Color('#20362c');
  for (let slot = 0; slot < DRIVING_VFX_LIMITS.skidQuads; slot++) {
    const vertex = slot * 4,
      index = slot * 6;
    indices.set(
      [vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2],
      index
    );
    for (let corner = 0; corner < 4; corner++) {
      colors[slot * 16 + corner * 4] = tint.r;
      colors[slot * 16 + corner * 4 + 1] = tint.g;
      colors[slot * 16 + corner * 4 + 2] = tint.b;
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(
      THREE.DynamicDrawUsage
    ),
    colorAttribute = new THREE.BufferAttribute(colors, 4).setUsage(
      THREE.DynamicDrawUsage
    );
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', colorAttribute);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const skids = new THREE.Mesh(geometry, material);
  skids.name = 'tyre-skids';
  skids.frustumCulled = false;
  skids.renderOrder = 1;
  object.add(skids, smoke.object, dust.object, speedStreaks.object);
  const onRoad = createRoadContainment(track),
    quad = new Float64Array(8);
  const previous = new Float64Array(6),
    trail = new Float64Array(6);
  const trailValid = [false, false];
  let lastTick: number | undefined,
    lastDistance = 0,
    lastLateral = 0,
    lastRecoveryCount = 0;
  let birthCredit = 0,
    skidCredit = 0,
    nextWheel = 0,
    cursor = 0,
    written = 0,
    liveSkids = 0;
  let disposed = false,
    reduced = false,
    positionDirty = false,
    colorDirty = false,
    pendingChanged = false;
  function breakHistory(): void {
    lastTick = undefined;
    birthCredit = 0;
    skidCredit = 0;
    trailValid[0] = false;
    trailValid[1] = false;
  }
  function baseline(frame: Readonly<DrivingVfxFrame>): void {
    previous[0] = frame.rearLeft.x;
    previous[1] = frame.rearLeft.y;
    previous[2] = frame.rearLeft.z;
    previous[3] = frame.rearRight.x;
    previous[4] = frame.rearRight.y;
    previous[5] = frame.rearRight.z;
    lastTick = frame.state.tick;
    lastDistance = frame.state.distance;
    lastLateral = frame.state.lateralOffset;
    lastRecoveryCount = frame.state.recoveryCount;
  }
  function flush(): boolean {
    const smokeChanged = smoke.flush(),
      dustChanged = dust.flush();
    let changed = pendingChanged || smokeChanged || dustChanged;
    pendingChanged = false;
    if (positionDirty) {
      changed = true;
      positionAttribute.clearUpdateRanges();
      positionAttribute.addUpdateRange(0, written * 12);
      positionAttribute.needsUpdate = true;
      positionDirty = false;
    }
    if (colorDirty) {
      changed = true;
      colorAttribute.clearUpdateRanges();
      colorAttribute.addUpdateRange(0, written * 16);
      colorAttribute.needsUpdate = true;
      colorDirty = false;
    }
    const drawCount = liveSkids > 0 ? written * 6 : 0;
    if (geometry.drawRange.count !== drawCount) {
      geometry.setDrawRange(0, drawCount);
      changed = true;
    }
    return changed;
  }
  let lastLandings: number | undefined;
  function reset(): void {
    lastLandings = undefined;
    if (disposed) return;
    pendingChanged = true;
    speedStreaks.reset();
    smoke.reset();
    dust.reset();
    lives.fill(0);
    for (let slot = 0; slot < DRIVING_VFX_LIMITS.skidQuads; slot++)
      for (let corner = 0; corner < 4; corner++)
        colors[slot * 16 + corner * 4 + 3] = 0;
    cursor = 0;
    written = 0;
    liveSkids = 0;
    nextWheel = 0;
    seed = initialSeed;
    reduced = false;
    positionAttribute.clearUpdateRanges();
    colorAttribute.clearUpdateRanges();
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
    geometry.setDrawRange(0, 0);
    positionDirty = false;
    colorDirty = false;
    breakHistory();
  }
  function addSkid(wheel: number, point: ContactPoint): void {
    const offset = wheel * 3,
      ay = trail[offset + 1] ?? point.y,
      ax = trail[offset] ?? point.x,
      az = trail[offset + 2] ?? point.z;
    const dx = point.x - ax,
      dz = point.z - az,
      length = Math.hypot(dx, dz);
    if (!trailValid[wheel] || length > DRIVING_VFX_LIMITS.maximumSkidLength) {
      trail[offset] = point.x;
      trail[offset + 1] = point.y;
      trail[offset + 2] = point.z;
      trailValid[wheel] = true;
      return;
    }
    if (length < DRIVING_VFX_LIMITS.minimumSkidSpacing) return;
    const nx = (-dz / length) * skidHalfWidth,
      nz = (dx / length) * skidHalfWidth;
    quad[0] = ax - nx;
    quad[1] = az - nz;
    quad[2] = ax + nx;
    quad[3] = az + nz;
    quad[4] = point.x - nx;
    quad[5] = point.z - nz;
    quad[6] = point.x + nx;
    quad[7] = point.z + nz;
    trail[offset] = point.x;
    trail[offset + 1] = point.y;
    trail[offset + 2] = point.z;
    if (!onRoad(quad)) {
      trailValid[wheel] = false;
      return;
    }
    const slot = cursor;
    cursor = (cursor + 1) % DRIVING_VFX_LIMITS.skidQuads;
    if ((lives[slot] ?? 0) <= 0) liveSkids++;
    lives[slot] = DRIVING_VFX_LIMITS.skidLifetimeSeconds;
    written = Math.max(written, slot + 1);
    for (let corner = 0; corner < 4; corner++) {
      positions[slot * 12 + corner * 3] = quad[corner * 2] ?? 0;
      positions[slot * 12 + corner * 3 + 1] =
        options.followContactHeight || track.schemaVersion === 2
          ? (corner < 2 ? ay : point.y) - 0.002
          : skidHeight;
      positions[slot * 12 + corner * 3 + 2] = quad[corner * 2 + 1] ?? 0;
      colors[slot * 16 + corner * 4 + 3] = 0.52;
    }
    positionDirty = true;
    colorDirty = true;
  }
  return {
    object,
    update(frame) {
      if (disposed) return false;
      if (frame.reducedMotion) {
        if (!reduced) reset();
        reduced = true;
        return flush();
      }
      if (reduced) {
        reduced = false;
        breakHistory();
      }
      pendingChanged = speedStreaks.update(frame) || pendingChanged;
      const delta = Number.isFinite(frame.deltaSeconds)
        ? THREE.MathUtils.clamp(frame.deltaSeconds, 0, 0.05)
        : 0;
      smoke.update(delta);
      dust.update(delta);
      if (liveSkids > 0 && delta > 0)
        for (let slot = 0; slot < written; slot++) {
          const beforeLife = lives[slot] ?? 0;
          if (beforeLife <= 0) continue;
          lives[slot] = Math.max(0, beforeLife - delta);
          if (lives[slot] === beforeLife) continue;
          if ((lives[slot] ?? 0) === 0) liveSkids--;
          for (let corner = 0; corner < 4; corner++)
            colors[slot * 16 + corner * 4 + 3] =
              (0.52 * (lives[slot] ?? 0)) /
              DRIVING_VFX_LIMITS.skidLifetimeSeconds;
          colorDirty = true;
        }
      const state = frame.state;
      const landings = state.vertical?.landings ?? 0;
      if (
        lastLandings !== undefined &&
        landings > lastLandings &&
        frame.phase === 'racing' &&
        !state.vertical?.airborne &&
        !state.recovering
      ) {
        const impact = THREE.MathUtils.clamp(state.vertical?.impact ?? 0, 0, 1);
        const births = 6 + Math.floor(impact * 6);
        for (let i = 0; i < births; i++) {
          const contact = i % 2 === 0 ? frame.rearLeft : frame.rearRight;
          dust.emit(
            contact.x,
            contact.y,
            contact.z,
            Math.cos((i / births) * Math.PI * 2) * (0.6 + impact * 1.2),
            Math.sin((i / births) * Math.PI * 2) * (0.6 + impact * 1.2)
          );
        }
      }
      lastLandings = landings;
      const finite = Number.isFinite(
        state.distance +
          state.speed +
          state.slip +
          state.lateralOffset +
          frame.rearLeft.x +
          frame.rearLeft.y +
          frame.rearLeft.z +
          frame.rearRight.x +
          frame.rearRight.y +
          frame.rearRight.z +
          frame.cssPixelsPerMetre
      );
      if (!finite || !Number.isSafeInteger(state.tick) || state.tick < 0) {
        breakHistory();
        return flush();
      }
      for (const [pool, scale, minimum, maximum] of particleSizes) {
        const material = pool.object.material;
        const size = THREE.MathUtils.clamp(
          frame.cssPixelsPerMetre * scale,
          minimum,
          maximum
        );
        if (
          material instanceof THREE.PointsMaterial &&
          material.size !== size
        ) {
          material.size = size;
          if (pool.object.geometry.drawRange.count > 0) pendingChanged = true;
        }
      }
      if (
        frame.phase !== 'racing' ||
        state.vertical?.airborne === true ||
        state.recovering ||
        state.recoveryTicksRemaining > 0
      ) {
        breakHistory();
        return flush();
      }
      if (lastTick === undefined) {
        baseline(frame);
        return flush();
      }
      const ticks = state.tick - lastTick;
      if (ticks === 0) {
        return flush();
      }
      const progress = state.distance - lastDistance,
        lateral = Math.abs(state.lateralOffset - lastLateral);
      const leftMove = Math.hypot(
        frame.rearLeft.x - (previous[0] ?? frame.rearLeft.x),
        frame.rearLeft.z - (previous[2] ?? frame.rearLeft.z)
      );
      const rightMove = Math.hypot(
        frame.rearRight.x - (previous[3] ?? frame.rearRight.x),
        frame.rearRight.z - (previous[5] ?? frame.rearRight.z)
      );
      if (
        ticks < 0 ||
        ticks > DRIVING_VFX_LIMITS.maximumTickGap ||
        progress < 0 ||
        progress >
          Math.max(1, ((state.speed * ticks) / SIMULATION_HZ) * 2 + 0.75) ||
        state.recoveryCount !== lastRecoveryCount ||
        Math.max(leftMove, rightMove) >
          Math.max(1.5, (progress + lateral) * 1.75 + 0.5)
      ) {
        breakHistory();
        baseline(frame);
        return flush();
      }
      const moving =
        state.speed > 2 && progress > 0 && leftMove + rightMove > 0.004;
      const dusty = moving && state.offRoad,
        smoky = moving && !state.offRoad && state.slip > 0.12;
      if (dusty || smoky) {
        birthCredit += ticks * DRIVING_VFX_LIMITS.particleBirthsPerSecond;
        const births = Math.min(
          DRIVING_VFX_LIMITS.particleBirthsPerUpdate,
          Math.floor(birthCredit / SIMULATION_HZ)
        );
        birthCredit %= SIMULATION_HZ;
        for (let birth = 0; birth < births; birth++) {
          const wheel = nextWheel++ % 2,
            offset = wheel * 3,
            contact = wheel === 0 ? frame.rearLeft : frame.rearRight;
          const fraction = (birth + 1) / births;
          const x = THREE.MathUtils.lerp(
              previous[offset] ?? contact.x,
              contact.x,
              fraction
            ),
            y = THREE.MathUtils.lerp(
              previous[offset + 1] ?? contact.y,
              contact.y,
              fraction
            ),
            z = THREE.MathUtils.lerp(
              previous[offset + 2] ?? contact.z,
              contact.z,
              fraction
            );
          const seconds = ticks / SIMULATION_HZ;
          (dusty ? dust : smoke).emit(
            x,
            y,
            z,
            (-(contact.x - (previous[offset] ?? contact.x)) / seconds) * 0.04,
            (-(contact.z - (previous[offset + 2] ?? contact.z)) / seconds) *
              0.04
          );
        }
      } else birthCredit = 0;
      if (moving && !state.offRoad && state.slip > 0.18 && state.speed > 4) {
        skidCredit += ticks * DRIVING_VFX_LIMITS.skidSamplesPerSecondPerWheel;
        if (skidCredit >= SIMULATION_HZ) {
          skidCredit %= SIMULATION_HZ;
          addSkid(0, frame.rearLeft);
          addSkid(1, frame.rearRight);
        }
      } else {
        skidCredit = 0;
        trailValid[0] = false;
        trailValid[1] = false;
      }
      baseline(frame);
      return flush();
    },
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      object.removeFromParent();
      object.clear();
      speedStreaks.dispose();
      smoke.dispose();
      dust.dispose();
      geometry.dispose();
      material.dispose();
      mask.dispose();
    },
  };
}
