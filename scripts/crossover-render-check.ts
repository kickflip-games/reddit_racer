/** Geometry/camera/prop audit of the exact persisted production-path forecast. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { Mesh, InstancedMesh, Object3D, Raycaster, Vector3 } from 'three';
import { parseTrack, sampleTrack } from '../src/shared/track';
import {
  findTrackCrossings,
  crossingHeadroom,
  CROSSING_CLEAR_RADIUS,
} from '../src/shared/track-crossings';
import {
  createTrackRenderer,
  createBridgeVisibility,
} from '../src/client/track-renderer';
import { createRaceCamera } from '../src/client/race-camera';
import { generateSceneryLayout } from '../src/client/scenery-layout';
const input = process.argv[2];
if (!input) throw new Error('Pass validated forecast.json');
const data: { rows: { day: string; track: unknown }[] } = JSON.parse(
  readFileSync(input, 'utf8')
);
const rows = [];
for (const row of data.rows) {
  const track = parseTrack(row.track),
    crossings = findTrackCrossings(track);
  if (!crossings.length) continue;
  const crossing = crossings[0]!;
  assert.equal(crossings.length, 1);
  assert(crossingHeadroom(track) > 10);
  const renderer = createTrackRenderer(track),
    visibility = createBridgeVisibility(renderer, track),
    camera = createRaceCamera(track);
  camera.resize({
    width: 393,
    height: 568,
    insets: { top: 70, bottom: 120, left: 12, right: 12 },
  });
  let carPositions = 0;
  for (const s of [crossing.lowerS, crossing.upperS])
    for (const delta of [
      -60, -48, -40, -32, -24, -12, 0, 12, 24, 32, 40, 48, 60,
    ])
      for (const lateral of [-2.5, 0, 2.5]) {
        const distance = s + delta,
          frame = sampleTrack(track, distance),
          view = visibility(distance);
        if (Math.abs(delta) < 40)
          assert.equal(view.deck, s === crossing.lowerS ? 'lower' : 'upper');
        camera.update(
          {
            distance,
            lateralOffset: lateral,
            heading: 0,
            speed: 22,
            elevation: frame.y ?? 0,
          },
          { mode: 'chase', reset: true, deltaSeconds: 0 }
        );
        assert(camera.camera.position.y > 60);
        const car = new Vector3(
          frame.x + frame.nx * lateral,
          (frame.y ?? 0) + 1.2,
          frame.z + frame.nz * lateral
        );
        const direction = camera.camera
          .getWorldDirection(new Vector3())
          .negate();
        const blockers = new Raycaster(car, direction, 0.1, 100)
          .intersectObject(renderer, true)
          .filter(
            (hit) =>
              hit.object instanceof Mesh &&
              !Array.isArray(hit.object.material) &&
              hit.object.material.opacity > 0.5
          );
        assert.equal(
          blockers.length,
          0,
          `${row.day}: ${view.deck}, ${delta}/${lateral}: ${blockers.map((h) => h.object.name).join(',')}`
        );
        carPositions++;
      }
  const piers = renderer.getObjectByName('bridge-piers');
  assert(piers instanceof InstancedMesh);
  const dummy = new Object3D();
  for (let i = 0; i < piers.count; i++) {
    piers.getMatrixAt(i, dummy.matrix);
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
    assert(
      Math.hypot(
        dummy.position.x - crossing.x,
        dummy.position.z - crossing.z
      ) >= CROSSING_CLEAR_RADIUS
    );
  }
  const scenery = generateSceneryLayout(track);
  for (const p of [...scenery.allPlants, ...scenery.props])
    assert(
      Math.hypot(p.x - crossing.x, p.z - crossing.z) >=
        CROSSING_CLEAR_RADIUS + p.radius
    );
  rows.push({
    day: row.day,
    crossings,
    fullWidthHeadroom: crossingHeadroom(track),
    carPositions,
    opaqueCameraObstructions: 0,
    plants: scenery.allPlants.length,
    props: scenery.props.length,
    clearRadius: CROSSING_CLEAR_RADIUS,
  });
  renderer.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      if (!Array.isArray(o.material)) o.material.dispose();
    }
  });
}
const result = {
  viewport: { width: 393, height: 568 },
  rows,
  crossingDays: rows.length,
  carPositions: rows.reduce((sum, r) => sum + r.carPositions, 0),
};
if (process.argv[3])
  writeFileSync(process.argv[3], JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
