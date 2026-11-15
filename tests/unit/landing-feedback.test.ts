import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLandingFeedback } from '../../src/client/landing-feedback.ts';
import { createRaceCamera } from '../../src/client/race-camera.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
const frame = {
  attemptId: 1,
  landings: 0,
  impact: 1,
  active: true,
  reducedMotion: false,
  deltaSeconds: 1 / 60,
};
test('landing is a single bounded pulse, settles and never retriggers on repeated render', () => {
  const feedback = createLandingFeedback();
  assert.equal(feedback.update(frame).compression, 0);
  assert.equal(feedback.update({ ...frame, landings: 1 }).compression, 0.09);
  let result;
  for (let i = 0; i < 60; i++) {
    result = feedback.update({ ...frame, landings: 1 });
    assert.ok(Math.abs(result.cameraPixels) <= 1.5);
    assert.ok(Math.abs(result.compression) <= 0.09);
  }
  assert.equal(result?.compression, 0);
  assert.equal(result?.cameraPixels, 0);
});
test('retry, reduced motion and inactive frames baseline without phantom landing', () => {
  const feedback = createLandingFeedback();
  feedback.update(frame);
  assert.equal(
    feedback.update({ ...frame, landings: 1, reducedMotion: true }).compression,
    0
  );
  assert.equal(feedback.update({ ...frame, landings: 1 }).compression, 0);
  assert.equal(
    feedback.update({ ...frame, landings: 2, active: false }).compression,
    0
  );
  assert.equal(
    feedback.update({ ...frame, attemptId: 2, landings: 3 }).compression,
    0
  );
});
test('camera impulse never accumulates or changes camera world pose and reduced motion disables it', () => {
  const camera = createRaceCamera(createOvalTrack());
  camera.resize({
    width: 640,
    height: 360,
    insets: { top: 0, left: 0, right: 0, bottom: 0 },
  });
  const pose = { distance: 0, lateralOffset: 0, heading: 0, speed: 0 };
  const options = { mode: 'chase' as const, deltaSeconds: 0 };
  camera.update(pose, options);
  const baseline = camera.camera.projectionMatrix.clone();
  const position = camera.camera.position.clone();
  camera.update(pose, { ...options, impulsePixels: 1 });
  const shifted = camera.camera.projectionMatrix.clone();
  assert.ok(!shifted.equals(baseline));
  for (let i = 0; i < 20; i++)
    camera.update(pose, { ...options, impulsePixels: 1 });
  assert.ok(camera.camera.projectionMatrix.equals(shifted));
  assert.ok(camera.camera.position.equals(position));
  camera.update(pose, { ...options, impulsePixels: 1, reducedMotion: true });
  assert.ok(camera.camera.projectionMatrix.equals(baseline));
});

test('suspension animates the body only and reset/reduced motion restore its rest pose', async () => {
  const { createCarVisual } = await import('../../src/client/car-visual.ts');
  const car = createCarVisual();
  const visual = {
    x: 0,
    z: 0,
    heading: 0,
    distance: 0,
    speed: 0,
    acceleration: 0,
    lateralAcceleration: 0,
    curvature: 0,
    slip: 0,
    held: false,
    racing: true,
    reducedMotion: false,
    deltaSeconds: 1 / 60,
  };
  car.update(visual);
  const body = car.object.getObjectByName('car-body-wrapper');
  assert.ok(body);
  const rest = body.position.y;
  const world = car.object.position.clone();
  const wheel = car.object.getObjectByName('wheel-front-left');
  assert.ok(wheel);
  const wheelRest = wheel.position.clone();
  car.update({ ...visual, suspensionCompression: 0.09 });
  assert.ok(body.position.y < rest);
  assert.ok(car.object.position.equals(world));
  assert.ok(wheel.position.equals(wheelRest));
  car.update({ ...visual, suspensionCompression: 0.09, reducedMotion: true });
  assert.equal(body.position.y, rest);
  car.update({ ...visual, suspensionCompression: 0.09 });
  car.reset();
  assert.equal(body.position.y, rest);
  car.dispose();
});
