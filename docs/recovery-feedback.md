# Automatic recovery feedback

Player-car automatic recoveries now flash the car at 1.5Hz until the actual simulation says it is ready. A steady warm halo keeps its location legible, including while returning from beneath a raised road. System reduced motion keeps the car and halo steadily visible. Only the player's owned model visibility changes; asset-template and ghost materials stay untouched.

The existing 0.25-second 90→55Hz recovery sound is reused through the existing gesture-unlocked Web Audio owner and saved mute setting. Its trigger now also requires an active recovery with remaining recovery ticks. An increased historical counter after a completed recovery cannot produce a delayed reset sound. Same-tick redraws, grass, flight, ordinary restart, muted recovery and background return do not produce extra recovery sounds.

The visual clock uses authoritative simulation ticks, not a separate timeout. Completion and non-racing phases restore visibility immediately; retry, focus interruption, disposal and model reset explicitly clear the effect. No controls, physics, recovery duration, scoring, server, generation or release configuration changes. The change was authored against verified main `c155dce88db80e011b2c102c4f55fd086661f6b8`, then based on the currently installed release source `e2af8a205695a09ced4ea9e13cba4058b8fdb3ae` for review. Gameplay source is identical between those baselines; four unrelated dependency/check updates from main are excluded. There is no dependency on the unpushed braking-rhythm V7 work.

Local checks on UoA Work Machine (Node 24.22.2):

- 50 focused unit tests: audio ownership/mute, repeated authoritative recoveries, blink cadence, interruption, unchanged simulation state, car asset ownership and ghost isolation.
- Four headless Chrome checks: actual selected car snapshots through on/off/reduced-motion/restored states; repeated real player recoveries and one audible cue per reset; native audio activation/mute/background lifecycle; bounded production offline cue signals and silent tails.
- TypeScript, ESLint, formatting and production build pass. Existing bundle-size/dynamic-import notices remain.
- Real-asset and actual-player screenshots were opened for visual inspection. Audio checks validate the native graph and its signal, not physical-phone speaker audibility or subjective loudness. No physical-device test is claimed.

Focused commands:

```sh
npx tsx --test tests/unit/recovery-feedback.test.ts tests/unit/driving-audio.test.ts tests/unit/scene-art.test.ts tests/unit/ghost-visual.test.ts
npm run dev:local -- --host 127.0.0.1
npx playwright test tests/browser/recovery-feedback.spec.ts tests/browser/feedback-audio.spec.ts --project=chromium --workers=1 --grep 'RECOVERY|OFFLINE race cues|BROWSER AUDIO FIXTURE activates'
npm run type-check
npm run lint
npm run format:check
npm run build
```

The local browser run used the installed Chrome channel against this worktree's Vite server on port 5174, with a temporary Playwright config pointing there. Tests use observation-only module instrumentation in the actual scene; the separate asset fixture supplies labelled synthetic visual frames. Neither creates a hosted app or test installation. Release status is tracked separately from these local results.
