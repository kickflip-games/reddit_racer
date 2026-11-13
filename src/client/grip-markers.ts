import * as THREE from 'three';
import { roadPointAt, sampleTrack, type Track } from '../shared/track';
import {
  gripSurfaceAt,
  slotBrakingMarkers,
  type GripZone,
} from '../shared/slot-grip';
import { jumpRoadHeight, type GapJump } from '../shared/stunt-course';

/** Static, batched shoulder bars identify braking zones without drawing a racing line. */
export function createGripMarkers(
  track: Track,
  zones: readonly GripZone[],
  jumps: readonly GapJump[]
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'grip-braking-markers';
  const positions: number[] = [],
    indices: number[] = [];
  for (const marker of slotBrakingMarkers(track, zones)) {
    for (const lead of [0, 3, 6]) {
      const s = marker.s - lead;
      const wrapped = sampleTrack(track, s).s;
      if (
        jumps.some(
          (jump) => wrapped >= jump.rampStart && wrapped <= jump.rampEnd
        )
      )
        continue;
      for (const side of [-1, 1]) {
        const base = positions.length / 3;
        for (const [along, extra] of [
          [-0.45, 0.75],
          [-0.45, 1.7],
          [0.45, 0.75],
          [0.45, 1.7],
        ]) {
          if (along === undefined || extra === undefined) continue;
          const frame = sampleTrack(track, s + along);
          const lateral = side * (frame.halfWidth + extra);
          const point = roadPointAt(track, s + along, lateral);
          positions.push(
            point.x,
            0.065 +
              jumpRoadHeight(jumps, frame.s) -
              lateral * Math.tan(gripSurfaceAt(track, zones, frame.s).bank),
            point.z
          );
        }
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  const bars = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: '#ffca60', side: THREE.DoubleSide })
  );
  bars.name = 'braking-zone-bars';
  group.add(bars);
  return group;
}
