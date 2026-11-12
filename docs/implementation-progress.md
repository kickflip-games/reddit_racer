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
- Add Node/Chromium/WebKit replay fixtures. WebKit coverage is for pure replay math, separate from rendered-browser and real phone evidence.

## Next

Finish and merge #3, then #4 handling/input and #8 lap lifecycle; retain human/physical-device acceptance criteria as explicit pending evidence. Expand #23 tests with each module.
