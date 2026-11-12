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

## Next

Finish and merge #5, then #3 fixed-step simulation, #4 handling and #8 lap rules. Begin #23 regression infrastructure with each module; keep it open until its full cross-runtime, generator and server coverage exists.
