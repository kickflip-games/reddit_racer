import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLiveLapTime } from '../../src/client/live-lap-time';
import { SIMULATION_HZ } from '../../src/shared/simulation';

void test('live lap time displays completed tenths with steady minimum digits', () => {
  assert.equal(formatLiveLapTime(0), '00.0');
  assert.equal(formatLiveLapTime(11), '00.0');
  assert.equal(formatLiveLapTime(12), '00.1');
  assert.equal(formatLiveLapTime(119), '00.9');
  assert.equal(formatLiveLapTime(120), '01.0');
  assert.equal(formatLiveLapTime(10 * SIMULATION_HZ - 1), '09.9');
  assert.equal(formatLiveLapTime(10 * SIMULATION_HZ), '10.0');
  assert.equal(formatLiveLapTime(24 * SIMULATION_HZ + 95), '24.7');
});

void test('live lap time does not roll seconds or minutes forward early', () => {
  assert.equal(formatLiveLapTime(60 * SIMULATION_HZ - 1), '59.9');
  assert.equal(formatLiveLapTime(60 * SIMULATION_HZ), '60.0');
  assert.equal(formatLiveLapTime(100 * SIMULATION_HZ - 1), '99.9');
  assert.equal(formatLiveLapTime(100 * SIMULATION_HZ), '100.0');
});
