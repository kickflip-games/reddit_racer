import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3, Mesh, InstancedMesh, Object3D } from 'three';
import {
  generateCurrentDailyCircuit,
  assessBrakingTrack,
} from '../../src/shared/braking-course-generator';
import {
  findTrackCrossings,
  crossingHeadroom,
  CROSSING_CLEAR_RADIUS,
} from '../../src/shared/track-crossings';
import {
  parseTrack,
  serializeTrack,
  sampleTrack,
} from '../../src/shared/track';
import {
  createSimulationState,
  stepSimulation,
  type SimulationState,
} from '../../src/shared/simulation';
import {
  advanceLapProgress,
  createRacingState,
  stepRace,
} from '../../src/shared/race-rules';
import { runReplay } from '../../src/shared/replay';
import {
  createTrackRenderer,
  createBridgeVisibility,
} from '../../src/client/track-renderer';
import {
  createMinimapGeometry,
  sampleMinimap,
} from '../../src/client/circuit-minimap';
import {
  createGroundSurface,
  groundHeightAt,
  createRoadField,
  sceneryClearance,
} from '../../src/client/scenery-layout';
import { createRaceCamera } from '../../src/client/race-camera';
import { Raycaster } from 'three';
const course = generateCurrentDailyCircuit('daily:t5_kyc33w:2026-11-27');
const track = course.track;
const crossing = findTrackCrossings(track)[0]!;
void test('small asymmetric overpass survives canonical storage, full-width clearance and ranked verification', () => {
  assert(course.quality.valid);
  assert.equal(findTrackCrossings(track).length, 1);
  assert(crossingHeadroom(track) > 11.44);
  assert(crossing.angle > Math.PI * 0.22);
  assert(
    Math.abs(crossing.upperS - crossing.lowerS) < track.totalLength * 0.25
  );
  assert.equal(track.jumps?.length, 0);
  const restored = parseTrack(JSON.parse(serializeTrack(track)));
  assert.deepEqual(findTrackCrossings(restored), [crossing]);
  assert.equal(crossingHeadroom(restored), crossingHeadroom(track));
  for (const s of [crossing.lowerS, crossing.upperS])
    for (const delta of [-16, 0, 16])
      assert(Math.abs(sampleTrack(track, s + delta).grade ?? 0) < 0.003);
  assert.equal(course.quality.metrics?.fast.airborneTicks, 0);
  assert.equal(course.quality.metrics?.cautious.airborneTicks, 0);
  assert.equal(course.quality.metrics?.fast.recoveryCount, 0);
  assert(course.quality.fastReplay);
  assert.equal(
    runReplay(restored, course.quality.fastReplay).finishTicks,
    course.quality.metrics?.fast.finishTicks
  );
  const tooLow = {
    ...track,
    samples: track.samples.map((p) => ({
      ...p,
      y: (p.y ?? 0) * 0.8,
      grade: (p.grade ?? 0) * 0.8,
      verticalCurvature: (p.verticalCurvature ?? 0) * 0.8,
    })),
  };
  assert(assessBrakingTrack(tooLow).codes.includes('unsafe-overpass'));
});
void test('coincident XZ decks keep their own ground, progress and checkpoints, including a failed rejoin', () => {
  for (const s of [crossing.lowerS, crossing.upperS]) {
    const frame = sampleTrack(track, s);
    let state: SimulationState = {
      ...createSimulationState(track),
      distance: s,
      speed: 10,
      vertical: {
        height: frame.y ?? 0,
        velocity: 0,
        airborne: false,
        landings: 0,
        impact: 0,
      },
    };
    for (let i = 0; i < 30; i++) state = stepSimulation(track, state, true);
    assert(state.distance > s && state.distance < s + 4);
    assert.equal(state.vertical?.airborne, false);
    assert.equal(state.vertical?.height, frame.y);
    // Driving below the upper deck cannot snap up onto it on an XZ rejoin.
    if (s === crossing.upperS) {
      state = {
        ...state,
        lateralOffset: frame.halfWidth + 0.001,
        lateralVelocity: -1,
        vertical: {
          height: 0,
          velocity: 0,
          airborne: false,
          landings: 0,
          impact: 0,
        },
      };
      state = stepSimulation(track, state, true);
      assert.equal(state.recovering, true);
      assert.equal(state.recoveryCount, 1);
      assert.equal(state.vertical?.height, 0);
      assert(state.distance > crossing.upperS);
    }
  }
  const map = createMinimapGeometry(track),
    a = sampleMinimap(map, crossing.lowerS),
    b = sampleMinimap(map, crossing.upperS);
  assert(Math.hypot(a.x - b.x, a.y - b.y) < 0.0001);
  assert.notEqual(a.stroke, b.stroke);
  assert.equal(map.bridges.length, 1);
  assert.equal(map.bridges[0]?.upperS, crossing.upperS);
  const surface = createGroundSurface(track);
  assert(
    Math.abs(groundHeightAt(surface, crossing.x, crossing.z) + 0.12) < 1e-7
  );
  const field = createRoadField(track);
  assert.equal(
    sceneryClearance(track, crossing.x + 15, crossing.z + 10, 2, field),
    false
  );
});
void test('bridge fascia, underside and piers clear both decks; cutaway protects the fixed phone camera', () => {
  const group = createTrackRenderer(track),
    visibility = createBridgeVisibility(group, track);
  const camera = createRaceCamera(track);
  camera.resize({
    width: 393,
    height: 568,
    insets: { top: 70, bottom: 120, left: 12, right: 12 },
  });
  const materials: number[] = [];
  const span = group.getObjectByName('bridge-cutaway-0');
  assert(span);
  span.traverse((o) => {
    if (o instanceof Mesh && !Array.isArray(o.material))
      materials.push(o.material.opacity);
  });
  assert(materials.length >= 8);
  const piers = group.getObjectByName('bridge-piers');
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
  for (const s of [crossing.lowerS, crossing.upperS])
    for (const delta of [-24, -12, 0, 12, 24])
      for (const lateral of [-2.5, 0, 2.5]) {
        const distance = s + delta,
          frame = sampleTrack(track, distance),
          view = visibility(distance);
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
        const direction = camera.camera
          .getWorldDirection(new Vector3())
          .negate();
        const car = new Vector3(
          frame.x + frame.nx * lateral,
          (frame.y ?? 0) + 1.2,
          frame.z + frame.nz * lateral
        );
        const ray = new Raycaster(car, direction, 0.1, 100);
        const blockers = ray
          .intersectObject(group, true)
          .filter(
            (hit) =>
              hit.object instanceof Mesh &&
              !Array.isArray(hit.object.material) &&
              hit.object.material.opacity > 0.5
          );
        assert.equal(
          blockers.length,
          0,
          `camera obstruction on ${view.deck} at ${delta}/${lateral}: ${blockers.map((h) => h.object.name).join(',')}`
        );
      }
  visibility(crossing.lowerS);
  span.traverse((o) => {
    if (o instanceof Mesh && !Array.isArray(o.material)) {
      assert.equal(o.material.opacity, 0.14);
      assert.equal(o.material.depthWrite, false);
    }
  });
  visibility(crossing.upperS);
  span.traverse((o) => {
    if (o instanceof Mesh && !Array.isArray(o.material))
      assert.equal(o.material.opacity, 1);
  });
  group.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      if (!Array.isArray(o.material)) o.material.dispose();
    }
  });
});

