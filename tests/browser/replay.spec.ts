import { test, expect } from '@playwright/test';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { serializeTrack } from '../../src/shared/track.ts';
import { runReplay } from '../../src/shared/replay.ts';
import {
  HOLD_REPLAY,
  LIFT_REPLAY,
  EXPECTED_HOLD_FINISH_TICKS,
  EXPECTED_LIFT_FINISH_TICKS,
} from '../../src/shared/fixtures/reference-replays.ts';

const replayModuleUrl = `/@fs${new URL('../../src/shared/replay.ts', import.meta.url).pathname}`;
const trackModuleUrl = `/@fs${new URL('../../src/shared/track.ts', import.meta.url).pathname}`;

for (const fixture of [
  { name: 'hold only', replay: HOLD_REPLAY, ticks: EXPECTED_HOLD_FINISH_TICKS },
  {
    name: 'timed release',
    replay: LIFT_REPLAY,
    ticks: EXPECTED_LIFT_FINISH_TICKS,
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
    const track = createOvalTrack();
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
