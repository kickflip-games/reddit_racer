# Implementation progress

## 2026-11-12 — baseline and foundation (#2)

- Inspected all 18 open feature issues, existing dependency PRs #13–19, starter source, configuration and recent commits. No existing feature implementation or user edits found. Main started at `e7e1bd8`.
- Repaired committed README conflict first, preserving setup resources, daily-game design guidance and private upload/playtest distinction.
- Supplied Kenney ZIP audited before adding models; generated road mesh plus selected car/scenery is the chosen approach. See `docs/assets.md`.
- Foundation implemented: standalone local shell, explicit unranked mode, Node-only shared module, reproducible scripts and valid CI. Devvit identifier remains `full-throttle-dev`.
- Hosted Devvit integration, physical phone testing and first-time human observations are pending; local/browser automation will be recorded separately.
- Dependency PRs are left separate for compatibility review. Later issues use some stale dependency numbers: embed/art/effects map to #20/#21/#22.

- Validation: `npm run check` passed; Playwright desktop Chromium and Pixel 7 viewport passed acceleration, progressive braking, complete lap, retry/reset, layout and zero console/page errors. This is scripted local testing, not physical-phone or hosted Reddit proof.
- Inspected the mobile finish screenshot: visible circuit/car, readable HUD, complete result/retry card. Screenshot: `docs/screenshots/foundation-mobile.png`.
- CI first run exposed browser-test wall-time limits on software rendering. Reduced automated screenshot pixel density, retained a full-lap test with a bounded 120-second timeout, and upload browser artifacts even on failure.
- Starter globe textures removed from browser public assets. Three.js bundle size remains a mobile profiling task for #24.

