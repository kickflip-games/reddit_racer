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

- Merged [PR #32](https://github.com/kickflip-games/reddit_racer/pull/32) as `ad092a1`; verified #6 closed. CI run `43145526452` passed on `524a3b6` before squash merge.

## 2026-11-12 — track quality and playable seeds (#7)

- Started from updated main `ad092a1` on `hacking/track-quality-and-playable-seeds`.
- Added real shared-rules hold/cautious/bounded fast controllers, replay rechecks, smoothness/clearance gates and versioned acceptance thresholds. Generation caps structural candidates and quality assessments separately; reserve must pass the same quality policy.
- Local gallery checks selected driving quality and opens the accepted seed in the game. DEV-only async loading prevents early Start; production seed queries cannot select/recompute a course. Retry keeps the loaded track; generated previews omit reference scenery.
- CLI now defaults to full quality over 200 fixed seeds, retains `--structural`, reports requested/total assessment counts separately, continues after individual failures and exits nonzero with a complete failure report.
- Quality winning tapes are developer/server diagnostics; the future public daily challenge response must omit solver tapes. This is automated rule/difficulty evidence, not human fun or device performance proof.

- Validation: `npm run check` passed on final code (47 unit tests including 200 approved seeds, types/lint/format, full quality CLI, build). All 31 browser tests passed, including selected quality/candidate hash, generated-course input replay with exact Node finish ticks, retry, rejection loading state and generated replay equality in Chromium/WebKit. Production output excludes gallery/quality search. Inspected approved workshop and mobile driving screenshots.
- Full CLI report saved with all 200 records/zero failures and CI now uploads it with browser evidence. Result: 3 reserves (1.5%), 198 distinct courses/profiles, mean 3.425 requested structural candidates; fast 22.550–30.208s, 3–6 meaningful lifts, gains 3.775–8.433s. Requested quality average 0.99; reserve-inclusive average 1.005. Machine-specific elapsed time is not phone/hosted performance evidence.
- Screenshots: `docs/screenshots/approved-gallery.png`, `docs/screenshots/generated-driving-mobile.png`. Bot outcomes are developer diagnostics; none are inserted into a production leaderboard.

- Merged [PR #33](https://github.com/kickflip-games/reddit_racer/pull/33) as `5708c1b`; verified #7 closed. CI run `43150201623` passed on `1db04af`, including all browser checks and uploaded quality report.

## 2026-11-12 — immutable daily challenges (#9)

- Started from updated main `5708c1b` on `hacking/immutable-daily-challenges`.
- Persist the complete accepted canonical course, hashes, UTC window, versions, initial conditions and acceptance configuration. Atomic hash insertion plus winner read-back prevents competing requests or deployments from replacing an existing day.
- Bind posts permanently using trusted Reddit creation time; handle a post creation crossing midnight by updating its small public metadata after binding. Old posts offer practice. A loaded course stays fixed across reset and retries.
- Added Hono/tRPC v11 transport, removed unused starter counter/forms, and explicitly enabled Redis. Client-provided dates/posts/geometry cannot select the bound daily record. Public data excludes quality search solution tapes.
- Daily post creation remains a moderator action; recurring posting is deferred to hosted setup. Registered app identity remains `full-throttle-dev`. No upload or hosted validation is claimed in this step.
- Validation: `npm run check` passed (63 unit tests, types/lint/format, 200 approved seeds and production build); all 47 browser checks passed. Node 22.23.5 passed 26 daily/API/simulation/replay tests. Installed Devvit configuration parsing confirmed the menu, trigger, entrypoints and Redis permission without uploading.
- Atomic storage controls race different candidate courses and require every caller to return the persisted winner. Tests also cover deployment reuse, original post date, midnight during generation/in-flight expiry, reserve failure, stale quality approval, corrupt records and unconfirmed writes. New record creation rechecks the copied road against its exact quality policy; stored reads do not rerun generation or bots.
- Inspected mobile current/archive screenshots: `docs/screenshots/daily-challenge-mobile.png` and `docs/screenshots/archive-practice-mobile.png`. These use explicitly mocked daily transport and real local rendering; they are not hosted or physical-phone evidence. Production client excludes generator/solver code and the splash stays independent of Three.js/tRPC.

- Merged [PR #34](https://github.com/kickflip-games/reddit_racer/pull/34) as `2654aba`; verified #9 closed. CI run `43153085617` passed on `9c7ca28`, including all 47 browser checks and uploaded quality report.

## 2026-11-12 — authenticated replay sessions (#10)

- Started from updated main `2654aba` on `hacking/authenticated-replay-sessions`.
- Add unpredictable account/post/challenge-bound sessions, strict bounded input replay verification, expiring idempotent receipts and per-account start/verification budgets. The client obtains a session before countdown and reports pending/verified/rejected results without claiming a leaderboard rank.
- Security dependency PRs #19 and #17 are being reconciled and tested in an isolated managed checkout; integrate their successful merges before accepting the submission transport.
- Merged [Hono security PR #19](https://github.com/kickflip-games/reddit_racer/pull/19) as `e479044` after fresh CI `43154864822` passed on `9545366`. Integrated its 4.13.18 patch into the feature branch and reinstalled the locked dependencies. Only the intended package/lock entries changed; current tRPC/test tooling was preserved.
- Merged [Node server security PR #17](https://github.com/kickflip-games/reddit_racer/pull/17) as `4b4220f` after fresh CI `43156124773` passed on `d76bd4e`. Its isolated checks included 47 browsers, 16 Node 22 API/core tests and an actual Node 22 HTTP socket with the current Hono adapter. Fast-forwarded this feature to latest main and reinstalled the lock. The clean dependency checkout was archived after both successful merges.
- TypeScript major-update [PR #18](https://github.com/kickflip-games/reddit_racer/pull/18) remains open: TypeScript 7.0.2 conflicts with `typescript-eslint@8.72.2`'s supported peer range `>=4.8.4 <6.1.0`; its actual `npm ci` failure is documented on that PR. No forced peer workaround was used.
- Read-only Devvit setup check succeeded: account `Avivajpeyi` owns `full-throttle-dev`, installed as `0.0.1.3` in `r/full_throttle_dev_dev` (`t5_kv7foq`). No new build has been uploaded; this is connection evidence, not hosted gameplay or authenticated score proof.
- Keep #10 open until its real Devvit identity acceptance criterion is exercised with #20. Local injected identity and mocked browser responses cannot establish hosted authentication.
- Validation on Hono 4.13.18: `npm run check` passed (88 unit tests, format/types/lint, 200 approved seeds and production build); all 65 browser checks passed. Tests cover bounded HTTP payloads, header/field identity forgery, malformed/oversized replays, expiry, idempotent/concurrent submission, rate ceilings, session preparation cancellation, replay-only finish payloads and late replies after retry.
- Final targeted server validation with both security patches: Node 22.23.5 passed all 41 daily/session/API/rate-limit tests. Copy-only plain-language verification updates passed the two renderer verification cases; inspected refreshed desktop/mobile stills `docs/screenshots/ranked-verified-mock-*.png`. These use mocked transport and real simulation/rendering, not hosted identity evidence.

- Merged [PR #35](https://github.com/kickflip-games/reddit_racer/pull/35) as `d126452` after CI `43157978079` passed on `5542c13` (all 65 browser checks included). #10 remains open for its real browser identity criterion.
- Private platform validation: uploaded the exact clean `5542c13` source using `devvit upload`, which created owner-only version `0.0.2`; explicitly installed that version into `r/full_throttle_dev_dev` successfully. Registered identity is unchanged. No public publishing/review submission occurred.
- Concrete hosted browser blocker: direct Chrome navigation to the configured test subreddit displayed Reddit's “You've been blocked by network security” page. The challenge was not bypassed. Recorded current status on [#20](https://github.com/kickflip-games/reddit_racer/issues/20#issuecomment-6815093722) and [#10](https://github.com/kickflip-games/reddit_racer/issues/10#issuecomment-6815094118). CLI upload/install success does not establish in-game authentication or a verified finish.

## 2026-11-12 — atomic daily leaderboard (#11)

- Started from updated main `d126452` on `hacking/atomic-daily-leaderboard`.
- Add one strict-minimum personal best per authenticated account/day, integer-tick tied ranks, top/own/nearby reads and original per-run improvement outcomes. Commit the receipt, best score and outcome together; retain the original verification response schema for in-flight clients.
- The installed SDK's official mock does not enforce WATCH conflicts. Use a revision-aware transaction fake for deterministic races, and a guarded private upgrade diagnostic to exercise real Redis semantics independently of blocked browser access. Reserve explicit private version `0.0.3` for that diagnostic; no result is claimed before it runs.
- Local validation passed: `npm run check` (123 unit tests, formatting/types/lint, 200 approved circuits and production build), all 71 browser checks, and all 35 competition/adapter/diagnostic/API tests on Node 22.23.5. The first full check stopped on an overly narrow return type in the test double; corrected it without casts and reran the complete check successfully.
- Inspected `docs/screenshots/leaderboard-mock-desktop.png` and `docs/screenshots/leaderboard-mock-mobile.png`: results/PB/tied ranks fit and Retry remains accessible. Screenshots and local board tests use explicitly mocked transport; real identity/gameplay remains blocked under #20. Public production data contains no seeded mock racers.
- Private `0.0.3` probe is next: trusted app/version/home guard; five temporary keys plus one bounded marker; raw unchanged/conflicting WATCH controls, actual adapter create/improve controls, sorted reads/TTL and exact TYPE-based cleanup checks. Upload/install alone will not count as probe success; require actual retained/logged results.
- Private `0.0.3` was uploaded and installed from exact commit `481ea0c`. The probe ran at `2026-11-12T06:01:19.214Z` and **failed**, while confirming unchanged transactions, external-change/competing WATCH aborts and cleanup. Native conflicts throw `Error` code `2` with `redis: transaction failed`; successful sorted-set expiry returned `[3, null]`. The mock's `OK` expiry acknowledgement did not match hosted Redis. The diagnostic also compared sorted row property insertion order rather than semantic member/score values. Correct both before accepting the probe; no new live-player score or authentication proof is claimed.
- Next guarded diagnostic version is `0.0.4`; keep TTL read-back mandatory when accepting null in known EXPIRE reply positions, retain rejection of null SET replies, and compare decoded rows structurally. The five temporary data keys were cleaned; only the bounded per-build diagnostic marker remains.
- Correction validation passed: 125 unit tests, types/lint/format, 200 approved circuits and production build; 37 targeted competition/SDK/API/diagnostic tests passed on Node 22.23.5. Added regressions for null expiry acknowledgements with and without installed TTLs and the hosted score-first member field order. No frontend changed after the 71-browser pass.
- Private `0.0.4` ran from exact commit `55da31f` at `2026-11-12T06:12:14.975Z`: transaction/conflict controls and structural sorted reads passed, cleanup passed, but expiry validation still failed before adapter controls. Do not normalize units or relax deadlines by assumption. Version `0.0.5` adds safe raw expiry observations (fixed labels, numeric values/types and expected clock/deadline only) while leaving adapter checks unchanged.
- Private `0.0.5` from `599c10a` ran at `2026-11-12T06:23:29.883Z`. All transaction/conflict/sorted-read controls and cleanup passed. Expiry checks failed because hosted `expireTime()` returned remaining TTL seconds (`119`, `119`, `119`, `120` for a 120-second deadline), whereas the pinned SDK documentation describes an absolute Unix timestamp. The recorded current clock was `1794464609868` ms and deadline `1794464729698` ms. This establishes the actual unit without guessing. Update the fake and strict deadline-relative validation, then require a new guarded `0.0.6` run to pass the actual adapter create/improve controls before accepting #11.
- Expiry correction validates the observed remaining-TTL contract with strict lower/upper deadline bounds and rejects missing, permanent, short, overlong, nonfinite and epoch-valued results. Round relative EXPIRE upward; allow one second in SDK SET's Date because its installed implementation also floors relative seconds. This prevents premature physical deletion while the core enforces the exact logical retention deadline. Regression tests cover fractional deadlines and mandatory TTL readback.
- Private `0.0.6` from exact commit `93e2d3c5774842c43af383c84aee13f88a4d37af` passed at `2026-11-12T06:39:44.484Z`: unchanged commit, external-change abort, competing-WATCH abort, sorted reads, expirations, actual adapter create/improve and cleanup all returned true. Both adapter mutations confirmed records, score, revision and TTLs. All five temporary data keys were deleted; no real-player leaderboard/account data was written. This is hosted storage evidence, not browser identity or end-to-end gameplay proof.
- Final correction checks passed: 130 unit tests, formatting/types/lint, 200 approved circuits and production build; 42 targeted backend tests passed on Node 22.23.5. All 71 browser checks passed on the unchanged client before these SDK-only corrections; CI will rerun the full suite on the PR.
- Merged [PR #36](https://github.com/kickflip-games/reddit_racer/pull/36) as `d3b4d3278f636c8ed8a3a537fdec6612ad7ee2c9`; verified #11 closed. CI `43169967348` passed on `cbe7ef8395935c97bf25990fb097cae5dcbe5ccb`, including all 71 browser checks and uploaded validation artifacts (26m58s total).
- The browser blocker cleared on an ordinary reload and Reddit's existing owner login redirect. The actual private post `1xtz9oc` rendered the teaser and expanded game. Real authenticated Space-input runs verified at 79.225s, then 43.425s after a full page reload (35.800s improvement); Refresh retained the best, and immediate Retry verified a slower 62.425s while preserving 43.425s. Closed #10 after #36 merged because its real-identity criterion is now exercised. Full details and actual desktop/Reddit-mobile-preview images are in [hosted playtest evidence](hosted-playtest.md). No phone/human-fun claim is made.

## 2026-11-12 — quick race and results UI (#12)

- Started from updated main `d3b4d32` on `hacking/quick-race-results`.
- Correct neutral pre-session daily copy; prioritize verified result, personal best, improvement, nearby target and immediate Retry; keep expanded standings compact and accessible on small screens.
- Add bounded API deadlines and clear practice/error fallbacks. A post-bound, read-only today-post lookup supplies a safe next-day CTA without replacing the loaded course or trusting a caller-supplied URL/date.
- Corrected stale dependency references on #22 and #24 to point to #20/#21/#22 rather than dependency-update PR numbers. Physical-phone and five first-time-human criteria remain open under their original issues.
- Implemented a ten-second request deadline with separate cancellation, cleanup and late-reply handling; pending/rejected/unconfirmed states preserve the distinction from a server-verified finish. Known archived courses skip ranked preparation and begin practice immediately.
- Results put the current server PB/place, original per-run improvement and a faster server rival above Retry. Native collapsed standings require no extra request; duplicate nearby rows are suppressed. Finish headings receive focus instead of a button under a held Space key; actions meet the 44px minimum.
- Today-post pointers use separate first-winner registration/readback and verified live Reddit metadata. Canonical URLs strip the SDK's `t3_` prefix, including the moderator menu redirect. Link expiry is checked on the existing clock update and immediately before navigation. Any failure after Reddit has created a post returns that post with a fixed safe warning rather than encouraging duplicates.
- Fixed a real post-resize drawing-buffer gap by redrawing the renderer in the resize callback. Inspected fresh desktop/mobile/320px screenshots with the road present; mock transport is labelled in their filenames/captions. No driving rules or collision boundaries changed.
- Validation: `npm run check` passed (154 unit tests, formatting/types/lint, 200 approved circuits and production build); all 79 browser checks passed. All 154 unit tests also passed on Node 22.23.5. Tests cover hung/cancelled requests, late replies, archive practice without a ranked call, UTC-expired CTA links, safe post-creation failure handling, input/finish/retry and small-screen access. Production client scan found no private Redis keys, solver tape or asset ZIP.
- After screenshots: `docs/screenshots/quick-start-mock-{desktop,mobile}.png`, `quick-results-mock-{desktop,mobile}.png` and `quick-results-320-mock.png`. These are real local rendering with mocked responses, not additional hosted or phone evidence. Private `0.0.7` validation follows the source commit; no outcome is claimed yet.
- Private `0.0.7`, exact source `af6d969d7d8de22e04ce15b670f542d0b53e8e49`, successfully rendered the revised Race today view and verified an actual 49.642s run, correctly preserving the 43.425s PB/rank 1 and showing the 6.217s slower delta. Native standings expanded without duplicate rows. The real moderator menu created post `1xu6n05`, redirected to a valid URL and opened the same current daily course. Actual screenshots and precise observations are recorded in [hosted playtest evidence](hosted-playtest.md).
- That hosted check exposed one obsolete static loading note saying ranked racing was coming soon. Corrected it to a neutral preparing message; the subsequent targeted local check and fresh PR CI validate this copy-only change. No additional hosted behavior is inferred from it.
- CI `43176903957` on `4f8e0e4` passed unit/type/lint/quality/build checks, then failed one of 79 browser cases: the combined desktop leaderboard scenario exceeded its unchanged 120-second test budget. Its artifact showed the lap already verified, PB/ties displayed and the board error/loading flow reached; 78 other browser cases passed. Do not merge that result.
- Split the overloaded test into a full real-input/exact-replay/PB/ties/error/stale-response/actual-Retry integration case and an explicitly labelled presentation fixture for responsive layout, screenshots, 44px targets and native keyboard disclosure. All original assertions remain; no timeout, retries, production code or CI configuration changed. Full local validation passed again: 154 unit tests, types/lint/format, 200 approved circuits and build, plus all 81 browser checks with two workers. Fresh GitHub CI is still required.

- Merged [PR #37](https://github.com/kickflip-games/reddit_racer/pull/37) as `04da756ae397b390b04321e8641ea1056d9e9e32`; verified #12 closed. CI `43184330586` passed on exact head `348b1841955e7a559c271a8aa8fc09c56d424f23`, including all 81 browser checks and artifact upload (19m13s job, 16m06s browser step).

## 2026-11-12 — runtime regression gates (#23)

- Started from updated main `04da756` on `hacking/runtime-regression-gates`. Promote this shared QA gate before the next production feature so later changes receive automated Node 22 coverage and useful per-test browser timings.
- CI runs the complete unit suite on Node 22.23.5, restores the pinned development runtime, then retains the full check/build/browser gate. Upload JSON durations with existing screenshots and quality report. Cancel only superseded runs for the same PR/ref.
- Six deadline/UTC waits skip idle rendering only after explicit loading/ready/preparing guards. All original assertions and scored-driving/countdown advances remain. No production source or driving rules change.
- Document existing simulation/replay/geometry/server/browser coverage and distinguish local mocks, actual private Reddit evidence, physical phones and human observations. CI also rejects focused browser tests; retries remain explicitly zero.
- Validation: `npm run check` passed (154 unit tests, format/types/lint, 200 approved tracks and production build); all 154 units passed on Node 22.23.5. The eight changed deadline/CTA cases passed, then all 81 browser checks passed with the exact two-worker/line+JSON settings (no skipped, flaky or unexpected results). A temporary outside-repository `test.only` fixture was correctly rejected with exit 1 by the actual CI configuration. Independent diff review found no defects. Fresh Linux CI is still required.
- CI `43187980517` on `cbb6f1c` passed both 154-test runtime suites, formatting/types/lint/quality/build, then failed the attempted two-worker browser layout: 72 passed and nine desktop cases exhausted the unchanged 120-second test budget. Browser time was 20m46s, slower than the prior one-worker 16m06s run; result assertions did not report a score mismatch. Artifacts show interrupted mid-lap/near-finish rendering and retain every attempt. Actual runner CPU/RAM were not logged, so contention is a plausible explanation rather than a measured hardware claim. Do not merge that run.
- Replace concurrent workers with two separate one-worker runner shards, preserving all tests, assertions, the 120-second budget and zero retries. A strict final job still named `check` requires static validation and the entire browser matrix to succeed, rejects cancellation, and cannot silently skip on failed/skipped dependencies. Both shards retain uniquely named, attempt-suffixed artifacts even after failure. Collection proof partitions all 81 cases into 41 + 40, with zero overlap/omission.
- Both exact local shard commands passed: 41/41 in 91.7s and 40/40 in 77.1s, one worker each, no skipped/flaky/unexpected results or retries. Actual result identities match the full 81-case control with no overlap/missing cases; max local case times were 8.173s/6.370s. The final gate's actual shell passed all 16 dependency-result truth-table controls (only success/success accepted), and independent review confirmed supported job/step status conditions and cancellation handling. Formatting and diff checks pass. Fresh Linux CI is still required; local timings do not predict runner or phone performance.

- Merged [PR #38](https://github.com/kickflip-games/reddit_racer/pull/38) as `f16050d219c1a56e4576320c8afa0f102edba5f5`; verified #23 closed. Replacement CI `43193513400` passed on `41dd2c5230b485de8371a345f61354ac421df77d`: both 154-test runtime suites, all 81 browser cases, 200 accepted track records and strict final gate. Three retained artifacts proved a disjoint 41/40 union with no omissions/skips/flakes/retries. Browser steps took 15m27s / 8m52s; max case 94.224s. No safeguard was bypassed.

## 2026-11-12 — private install integration hardening (#20)

- Started from updated main `f16050d` on `hacking/validated-private-install`. Keep #20 open for the remaining real hosted conditions; this focused change references it without claiming those observations complete.
- Validate unknown JSON and the `AppInstall` event type before creating a post. Invalid requests return 400 with zero creation; creation rejection returns a fixed 500 response/log. Mount the tested factory at the existing registered trigger path; app identity/configuration are unchanged. Replace the moderator menu's raw error interpolation with a fixed safe message too.
- Preserve the existing post-created fallback: later metadata/pointer failure returns the already created post. Opening can retry trusted binding/current-post registration, not SDK postData repair. No fake identity, clock or score hook is added.
- Document exact private watch/upload/install commands, both actual test posts and an evidence/next-action matrix. Logged-out access is gated by the private community; the outer-tab offline attempt was inconclusive for the separate game frame, native controls were locked, and the actual posts cannot become archives before November 13 UTC. Local injected tests do not complete those hosted conditions. Manual daily posting remains explicit.
- Validation: `npm run check` passed (158 unit tests, formatting/types/lint, 200 approved tracks and build); all 158 units passed on Node 22.23.5, and all 81 browser checks passed. The initial type check caught Hono's `Response | Promise<Response>` return in the new test harness; normalized it with `Promise.resolve` and reran the complete checks successfully. Mounted-route tests cover invalid/wrong-type bodies without creation, awaited success, safe SDK rejection and wrong methods. The independent patch review passed; fresh CI is required before merge. No new hosted install event or private upload is claimed.

## Next

Finish the actionable #20 hardening, leaving its external hosted conditions open; continue #21 art/camera, #22 feedback, #24 mobile and #25 balance. Prepared asset/camera/feedback plans and baseline/accessibility/balance evidence are under `/tmp` for those later issues. Keep #4 physical-phone/newcomer observations open.
