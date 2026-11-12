import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewState } from './race.ts';

void test('shared state imports without a browser and resets independently', () => {
  const first = createPreviewState();
  first.distance = 10;
  assert.deepEqual(createPreviewState(), { distance: 0, speed: 0 });
});
