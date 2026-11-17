import assert from 'node:assert/strict';
import { test } from 'node:test';
import { smoothCarHeading } from '../../src/client/car-heading.ts';

void test('restarting eases a stopped pose without a one-frame yaw snap', () => {
  let heading = 0.55;
  for (let i = 0; i < 60; i++) {
    const next = smoothCarHeading(heading, 0, 1 / 60, false);
    assert.ok(Math.abs(next - heading) <= 4 / 60);
    assert.ok(next >= 0 && next <= heading);
    heading = next;
  }
  assert.equal(heading, 0);
});
void test('heading follows the short arc across the angle seam', () => {
  const next = smoothCarHeading(Math.PI - 0.02, -Math.PI + 0.02, 1 / 60, false);
  assert.ok(next > Math.PI - 0.02 && next < Math.PI + 0.02);
});
void test('stationary, zero-time and explicit retry poses stay stable', () => {
  assert.equal(smoothCarHeading(0.5, 0.5, 1 / 60, false), 0.5);
  assert.equal(smoothCarHeading(0.5, 0, 0, false), 0.5);
  assert.equal(smoothCarHeading(0.5, 0, 0, true), 0);
});
void test('visual smoothing is frame-rate independent away from rate limit', () => {
  const settle = (hz: number): number => {
    let heading = 0.2;
    for (let i = 0; i < hz / 2; i++)
      heading = smoothCarHeading(heading, 0, 1 / hz, false);
    return heading;
  };
  assert.ok(Math.abs(settle(30) - settle(120)) < 1e-9);
});
