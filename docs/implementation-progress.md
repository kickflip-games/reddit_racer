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

## Next

Merge the tested foundation PR, then #3 fixed-step simulation, #5 canonical geometry, #4 handling and #8 lap rules. Begin #23 test infrastructure with each module; do not close it until its full regression coverage exists.
