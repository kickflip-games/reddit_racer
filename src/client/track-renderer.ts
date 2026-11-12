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
        elevation,
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

function addStartLine(group: THREE.Group, track: Track): void {
  const columns = 8;
  const rowLength = 0.65;
  const materials = [
    new THREE.MeshLambertMaterial({ color: '#222e30', side: THREE.DoubleSide }),
    new THREE.MeshLambertMaterial({ color: '#f9f3d6', side: THREE.DoubleSide }),
  ];
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
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          corners.flatMap((point) => [point.x, 0.06, point.z]),
          3
        )
      );
      geometry.setIndex([0, 2, 1, 2, 3, 1]);
      geometry.computeVertexNormals();
      group.add(new THREE.Mesh(geometry, materials[(column + row) % 2]));
    }
  }
}

export function createTrackRenderer(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.name = 'canonical-road';
  group.add(
    roadStrip(
      track,
      { side: -1, offset: -0.8 },
      { side: 1, offset: 0.8 },
      '#d4c5a0',
      0
    ),
    roadStrip(
      track,
      { side: -1, offset: 0 },
      { side: 1, offset: 0 },
      '#394747',
      0.03
    ),
    roadStrip(
      track,
      { side: -1, offset: 0.18 },
      { side: -1, offset: 0.32 },
      '#e7e9cc',
      0.045
    ),
    roadStrip(
      track,
      { side: 1, offset: -0.32 },
      { side: 1, offset: -0.18 },
      '#e7e9cc',
      0.045
    )
  );
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
