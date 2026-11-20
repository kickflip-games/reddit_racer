import { test, expect } from '@playwright/test';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { serializeTrack } from '../../src/shared/track.ts';
import { generateValidatedCircuit } from '../../src/shared/circuit-quality.ts';
import { generateElevatedCircuit } from '../../src/shared/elevated-generator.ts';
import { runReplay } from '../../src/shared/replay.ts';
import { generateLinkedCourseCandidate } from '../../src/shared/linked-course-generator.ts';
import {
  createRacingState,
  prepareRace,
  startRace,
  stepRace,
  raceInputTick,
} from '../../src/shared/race-rules.ts';
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

const launchTrack = generateLinkedCourseCandidate('grass-regression').track;
if (!launchTrack) throw new Error('Missing launch fixture');
let launchRace = startRace(prepareRace(launchTrack));
while (launchRace.phase === 'countdown' || launchRace.phase === 'racing')
  launchRace = stepRace(
    launchTrack,
    launchRace,
    raceInputTick(launchRace) >= -120
  );
const countdownReplay = {
  schemaVersion: 2,
  simulationVersion: 'fixed-step-v9',
  handlingVersion: 'countdown-start-v1',
  transitions: [{ tick: -120, held: true }],
  endTick: launchRace.simulation.tick,
};
const retainedBase = generateLinkedCourseCandidate(
  'grass-regression',
  1,
  'linked-circuits-v4'
).track;
if (!retainedBase) throw new Error('Missing retained launch fixture');
const retainedTrack = {
  ...retainedBase,
  generatorVersion: 'linked-circuits-v3',
};
let retainedRace = createRacingState(retainedTrack);
while (retainedRace.phase === 'racing')
  retainedRace = stepRace(
    retainedTrack,
    retainedRace,
    retainedRace.simulation.tick >= 12
  );
const retainedReplay = {
  schemaVersion: 1,
  simulationVersion: 'fixed-step-v8',
  handlingVersion: 'timed-start-v1',
  transitions: [{ tick: 12, held: true }],
  endTick: retainedRace.simulation.tick,
};

for (const fixture of [
  {
    name: 'countdown v9 launch',
    replay: countdownReplay,
    ticks: countdownReplay.endTick,
    track: launchTrack,
  },
  {
    name: 'retained v8 launch',
    replay: retainedReplay,
    ticks: retainedReplay.endTick,
    track: retainedTrack,
  },
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
  test(
    `${fixture.name} replay agrees exactly with Node`,
    { tag: '@smoke' },
    async ({ page }) => {
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
    }
  );
}