void test('a crossing cannot skip checkpoint progress or teleport to the coincident deck', () => {
  const tape = course.quality.fastReplay;
  assert(tape);
  let race = createRacingState(track),
    held = false,
    ix = 0;
  while (race.simulation.distance < crossing.lowerS) {
    while (tape.transitions[ix]?.tick === race.simulation.tick)
      held = tape.transitions[ix++]!.held;
    race = stepRace(track, race, held);
  }
  const next = stepSimulation(track, race.simulation, held);
  assert.doesNotThrow(() =>
    advanceLapProgress(track, race, race.simulation, next)
  );
  assert.throws(() =>
    advanceLapProgress(track, race, race.simulation, {
      ...next,
      distance: crossing.upperS,
      vertical: {
        height: 12,
        velocity: 0,
        airborne: false,
        landings: 0,
        impact: 0,
      },
    })
  );
  while (race.phase === 'racing') {
    while (tape.transitions[ix]?.tick === race.simulation.tick)
      held = tape.transitions[ix++]!.held;
    race = stepRace(track, race, held);
  }
  assert.equal(race.phase, 'finished');
  assert.equal(race.nextCheckpointIndex, track.checkpoints.length);
  assert.equal(race.checkpointTicks.length, track.checkpoints.length);
  assert(
    race.checkpointTicks.every(
      (tick, i) => i === 0 || tick > race.checkpointTicks[i - 1]!
    )
  );
});