- Merged [PR #26](https://github.com/kickflip-games/reddit_racer/pull/26) as `718bb89`; verified #2 closed. CI run `43134316080` passed on head `69fc739` before squash merge.

## 2026-11-12 — canonical geometry (#5)

- Started from updated main `718bb89` on `hacking/canonical-track-geometry`.
- Implement #5 before #3 so simulation, mesh edges and future replay verification share one distance/curvature/width source.
- Keep authoring math separate from serialized runtime sampling; never use the art mesh as physics authority.
- Implemented validated plain track schema, quantized distance samples, exact road cross-sections, canonical JSON/SHA-256 and independent authoring. Renderer/car/camera now consume it; local `?debug=track` visualizes widths, normals, curvature and checkpoints.
- Validation: `npm run check` passed (7 unit tests). All 8 desktop/mobile Chromium browser checks passed: full lap/retry, Node/browser JSON/hash/sample equality, mesh seam/upward winding/exact edge agreement, debug overlay and landscape resize. Both debug screenshots inspected; mobile capture in `docs/screenshots/canonical-track-mobile.png`.
- Corrected downward triangle winding and exact-multiple floating remainder at the seam during validation. Global road clearance/playability remain #7; this PR does not claim WebKit or hosted/physical-device proof.
- Devvit CLI identity is configured (`devvit whoami` succeeded); no private build uploaded yet. Hosted game/ranking evidence remains pending #20.

- Merged [PR #28](https://github.com/kickflip-games/reddit_racer/pull/28) as `d03c871`; verified #5 closed. CI run `43135537604` passed on `9c79dce` before squash merge.

## 2026-11-12 — fixed-step simulation (#3)

- Started from updated main `d03c871` on `hacking/fixed-step-race-simulation`.
- Replace preview frame-delta driving with a shared 120 Hz simulation, bounded versioned accelerator-transition replays and an interpolated renderer. Keep client/session times non-authoritative.
- Implemented quantized shared simulation and strict bounded replay schema, fixed-step browser driver, input-time synchronization, interpolation, off-road/recovery feedback and visible interruption/retry handling. Test code now has its own TypeScript project so browser and Node test sources are checked too.
- Validation: `npm run check` passed (22 unit tests); 16 browser tests passed, including full desktop/mobile laps, braking/retry, focus/long-gap interruption, geometry checks and exact full-state replay equality in Chromium/WebKit against Node. The 16 shared tests also passed under Node 22 via `npx --package=node@22 node --import tsx --test 'src/shared/*.test.ts'`.
- Frozen reference replays: hold-only 1867 ticks (15.558 s); a half-second lift at ticks 800–860 finishes in 1590 ticks (13.250 s). This numerical control establishes a braking benefit; it is not human balance evidence. The short reference oval is not the final generated content.
- Fixed the test clock to pause between scripted actions; auto-running time under parallel rendering correctly tripped the new gap safeguard. Kept dedicated intentional gap tests. Inspected mobile driving capture `docs/screenshots/fixed-step-mobile.png`.
- Node/Chromium/WebKit replay fixtures pass. WebKit coverage is for pure replay math, separate from rendered-browser and real phone evidence.

- Merged [PR #29](https://github.com/kickflip-games/reddit_racer/pull/29) as `d89ff68`; verified #3 closed. CI run `43137329441` passed on `d1ba8ec` before squash merge.

## 2026-11-12 — hold controls and touch safety (#4)

- Started from updated main `d89ff68` on `hacking/hold-controls-touch-safety`.
- Most handling landed with #3. This focused follow-up releases pointer capture safely on cancel/finish/focus loss, retains throttle/brake feedback while sliding/off-road and suppresses active-race long-press menus/callouts and expanded-page overscroll.
- Added native Chromium touch emulation: hold/release, captured movement, full lap/retry, combined keyboard/touch release orders, cancellation, secondary touches and focus cleanup.
- Validation: `npm run check` passed (22 unit tests); all 19 browser tests passed, including the new native touch-emulation lap, cancellation and capture/combined-input cases. Driving screenshot inspected: `docs/screenshots/touch-driving-mobile.png`. No physics parameters changed; frozen replay results remain identical.
- Capture-loss test first released a pending capture before `gotpointercapture`; corrected the test to establish capture with movement before testing its actual loss. Native cancel and focus cleanup remain independently checked.
- External completion blocker: no physical phone or first-time human participants are available to the agent. Browser touch emulation cannot establish real Reddit phone scrolling, responsiveness or newcomer comprehension. Keep #4 open after its implementation PR; record remaining observations on the issue and continue #8.

- Merged [PR #30](https://github.com/kickflip-games/reddit_racer/pull/30) as `b225eda`; CI run `43138859786` passed on `a4da945`. Confirmed #4 stays open and updated its blocker comment with merge evidence.

## 2026-11-12 — lap lifecycle and checkpoints (#8)

- Started from updated main `b225eda` on `hacking/lap-rules-and-countdown`.
- Added an outer race-rules layer: stationary unscored countdown, ordered sector gates, bounded monotonic progress, valid terminal finish and abandonment. Preserve arcade-v1 physics/numerical fixture times; version replay rules explicitly.
- Checkpoints span the runoff corridor so an off-road mistake cannot leave the automatically steered car permanently behind a required gate. Every forward arc metre still costs simulation time; replay never accepts client position/checkpoint claims.

- Validation: `npm run check` passed (31 unit tests); all 19 browser checks passed, including held countdown with zero score/speed, ordered progress to 100%, full keyboard/touch laps, retry, interruptions and Node/Chromium/WebKit replay equality. Countdown and finish mobile screenshots inspected: `docs/screenshots/lap-countdown-mobile.png` and `docs/screenshots/lap-finish-mobile.png`.
- `fixed-step-v2` identifies the new verifier/lap rules; `arcade-v1` physics and golden hold/lift outcomes remain exactly unchanged. `advanceLapProgress` is an extra trajectory guard; verification still computes every next state through shared physics and never accepts snapshots.

- Merged [PR #31](https://github.com/kickflip-games/reddit_racer/pull/31) as `c35c22b`; verified #8 closed. CI run `43140903751` passed on `49140db` before squash merge.

## 2026-11-12 — procedural circuits (#6)

- Started from updated main `c35c22b` on `hacking/procedural-circuit-generator`.
- Built a deterministic closed periodic spline from driving-motif control groups. Validate accepted road geometry, bound retries and fallback, and expose reproducible seed diagnostics.
- Added a separate local SVG gallery for hundreds of canonical courses; keep it outside the production Devvit entrypoints. Full simulation-based quality gates follow #7 before immutable ranked daily content in #9.

- Initial rounded-polygon layouts had shallow motif geometry; refined one genuine infield U and stronger S controls, then reran all checks. Observed opposing turns are tested at >=140 degrees. Intermediate reserve-radius failure was corrected before committing; failed source was never merged.
- Final validation: `npm run check` passed (39 unit tests, types, lint, format, 200-seed structural CLI, production build); all 22 browser tests passed, including Node/browser seed hashes, safe seed text, 10-course gallery and 200-card inspection. Workshop HTML/code confirmed absent from production output. Inspected `docs/screenshots/generator-gallery.png`.
- Fixed regression set: 200 structurally valid requests, 3 reserve uses (1.5%), 198 distinct hashes/profiles, mean 3.405 attempts, lengths 350.054–499.404m; 484 radius and 6 shoulder-fold candidate rejections. Reserve repetition is explicit.
- Independent real-physics/replay-verified release-window probe on showcase-0…9: 24.233–28.225s, 3–5 lifts, 4.267–8.050s faster than hold. This is a bounded control, not final quality approval or human balance evidence. #7 ships the generalized bot/quality gates.

## Next

Finish and merge #6, then #7 structural/playability quality gates, then #9 immutable UTC challenges. Keep #4 external observations open.
