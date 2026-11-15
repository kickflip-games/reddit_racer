import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGhostStore,
  ghostPosition,
  MAX_GHOST_POINTS,
  type GhostLap,
} from '../../src/client/best-ghost.ts';
const lap: GhostLap = {
  ticks: 120,
  points: [
    [0, 0, 1, 0],
    [60, 10, 3, 0],
    [120, 0, 1, 0],
  ],
};
void test('ghost interpolation follows lap time, ends without wrapping and validates storage', () => {
  assert.deepEqual(ghostPosition(lap, 30), [5, 2, 0]);
  assert.deepEqual(ghostPosition(lap, 120), [0, 1, 0]);
  assert.equal(ghostPosition(lap, 121), null);
  let raw = '';
  const storage = {
    getItem: () => raw,
    setItem: (_: string, value: string) => {
      raw = value;
    },
  };
  const store = createGhostStore(storage);
  assert.equal(store.get('course'), null);
  assert.equal(store.save('course', lap), true);
  assert.equal(store.save('course', lap), false);
  assert.deepEqual(createGhostStore(storage).get('course'), lap);
  assert.equal(store.get('other-handling'), null);
  assert.equal(
    store.save('bad', {
      ticks: 120,
      points: [
        [1, 0, 0, 0],
        [120, 0, 0, 0],
      ],
    }),
    false
  );
  assert.equal(
    store.save('bad', {
      ticks: 120,
      points: Array(MAX_GHOST_POINTS + 1).fill([0, 0, 0, 0]),
    }),
    false
  );
  raw = '{broken';
  assert.equal(createGhostStore(storage).get('course'), null);
});
void test('only eight recent courses persist and storage failures retain session trajectory', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
  };
  const store = createGhostStore(storage);
  for (let i = 0; i < 10; i++) store.save(String(i), lap);
  assert.equal(store.get('0'), null);
  assert.deepEqual(store.get('9'), lap);
});
