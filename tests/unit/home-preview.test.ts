import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHomePreview } from '../../src/client/home-preview';
import { createSimulationDriver } from '../../src/client/simulation-driver';
import { generateCurrentDailyCircuit } from '../../src/shared/braking-course-generator';
import { sampleTrack } from '../../src/shared/track';

const track = generateCurrentDailyCircuit('word-v2:banana').track;
void test('home preview laps the actual loaded circuit without touching race state or input', () => {
  const before = JSON.stringify(track),
    driver = createSimulationDriver(track);
  const race = JSON.stringify(driver.raceState),
    tape = JSON.stringify(driver.replay);
  const preview = createHomePreview(track);
  for (let i = 0; i < 1000; i++) {
    const pose = preview.update(0.1, 'playing');
    const road = sampleTrack(track, track.startS + pose.distance);
    assert.equal(pose.x, road.x);
    assert.equal(pose.z, road.z);
    assert.equal(pose.elevation, road.y);
    assert.ok(pose.distance >= 0 && pose.distance < track.totalLength);
  }
  assert.equal(JSON.stringify(track), before);
  assert.equal(JSON.stringify(driver.raceState), race);
  assert.equal(JSON.stringify(driver.replay), tape);
});
void test('preview pauses, clamps catch-up and resets to a stable reduced-motion/start pose', () => {
  const preview = createHomePreview(track);
  const moving = preview.update(0.1, 'playing');
  assert.equal(preview.update(60, 'paused').distance, moving.distance);
  assert.ok(
    preview.update(60, 'playing').distance - moving.distance <= 1.400001
  );
  assert.equal(preview.update(1, 'static').distance, 0);
  assert.deepEqual(preview.update(1, 'static'), preview.update(0, 'static'));
  preview.update(0.1, 'playing');
  preview.reset();
  assert.equal(preview.update(0, 'paused').distance, 0);
  assert.throws(() => preview.update(NaN, 'playing'));
  assert.throws(() => preview.update(-1, 'playing'));
});
