import { gripSurfaceAt, type GripZone } from '../shared/slot-grip';
import { createGripMarkers } from './grip-markers';
import { jumpRoadHeight, type GapJump } from '../shared/stunt-course';
import * as THREE from 'three';
import { roadPointAt, sampleTrack, type Track } from '../shared/track';

export type StripEdge = { side: -1 | 1; offset: number };
export type TrackBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

/** The same sample cross-sections define both the road surface and shared bounds. */
export function buildRoadStripVertices(
  track: Track,
  inner: StripEdge,
  outer: StripEdge,
  elevation: number,
  jumps: readonly GapJump[] = [],
  zones: readonly GripZone[] = []
): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= track.samples.length; index++) {
    const sample = track.samples[index % track.samples.length];
    if (!sample) throw new Error('Cannot render an empty track');
    for (const edge of [inner, outer]) {
      const lateral = (sample.width / 2) * edge.side + edge.offset;
      positions.push(
        sample.x - sample.tz * lateral,
        elevation +
          jumpRoadHeight(jumps, sample.s) -
          lateral * Math.tan(gripSurfaceAt(track, zones, sample.s).bank),
        sample.z + sample.tx * lateral
      );
    }
    const next = track.samples[(index + 1) % track.samples.length];
    const endS =
      index + 1 === track.samples.length
        ? track.totalLength
        : (next?.s ?? track.totalLength);
    const gap = jumps.some(
      (jump) =>
        sample.s >= jump.takeoff - 0.00001 && endS <= jump.landing + 0.00001
    );
    if (index < track.samples.length && !gap) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  return { positions, indices };
}

export function getTrackBounds(track: Track, shoulder = 0): TrackBounds {
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
  for (const sample of track.samples) {
    for (const side of [-1, 1]) {
      const lateral = (sample.width / 2 + shoulder) * side;
      const x = sample.x - sample.tz * lateral;
      const z = sample.z + sample.tx * lateral;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minZ = Math.min(bounds.minZ, z);
      bounds.maxZ = Math.max(bounds.maxZ, z);
    }
  }
  return bounds;
}

