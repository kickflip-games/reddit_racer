import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSceneryLayout,
  sceneryClearance,
  createRoadField,
  SCENERY_LIMITS,
} from '../../src/client/scenery-layout';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator';
import { hashTrack } from '../../src/shared/track';

test('consecutive course seeds retain four scenic pockets within bounded safe scenery', async () => {
  for (let seed = 0; seed < 100; seed++) {
    const track = generateElevatedCircuit(`landmarks-${seed}`).track;
    const before = await hashTrack(track);
    const layout = generateSceneryLayout(track);
    const field = createRoadField(track);
    assert.ok(
      layout.props.every((p) => p.kind === 'treeSmall'),
      `${seed}: no artificial meadow clutter`
    );
    assert.ok(
      layout.allPlants.every((p) => p.kind !== 'fence'),
      `${seed}: no disconnected fences`
    );
    for (let sector = 0; sector < 4; sector++) {
      const pocket = layout.plants.filter((p) => p.region === -10 - sector);
      assert.ok(
        pocket.length >= 4,
        `${seed}: sector ${sector} needs a recognizable group, got ${pocket.length}`
      );
      const anchor = pocket[0]!;
      const progress = field.sample(anchor.x, anchor.z).s / track.totalLength;
      assert.ok(progress >= sector / 4 && progress < (sector + 1) / 4);
      for (const p of pocket.filter((p) =>
        ['rock', 'blossom', 'bush'].includes(p.kind)
      ))
        assert.ok(sceneryClearance(track, p.x, p.z, p.radius, field));
    }
    assert.equal(await hashTrack(track), before);
    assert.ok(layout.work.candidates <= SCENERY_LIMITS.candidates);
    assert.ok(layout.plants.length <= SCENERY_LIMITS.plants);
    assert.ok(layout.props.length <= SCENERY_LIMITS.props);
  }
});
test('light quality preserves all scenic pockets and identical placement', () => {
  const track = generateElevatedCircuit('landmarks-light').track;
  const full = generateSceneryLayout(track);
  const light = generateSceneryLayout(track, { quality: 'light' });
  assert.deepEqual(
    full.plants.filter((p) => p.region <= -10),
    light.plants.filter((p) => p.region <= -10)
  );
  assert.deepEqual(full.props, light.props);
});
