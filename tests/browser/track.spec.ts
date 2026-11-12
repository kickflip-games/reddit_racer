import { test, expect } from '@playwright/test';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import {
  hashTrack,
  sampleTrack,
  serializeTrack,
} from '../../src/shared/track.ts';

const moduleUrl = `/@fs${new URL('../../src/shared/track.ts', import.meta.url).pathname}`;

test('canonical track reconstructs and samples identically in Node and browser', async ({
  page,
}) => {
  const track = createOvalTrack();
  const serialized = serializeTrack(track);
  const distances = [
    -0.01,
    0,
    0.01,
    track.totalLength / 3,
    track.totalLength - 0.01,
    track.totalLength,
  ];
  const expected = distances.map((distance) => sampleTrack(track, distance));
  await page.goto('/game.html');
  const actual = await page.evaluate(
    async ({ moduleUrl, serialized, distances }) => {
      const module = await import(moduleUrl);
      const restored = module.parseTrack(JSON.parse(serialized));
      return {
        canonical: module.serializeTrack(restored),
        hash: await module.hashTrack(restored),
        frames: distances.map((distance) =>
          module.sampleTrack(restored, distance)
        ),
      };
    },
    { moduleUrl, serialized, distances }
  );
  expect(actual.canonical).toBe(serialized);
  expect(actual.hash).toBe(await hashTrack(track));
  expect(actual.frames).toEqual(expected);
});

test('road mesh closes with upward faces and matches shared road bounds', async ({
  page,
}) => {
  await page.goto('/game.html');
  const metrics = await page.evaluate(async (moduleUrl) => {
    const { createOvalTrack } = await import(
      moduleUrl.replace('track.ts', 'track-authoring.ts')
    );
    const { sampleTrack } = await import(moduleUrl);
    const rendererModuleUrl = '/track-renderer.ts';
    const { buildRoadStripVertices } = await import(rendererModuleUrl);
    const track = createOvalTrack();
    const { positions, indices } = buildRoadStripVertices(
      track,
      { side: -1, offset: 0 },
      { side: 1, offset: 0 },
      0.03
    );
    let minimumUp = Infinity;
    for (let index = 0; index < indices.length; index += 3) {
      const a = indices[index] * 3;
      const b = indices[index + 1] * 3;
      const c = indices[index + 2] * 3;
      const ax = positions[b] - positions[a];
      const az = positions[b + 2] - positions[a + 2];
      const bx = positions[c] - positions[a];
      const bz = positions[c + 2] - positions[a + 2];
      minimumUp = Math.min(minimumUp, az * bx - ax * bz);
    }
    let maximumEdgeError = 0;
    for (let index = 0; index < track.samples.length; index++) {
      const current = track.samples[index];
      const next = track.samples[index + 1];
      const s = current.s + ((next?.s ?? track.totalLength) - current.s) * 0.37;
      const frame = sampleTrack(track, s);
      const edges: Array<[number, -1 | 1]> = [
        [0, -1],
        [1, 1],
      ];
      for (const [edge, side] of edges) {
        const start = (index * 2 + edge) * 3;
        const end = ((index + 1) * 2 + edge) * 3;
        const x = positions[start] + (positions[end] - positions[start]) * 0.37;
        const z =
          positions[start + 2] +
          (positions[end + 2] - positions[start + 2]) * 0.37;
        maximumEdgeError = Math.max(
          maximumEdgeError,
          Math.hypot(
            x - frame.x - frame.nx * frame.halfWidth * side,
            z - frame.z - frame.nz * frame.halfWidth * side
          )
        );
      }
    }
    return {
      first: positions.slice(0, 6),
      last: positions.slice(-6),
      minimumUp,
      maximumEdgeError,
    };
  }, moduleUrl);
  expect(metrics.first).toEqual(metrics.last);
  expect(metrics.minimumUp).toBeGreaterThan(0);
  expect(metrics.maximumEdgeError).toBeLessThan(1e-9);
});

test('local geometry overlay is readable after a mobile resize', async ({
  page,
}) => {
  await page.goto('/game.html?debug=track');
  await expect(page.locator('#track-debug')).toBeVisible();
  await expect(page.locator('#track-debug')).toContainText('Curvature');
  await page.locator('#start-button').click();
  await page.screenshot({
    path: `test-results/canonical-track-${test.info().project.name}.png`,
  });
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(page.locator('#race-canvas')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});
