import { test, expect } from '@playwright/test';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { serializeTrack } from '../../src/shared/track.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { runReplay } from '../../src/shared/replay.ts';
import {
  HOLD_REPLAY,
  LIFT_REPLAY,
  EXPECTED_HOLD_FINISH_TICKS,
  EXPECTED_LIFT_FINISH_TICKS,
} from '../../src/shared/fixtures/reference-replays.ts';

const replayModuleUrl = `/@fs${new URL('../../src/shared/replay.ts', import.meta.url).pathname}`;
const trackModuleUrl = `/@fs${new URL('../../src/shared/track.ts', import.meta.url).pathname}`;

const generated = generateValidatedCircuit('showcase-3');
const generatedReplay = generated.quality.fastReplay;
if (!generatedReplay) throw new Error('Expected an approved generated replay');

const elevated = generateElevatedCircuit('flow-probe-21');
const elevatedReplay = elevated.quality.fastReplay;
if (!elevatedReplay) throw new Error('Missing elevated fixture');

for (const fixture of [
  {
    name: 'elevated jump',
    replay: elevatedReplay,
    ticks: elevatedReplay.endTick,
    track: elevated.track,
  },
  {
    name: 'hold only',
    replay: HOLD_REPLAY,
    ticks: EXPECTED_HOLD_FINISH_TICKS,
    track: createOvalTrack(),
  },
  {
    name: 'timed release',
    replay: LIFT_REPLAY,
    ticks: EXPECTED_LIFT_FINISH_TICKS,
    track: createOvalTrack(),
  },
  {
    name: 'generated hairpin',
    replay: generatedReplay,
    ticks: generatedReplay.endTick,
    track: generated.track,
  },
]) {
  test(`${fixture.name} replay agrees exactly with Node`, async ({ page }) => {
    // A blank same-origin page isolates authoritative math from WebGL/platform SDKs.
    await page.route('**/runtime-fixture.html', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Replay runtime fixture</title>',
      })
    );
    await page.goto('/runtime-fixture.html');
    const track = fixture.track;
    const expected = runReplay(track, fixture.replay);
    expect(expected.finishTicks).toBe(fixture.ticks);
    const actual = await page.evaluate(
      async ({ replayModuleUrl, trackModuleUrl, serialized, replay }) => {
        const { parseTrack } = await import(trackModuleUrl);
        const { runReplay } = await import(replayModuleUrl);
        return runReplay(parseTrack(JSON.parse(serialized)), replay);
      },
      {
        replayModuleUrl,
        trackModuleUrl,
        serialized: serializeTrack(track),
        replay: fixture.replay,
      }
    );
    expect(actual).toEqual(expected);
  });
}
