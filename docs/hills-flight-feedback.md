# Raised roads and driving feedback

## Changes

- The single current course generator now adds a smooth 7.4 m ridge with a climb and downhill run, plus a 4 m opening crest. The crest produces a speed-dependent hop; there is continuous road below, not a compulsory gap. Closed-lap seams stay flat. The horizontal motif RNG salt is retained, so this visual/height pass does not arbitrarily reshuffle every word's bends.
- Fixed an invisible-road-extension bug: a car outside an elevated deck used to sample deck height even above visible grass. Current courses fall to the visible level runoff. Returning below a bridge uses gradual recovery rather than teleporting to its top. A car stopped on grass remains grounded.
- Eight pooled pale mint wind streaks follow the car at high speed. Landing dust expands radially and scales with impact. Reduced motion clears these effects.
- Four virtual audio gears produce rising revs, an upshift pitch dip and a short shift clunk/blip. Hysteresis and a half-second dwell prevent gear chatter. No manual gears, control remapping, acceleration changes or airborne shifts.

## Integrity

New course identity is `other-tracks-v3`; contact simulation is `fixed-step-v6`. There is still one generator for new courses. Already stored daily geometry, records and v5 replays are not silently reinterpreted: the frozen prior simulator is retained solely for them. Thus the contact fix applies to new courses; an existing bound daily retains its original behavior until the next new day. Ghosts remain keyed to the full actual geometry hash. No deployment or stored-course overwrite is part of this change.

## Validation

- 433 unit tests pass, including new off-deck fall, under-deck recovery, slope bounds and old-runtime identity tests.
- Formatting, TypeScript, source lint, the existing 200-track check and production build pass. Build retains pre-existing chunk-size and mixed dynamic/static import warnings.
- 28 focused browser checks pass on desktop and mobile-sized Chromium (word courses, replays, VFX/audio and hills). Desktop and mobile-sized Chromium: actual native hold, takeoff, landing and release braking pass for the new word course. The unrelated archive endpoint is stubbed because local Vite has no Devvit server.
- Audio worker: 30 units and ten Chromium/WebKit lifecycle/offline audio tests pass. VFX worker: 16 units and desktop/mobile actual rendered-pixel VFX tests pass.
- A fixed 100-seed new-course campaign accepts 98 courses under unchanged braking-quality gates; 2 fail their bounded gate and are not silently substituted. Accepted fast scripted laps: 43.89–59.90 seconds; zero recoveries, maximum off-road fraction 0.1472. Full attempted results including failures are in `evidence/hills-feedback/course-gates.json`. This is scripted driveability, not human fun or physical-phone performance evidence.

Run the focused actual-browser checks with `node node_modules/@playwright/test/cli.js test --config playwright.hills.config.ts`. It starts its own port 5189 to avoid accidentally testing another checkout already serving port 5173.

No gameplay recordings. No claims of physical-phone performance or subjective audio mixing. No app upload, merge or deployment performed.
