import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseComposition } from '../../src/client/scenery-profile.ts';
import { generateSceneryLayout } from '../../src/client/scenery-layout.ts';
import { circuitTerrainHeight } from '../../src/client/circuit-terrain.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { sampleTrack } from '../../src/shared/track.ts';

void test('canonical seeds choose all three green compositions reproducibly', () => {
  const names = new Set<string>();
  for (let i = 0; i < 30; i++) {
    const seed = `green-${i}`;
    const profile = courseComposition(seed);
    assert.deepEqual(courseComposition(seed), profile);
    names.add(profile.name);
  }
  assert.equal(names.size, 3);
});
void test('quality changes only thin detail, preserving clustered landmarks and seeded terrain', () => {
  const track = generateElevatedCircuit('green-2').track;
  const full = generateSceneryLayout(track);
  const light = generateSceneryLayout(track, { quality: 'light' });
  assert.deepEqual(light.composition, full.composition);
  assert.deepEqual(light.surface, full.surface);
  assert.deepEqual(light.props, full.props);
  assert.ok(
    full.allPlants.filter((p) => p.region === -2 && p.kind === 'rock').length >=
      8
  );
  assert.ok(
    full.allPlants
      .filter((p) => p.region === -2)
      .every((p) => p.kind === 'rock' || p.kind === 'bush')
  );
  const anchors = full.allPlants.filter(
    (p) => p.region === -2 && p.kind === 'rock' && p.scale > 3
  );
  assert.ok(anchors.length >= 2, 'outcrops have visible boulder anchors');
  assert.ok(
    anchors.every((p) => light.plants.some((q) => q.x === p.x && q.z === p.z))
  );
  for (let i = 0; i < 40; i++) {
    const f = sampleTrack(track, (i / 40) * track.totalLength);
    for (const side of [-1, 1]) {
      const offset = side * (f.halfWidth + 16);
      assert.equal(
        circuitTerrainHeight(track, f.x + f.nx * offset, f.z + f.nz * offset),
        0
      );
    }
  }
});