function roadStrip(
  track: Track,
  inner: StripEdge,
  outer: StripEdge,
  color: string,
  elevation: number,
  jumps: readonly GapJump[] = [],
  zones: readonly GripZone[] = []
): THREE.Mesh {
  const { positions, indices } = buildRoadStripVertices(
    track,
    inner,
    outer,
    elevation,
    jumps,
    zones
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const isAsphalt = color === '#363b40' && zones.length > 0;
  if (isAsphalt) {
    const colors: number[] = [];
    for (let index = 0; index <= track.samples.length; index++) {
      const sample = track.samples[index % track.samples.length];
      if (!sample) continue;
      const surface = gripSurfaceAt(track, zones, sample.s);
      const base = new THREE.Color(color);
      if (surface.surface !== 'dry')
        base.lerp(
          new THREE.Color(surface.surface === 'wet' ? '#4d8197' : '#97764c'),
          Math.min(1, (1 - surface.coefficient) * 4)
        );
      colors.push(base.r, base.g, base.b, base.r, base.g, base.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  return new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({
      color: isAsphalt ? '#ffffff' : color,
      vertexColors: isAsphalt,
      side: THREE.DoubleSide,
    })
  );
}

function colouredSurface(
  positions: number[],
  indices: number[],
  colors: number[],
  name: string
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
  );
  mesh.name = name;
  return mesh;
}

function addStartLine(group: THREE.Group, track: Track): void {
  const columns = 8;
  const rowLength = 0.65;
  const dark = new THREE.Color('#26353b');
  const light = new THREE.Color('#fff5db');
  const positions: number[] = [],
    indices: number[] = [],
    colors: number[] = [];
  for (let row = 0; row < 2; row++) {
    const rowStart = track.startS + (row - 1) * rowLength;
    const rowEnd = rowStart + rowLength;
    const startFrame = sampleTrack(track, rowStart);
    const endFrame = sampleTrack(track, rowEnd);
    for (let column = 0; column < columns; column++) {
      const leftFraction = column / columns - 0.5;
      const rightFraction = (column + 1) / columns - 0.5;
      const corners = [
        roadPointAt(track, rowStart, startFrame.width * leftFraction),
        roadPointAt(track, rowEnd, endFrame.width * leftFraction),
        roadPointAt(track, rowStart, startFrame.width * rightFraction),
        roadPointAt(track, rowEnd, endFrame.width * rightFraction),
      ];
      const base = positions.length / 3;
      const color = (column + row) % 2 === 0 ? dark : light;
      for (const point of corners) {
        positions.push(point.x, 0.04, point.z);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
    }
  }
  group.add(colouredSurface(positions, indices, colors, 'starting-grid'));
}

function kerbStrip(
  track: Track,
  side: -1 | 1,
  jumps: readonly GapJump[] = [],
  zones: readonly GripZone[] = []
): THREE.Mesh {
  const strip = buildRoadStripVertices(
    track,
    { side, offset: side * 0.04 },
    { side, offset: side * 0.64 },
    0.035,
    jumps,
    zones
  );
  const red = new THREE.Color('#cf634d');
  const cream = new THREE.Color('#fff2d7');
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let index = 0; index < track.samples.length; index++) {
    const sample = track.samples[index];
    if (!sample) continue;
    const endS = track.samples[index + 1]?.s ?? track.totalLength;
    if (
      jumps.some(
        (jump) =>
          sample.s >= jump.takeoff - 0.00001 && endS <= jump.landing + 0.00001
      )
    )
      continue;
    const color = Math.floor(sample.s / 3) % 2 === 0 ? red : cream;
    const base = positions.length / 3;
    for (let corner = 0; corner < 4; corner++) {
      const offset = (index * 2 + corner) * 3;
      const x = strip.positions[offset],
        y = strip.positions[offset + 1],
        z = strip.positions[offset + 2];
      if (x === undefined || y === undefined || z === undefined)
        throw new Error('Incomplete canonical kerb');
      positions.push(x, y, z);
      colors.push(color.r, color.g, color.b);
    }
    // The left strip has the opposite cross-section order; faces remain upward.
    if (side === 1)
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    else indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  return colouredSurface(
    positions,
    indices,
    colors,
    side === 1 ? 'kerb-right' : 'kerb-left'
  );
}

export function createTrackRenderer(
  track: Track,
  jumps: readonly GapJump[] = [],
  options: { dynamicGrip?: boolean; zones?: readonly GripZone[] } = {}
): THREE.Group {
  const zones = options.zones ?? [];
  // Add exact section boundaries to the rendering strip using canonical frames.
  track = {
    ...track,
    samples: [
      ...track.samples,
      ...jumps
        .flatMap((jump) => [
          jump.rampStart,
          jump.takeoff,
          jump.landing,
          jump.rampEnd,
        ])
        .filter(
          (s) =>
            !track.samples.some((sample) => Math.abs(sample.s - s) < 0.00001)
        )
        .map((s) => sampleTrack(track, s)),
    ].sort((a, b) => a.s - b.s),
  };
  const group = new THREE.Group();
  group.name = 'canonical-road';
  group.add(
    roadStrip(
      track,
      { side: -1, offset: -0.8 },
      { side: 1, offset: 0.8 },
      '#c4b18a',
      0,
      jumps,
      zones
    ),
    roadStrip(
      track,
      { side: -1, offset: 0 },
      { side: 1, offset: 0 },
      '#363b40',
      0.03,
      jumps,
      zones
    ),
    roadStrip(
      track,
      { side: -1, offset: 0.18 },
      { side: -1, offset: 0.32 },
      '#f6eed6',
      0.04,
      jumps,
      zones
    ),
    roadStrip(
      track,
      { side: 1, offset: -0.32 },
      { side: 1, offset: -0.18 },
      '#f6eed6',
      0.04,
      jumps,
      zones
    )
  );
  group.add(
    kerbStrip(track, -1, jumps, zones),
    kerbStrip(track, 1, jumps, zones)
  );
  for (const jump of jumps) {
    const walls: number[] = [],
      wallIndices: number[] = [];
    for (const [from, to] of [
      [jump.rampStart, jump.takeoff],
      [jump.landing, jump.rampEnd],
    ]) {
      if (from === undefined || to === undefined) continue;
      for (const side of [-1, 1]) {
        const start = sampleTrack(track, from),
          end = sampleTrack(track, to);
        const a = roadPointAt(track, from, side * (start.halfWidth + 0.8));
        const b = roadPointAt(track, to, side * (end.halfWidth + 0.8));
        const base = walls.length / 3;
        walls.push(
          a.x,
          -0.04,
          a.z,
          b.x,
          -0.04,
          b.z,
          a.x,
          jumpRoadHeight(jumps, from),
          a.z,
          b.x,
          jumpRoadHeight(jumps, to),
          b.z
        );
        wallIndices.push(
          base,
          base + 1,
          base + 2,
          base + 1,
          base + 3,
          base + 2
        );
      }
    }
    const wallGeometry = new THREE.BufferGeometry();
    wallGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(walls, 3)
    );
    wallGeometry.setIndex(wallIndices);
    wallGeometry.computeVertexNormals();
    group.add(
      new THREE.Mesh(
        wallGeometry,
        new THREE.MeshLambertMaterial({
          color: '#a78456',
          side: THREE.DoubleSide,
        })
      )
    );
    // Three bold launch chevrons make the upcoming jump readable at speed.
    for (const distance of [
      jump.rampStart + 3,
      jump.rampStart + 5,
      jump.rampStart + 7,
    ]) {
      const vertices: number[] = [];
      for (const [s, lateral] of [
        [distance - 0.8, -2.2],
        [distance + 0.4, 0],
        [distance - 0.8, 2.2],
        [distance - 1.5, 2.2],
        [distance - 0.3, 0],
        [distance - 1.5, -2.2],
      ]) {
        if (s === undefined || lateral === undefined) continue;
        const point = roadPointAt(track, s, lateral);
        vertices.push(point.x, jumpRoadHeight(jumps, s) + 0.06, point.z);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3)
      );
      geometry.setIndex([0, 1, 4, 0, 4, 5, 1, 2, 3, 1, 3, 4]);
      const arrows = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: '#ffca60',
          side: THREE.DoubleSide,
        })
      );
      arrows.name = 'launch-chevrons';
      group.add(arrows);
    }
    // The gap is open air above terrain. Actual thick ramp lips expose its depth.
    for (const s of [jump.takeoff - 0.16, jump.landing + 0.16]) {
      const frame = sampleTrack(track, s);
      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(frame.width + 1.6, 0.35, 0.32),
        new THREE.MeshLambertMaterial({ color: '#d9c8a6' })
      );
      lip.position.set(frame.x, jump.height - 0.18, frame.z);
      lip.rotation.y = Math.atan2(frame.tx, frame.tz);
      lip.name = 'jump-ramp-cutaway';
      group.add(lip);
    }
    // A contrasting landing target is paint, never an additional collider.
    for (const offset of [3.5, 5.5, 7.5]) {
      const s = jump.landing + offset;
      const frame = sampleTrack(track, s);
      for (const side of [-1, 1]) {
        const point = roadPointAt(track, s, side * (frame.halfWidth - 0.8));
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.035, 1.2),
          new THREE.MeshBasicMaterial({ color: '#fff1c6' })
        );
        stripe.position.set(point.x, jumpRoadHeight(jumps, s) + 0.055, point.z);
        stripe.rotation.y = Math.atan2(frame.tx, frame.tz);
        stripe.name = 'landing-target';
        group.add(stripe);
      }
    }
    for (const s of [jump.takeoff - 2, jump.landing + 2]) {
      const marker = sampleTrack(track, s);
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(marker.width, 0.035, 0.45),
        new THREE.MeshBasicMaterial({ color: '#ffca60' })
      );
      stripe.position.set(marker.x, jumpRoadHeight(jumps, s) + 0.055, marker.z);
      stripe.rotation.y = Math.atan2(marker.tx, marker.tz);
      group.add(stripe);
    }
  }
  if (options.dynamicGrip) group.add(createGripMarkers(track, zones, jumps));
  addStartLine(group, track);
  return group;
}

