import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drivingHintText } from '../../src/client/driving-hint.ts';
test('brief controls explain auto-steering and early braking without promising ranked drift', () => {
  assert.equal(
    drivingHintText(false, true),
    'Automatic steering · Hold to go · Release before tight turns'
  );
  assert.equal(drivingHintText(false, false), drivingHintText(false, true));
  assert.match(drivingHintText(true, true), /Practice drift: two fingers$/);
  assert.match(drivingHintText(true, false), /Practice drift: hold Shift$/);
});
