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
  elevation: number
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
        (sample.y ?? 0) + elevation,
        sample.z + sample.tx * lateral
      );
    }
    if (index < track.samples.length) {
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
  elevation: number
): THREE.Mesh {
  const { positions, indices } = buildRoadStripVertices(
    track,
    inner,
    outer,
    elevation
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
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

function kerbStrip(track: Track, side: -1 | 1): THREE.Mesh {
  const strip = buildRoadStripVertices(
    track,
    { side, offset: side * 0.04 },
    { side, offset: side * 0.64 },
    0.035
  );
  const red = new THREE.Color('#d86552');
  const cream = new THREE.Color('#fff2d7');
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let index = 0; index < track.samples.length; index++) {
    const sample = track.samples[index];
    if (!sample) continue;
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

export function createTrackRenderer(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'canonical-road';
  group.add(
    roadStrip(
      track,
      { side: -1, offset: -0.8 },
      { side: 1, offset: 0.8 },
      '#aabb7b',
      0
    ),
    roadStrip(
      track,
      { side: -1, offset: 0 },
      { side: 1, offset: 0 },
      '#36464a',
      0.03
    ),
    roadStrip(
      track,
      { side: -1, offset: 0.18 },
      { side: -1, offset: 0.32 },
      '#f6eed6',
      0.04
    ),
    roadStrip(
      track,
      { side: 1, offset: -0.32 },
      { side: 1, offset: -0.18 },
      '#f6eed6',
      0.04
    )
  );
  group.add(kerbStrip(track, -1), kerbStrip(track, 1));
  addStartLine(group, track);
  if (track.schemaVersion === 2) group.add(createRoadStructure(track));
  return group;
}

/** Raised road fascia and pooled piers make the elevation readable without shadow maps. */
function createRoadStructure(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'raised-road-structure';
  const positions: number[] = [],
    indices: number[] = [];
  const footings: { x: number; y: number; z: number; heading: number }[] = [];
  for (let i = 0; i < track.samples.length; i++) {
    const a = track.samples[i],
      b = track.samples[(i + 1) % track.samples.length];
    if (!a || !b || Math.max(a.y ?? 0, b.y ?? 0) < 0.14) continue;
    for (const side of [-1, 1]) {
      const base = positions.length / 3;
      for (const sample of [a, b]) {
        const lateral = side * (sample.width / 2 + 0.8);
        const y = sample.y ?? 0;
        for (const bottom of [false, true])
          positions.push(
            sample.x - sample.tz * lateral,
            Math.max(0, y - (bottom ? 0.55 : 0.02)),
            sample.z + sample.tx * lateral
          );
      }
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    if (i % 9 === 0 && (a.y ?? 0) > 0.6)
      footings.push(
        {
          x: a.x - a.tz * (a.width / 2 + 0.3),
          y: a.y ?? 0,
          z: a.z + a.tx * (a.width / 2 + 0.3),
          heading: Math.atan2(a.tx, a.tz),
        },
        {
          x: a.x + a.tz * (a.width / 2 + 0.3),
          y: a.y ?? 0,
          z: a.z - a.tx * (a.width / 2 + 0.3),
          heading: Math.atan2(a.tx, a.tz),
        }
      );
  }
  const fascia = new THREE.BufferGeometry();
  fascia.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  fascia.setIndex(indices);
  fascia.computeVertexNormals();
  group.add(
    new THREE.Mesh(
      fascia,
      new THREE.MeshLambertMaterial({
        color: '#a9b5b1',
        side: THREE.DoubleSide,
      })
    )
  );
  const piers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshLambertMaterial({ color: '#9aa6a0' }),
    footings.length
  );
  piers.name = 'bridge-piers';
  const dummy = new THREE.Object3D();
  footings.forEach((p, i) => {
    dummy.position.set(p.x, p.y / 2, p.z);
    dummy.rotation.y = p.heading;
    dummy.scale.set(0.65, Math.max(0.1, p.y - 0.2), 0.85);
    dummy.updateMatrix();
    piers.setMatrixAt(i, dummy.matrix);
  });
  group.add(piers);
  // Small ground strips under raised sections anchor them and leave the asphalt legible.
  const shadow = buildRoadStripVertices(
    track,
    { side: -1, offset: -1.1 },
    { side: 1, offset: 1.1 },
    0.002
  );
  const shadowIndices = shadow.indices.filter((_, index) => {
    const sample = track.samples[Math.floor(index / 6)];
    return (sample?.y ?? 0) > 0.18;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      shadow.positions.map((v, i) => (i % 3 === 1 ? 0.002 : v)),
      3
    )
  );
  geometry.setIndex(shadowIndices);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: '#496b42', side: THREE.DoubleSide })
  );
  mesh.name = 'road-ground-shadow';
  group.add(mesh);
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
    centerline.push(
      sample.x,
      (sample.y ?? 0) + 0.15,
      sample.z,
      next.x,
      (next.y ?? 0) + 0.15,
      next.z
    );
    const lateral = sample.width / 2;
    const left = {
      x: sample.x + sample.tz * lateral,
      z: sample.z - sample.tx * lateral,
    };
    const right = {
      x: sample.x - sample.tz * lateral,
      z: sample.z + sample.tx * lateral,
    };
    curvature.push(
      left.x,
      (sample.y ?? 0) + 0.16,
      left.z,
      right.x,
      (sample.y ?? 0) + 0.16,
      right.z
    );
    const color = new THREE.Color().setHSL(
      0.16 * (1 - Math.abs(sample.curvature) / maxCurvature),
      0.9,
      0.6
    );
    curvatureColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    if (index % 8 === 0) {
      widths.push(
        left.x,
        (sample.y ?? 0) + 0.18,
        left.z,
        right.x,
        (sample.y ?? 0) + 0.18,
        right.z
      );
      normals.push(
        sample.x,
        (sample.y ?? 0) + 0.2,
        sample.z,
        sample.x - sample.tz * (lateral + 2),
        (sample.y ?? 0) + 0.2,
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