function lineSegments(positions: number[], color: string): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color, depthTest: false })
  );
}

export function createTrackDebugOverlay(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'track-debug-overlay';
  const centerline: number[] = [];
  const normals: number[] = [];
  const widths: number[] = [];
  const curvature: number[] = [];
  const curvatureColors: number[] = [];
  const maxCurvature = Math.max(
    ...track.samples.map((sample) => Math.abs(sample.curvature)),
    0.001
  );
  for (let index = 0; index < track.samples.length; index++) {
    const sample = track.samples[index];
    const next = track.samples[(index + 1) % track.samples.length];
    if (!sample || !next) continue;
    centerline.push(sample.x, 0.15, sample.z, next.x, 0.15, next.z);
    const lateral = sample.width / 2;
    const left = {
      x: sample.x + sample.tz * lateral,
      z: sample.z - sample.tx * lateral,
    };
    const right = {
      x: sample.x - sample.tz * lateral,
      z: sample.z + sample.tx * lateral,
    };
    curvature.push(left.x, 0.16, left.z, right.x, 0.16, right.z);
    const color = new THREE.Color().setHSL(
      0.16 * (1 - Math.abs(sample.curvature) / maxCurvature),
      0.9,
      0.6
    );
    curvatureColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    if (index % 8 === 0) {
      widths.push(left.x, 0.18, left.z, right.x, 0.18, right.z);
      normals.push(
        sample.x,
        0.2,
        sample.z,
        sample.x - sample.tz * (lateral + 2),
        0.2,
        sample.z + sample.tx * (lateral + 2)
      );
    }
  }
  const curvatureGeometry = new THREE.BufferGeometry();
  curvatureGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(curvature, 3)
  );
  curvatureGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(curvatureColors, 3)
  );
  group.add(
    new THREE.LineSegments(
      curvatureGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        depthTest: false,
      })
    ),
    lineSegments(centerline, '#8dffd6'),
    lineSegments(widths, '#6ce5ff'),
    lineSegments(normals, '#dd9aff')
  );
  const checkpoints: number[] = [];
  for (const checkpoint of track.checkpoints) {
    const frame = sampleTrack(track, checkpoint.s);
    const left = roadPointAt(track, checkpoint.s, -frame.halfWidth - 1);
    const right = roadPointAt(track, checkpoint.s, frame.halfWidth + 1);
    checkpoints.push(left.x, 0.25, left.z, right.x, 0.25, right.z);
  }
  group.add(lineSegments(checkpoints, '#ffd66b'));
  return group;
}
