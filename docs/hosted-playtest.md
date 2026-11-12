# Private Reddit playtest evidence

## 2026-11-12: authenticated replay and daily standings

- Registered app: `full-throttle-dev`, unchanged.
- Private installation: `r/full_throttle_dev_dev` (`t5_kv7foq`).
- Test post: [1xtz9oc](https://www.reddit.com/r/full_throttle_dev_dev/comments/1xtz9oc/fullthrottledev/).
- Explicit owner-only installed build: `0.0.6`, exact source `93e2d3c5774842c43af383c84aee13f88a4d37af`.
- Account shown by real server standings: `Avivajpeyi`.
- Loaded circuit: 2026-11-12 UTC, eight ordered gates.

The earlier Reddit network-security page cleared on an ordinary reload. Reddit's existing signed-in session redirected normally from its login page. No security challenge, certificate warning or CAPTCHA was bypassed. The post's lightweight teaser loaded, and Play expanded the actual Three.js game inside Reddit.

These checks used normal UI clicks and timed Space holds/releases. There were no injected API calls, mock authentication, altered simulation state or invented standings. The pauses between automation actions are included in race time; these runs test functionality and do not establish optimal times, balance or first-time human enjoyment.

| Check                 | Observed result                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated start   | Server session preparation changed the game to `RANKED · DAILY`, then countdown started.                                                          |
| First complete lap    | All eight gates; `Time verified`, 79.225 seconds, first daily best and rank 1 under the real account.                                             |
| Full post reload      | Reopened teaser and expanded game; started a new authenticated attempt on the same daily circuit.                                                 |
| Second complete lap   | Server verified 43.425 seconds and reported an improvement of 35.800 seconds. The previous 79.225-second best therefore survived the full reload. |
| Standings refresh     | Reloaded server standings retained 43.425 seconds and rank 1.                                                                                     |
| Immediate Retry       | Returned directly to a fresh countdown with time zero and gates 0/8, reusing the loaded scene.                                                    |
| Slower complete retry | Server verified 62.425 seconds while keeping the daily best at 43.425 seconds.                                                                    |

The first run used the desktop expanded view. The refreshed and slower runs used Reddit's owner mobile device preview, not a physical phone. Retry remained visible. Captured console errors were Reddit's outer `redditstatic.com` Sentry module fetch failures; no game-origin console errors were captured.

![Actual first verified result](screenshots/hosted-verified-first-run.jpg)

![Actual result after reload in Reddit mobile preview](screenshots/hosted-verified-after-reload-mobile.jpg)

The independent private storage diagnostic also passed all seven controls, including real adapter create/improve, conflict rejection, sorted reads, expiry and cleanup. See [the diagnostic report](private-redis-smoke.md). It used separate temporary keys and did not seed player standings.

## 2026-11-12: quick-results UI and moderator post creation

Private `0.0.7` was uploaded and installed from exact source `af6d969d7d8de22e04ce15b670f542d0b53e8e49`. The original private post loaded **Race today** without the earlier sign-in claim. An actual authenticated run completed all eight gates and verified at 49.642 seconds. The compact result correctly showed the retained 43.425-second best, rank 1 and this run's 6.217-second slower delta. Expanding **Daily standings** showed the real account once and no duplicate nearby table. Finish focus moved to the result heading.

From the private community's overflow menu, **Create today's race** created [post 1xu6n05](https://www.reddit.com/r/full_throttle_dev_dev/comments/1xu6n05/reddit_racer_daily_time_attack/) and automatically navigated to its valid Reddit URL. The new teaser included the 2026-11-12 UTC date; Play expanded the saved daily course with **Race today**. This exercised the actual moderator endpoint, canonical URL, post creation, metadata and daily loading. It does not establish an archived-post CTA across midnight.

![Actual updated start in Reddit mobile preview](screenshots/hosted-quick-start-mobile.jpg)

![Actual compact verified result](screenshots/hosted-quick-results-mobile.jpg)

![Actual newly created private post](screenshots/hosted-created-post-mobile.jpg)

This source's temporary loading note still said ranked racing was coming soon. The following copy-only correction changes that note to preparing the circuit; it does not change the observed session, score or navigation behavior.

## 2026-11-12: Kenney car, generated kerbs and chase camera

Private `0.0.8` was uploaded and explicitly installed from clean source `965374fc61c7fc4180b9bd8f99fc447f6392126e`. Reopening [post 1xu6n05](https://www.reddit.com/r/full_throttle_dev_dev/comments/1xu6n05/reddit_racer_daily_time_attack/) loaded the `0-0-8` expanded-view URL and its original November 12 daily circuit. The lightweight teaser still loaded independently.

Reddit's owner **Mobile** preview showed the real Kenney racer, themed trees/barriers, generated kerbs and compact backed telemetry. Normal Space holds/releases drove the car through the actual daily turns and an off-road excursion while the orthographic camera kept the car and upcoming road visible. The run completed all eight gates and verified at **50.025 seconds**, preserving the **43.425-second personal best / rank 1** and displaying the correct **6.600-second slower** delta. **Race again** immediately returned to countdown, time zero and gates 0/8 on the same loaded course. The extra unfinished attempt was closed without a second score.

![Actual private Kenney start in Reddit mobile preview](screenshots/hosted-kenney-ready-mobile.jpg)

![Actual private Kenney car and chase camera while braking off-road](screenshots/hosted-kenney-driving-mobile.jpg)

![Actual private verified finish with retained best](screenshots/hosted-kenney-verified-mobile.jpg)

No game-origin errors were captured. The captured error list contained the existing outer Reddit Sentry-module fetch failure. UI automation pauses count toward this run; this is functional hosted evidence, not balance, optimal play, physical-phone performance or first-time human feedback. No mocked identity, API response, score, clock or driver state was injected. This upgrade is not a newly observed AppInstall event. No public publication, review submission or community privacy change occurred.

## 2026-11-12: rendering-cost fix

Private `0.0.9` was uploaded and explicitly installed from clean source `f4facce7798caeefcf564729a72b02050f72d8ef`. The same post expanded at its `0-0-9` URL with the original daily course. The matched flat grass field retained the visible Kenney car, road, props and contact shadow in Reddit's owner Mobile preview.

Normal UI Space holds/releases completed all eight gates at a server-verified **46.392 seconds**, keeping the **43.425-second best / rank 1** and the correct **2.967-second slower** delta. **Race again** returned to countdown, time zero and gates 0/8; the extra unfinished attempt was closed without another score. The captured current error list contained only Reddit's outer Sentry-module fetch failure. This is functional hosted regression evidence, not a measurement of phone FPS, audible sound, balance or optimal play. Automation pauses count toward the run.

![Actual flat-field scene after release](screenshots/hosted-ground-fix-driving-mobile.jpg)

![Actual verified result after the drawing fix](screenshots/hosted-ground-fix-verified-mobile.jpg)

The earlier failed desktop CI run remains recorded in the implementation log. Local checks and this private playtest do not replace the required fresh Linux CI gate. No AppInstall event, anonymous/network-negative/archive case, physical phone or public publication is claimed here.

## Acceptance matrix and current constraints

The current observed private build is `0.0.9`; its source and observations are recorded above. Both linked posts remain in `r/full_throttle_dev_dev`. The matrix distinguishes actual Reddit observations from automated tests and unsuccessful test attempts.

| Acceptance condition                                     | Evidence or current constraint                                                                                                                                                                                                                             | Next action                                                                                                                                                                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A real test post renders the game                        | Observed in `0.0.6` through `0.0.9`, including the new [post 1xu6n05](https://www.reddit.com/r/full_throttle_dev_dev/comments/1xu6n05/reddit_racer_daily_time_attack/).                                                                                    | Preserve the private setup and record a new source/version for later changes.                                                                                                                                                                   |
| Authenticated verification and persistence after refresh | Observed in `0.0.6`: the 43.425-second best survived reload and a slower retry. The `0.0.7` through `0.0.9` results also retained that best.                                                                                                               | No replacement mock evidence is needed for this completed condition.                                                                                                                                                                            |
| Logged-out player can practise inside Reddit             | Not exercised. A logged-out browser cannot enter the current private community; that gate does not test the game's anonymous-practice path.                                                                                                                | Use an authorized signed-out-accessible test surface or a supported Reddit private anonymous-preview capability. Do not change privacy or publish the app to obtain this evidence.                                                              |
| Hosted network-error handling                            | Inconclusive. The offline setting affected Reddit's outer tab but did not reach the separately running game frame. Attaching network controls to that child frame was unsupported. Native browser controls could not be operated while the Mac was locked. | Unlock the Mac and use ordinary browser controls that affect the game frame, or use supported frame-level network control. Observe the game's unavailable/unverified state, restore connectivity and confirm the stored best remains unchanged. |
| Hosted invalid-replay rejection                          | Not exercised. Unit and HTTP tests cover rejection; that is separate from a real hosted negative test.                                                                                                                                                     | With the real authenticated private-post context, send an intentionally invalid replay through the supported transport and confirm rejection with no personal-best change. Do not inject identity, a test clock or a direct score.              |
| Old-post practice and next-day navigation                | Not yet exercised against an actual archived post. Existing November 12 posts first become archives at **2026-11-13 00:00 UTC**.                                                                                                                           | After that time, create the new day's post with the moderator menu, reopen a November 12 post and check its original course, unranked practice and current-post CTA. Do not backdate posts or override the server clock.                        |
| Exact setup and install error semantics                  | Private commands are documented in the README. The install route validates the event before creation and uses fixed safe failures; actual mounted-route tests cover those paths.                                                                           | Keep hosted observations distinct from injected creation tests.                                                                                                                                                                                 |

Reddit's [private-community policy](https://support.reddithelp.com/hc/en-us/articles/360060416112-What-are-public-restricted-private-and-premium-only-communities) limits viewing to moderator-approved members. The official [playtest guide](https://developers.reddit.com/docs/guides/tools/playtest) describes generated playtest communities as private. The game's automated anonymous-practice checks do not remove that platform access restriction.

The existing post-created fallback remains important: once Reddit submission succeeds, later binding, postData repair or current-post registration failure returns the created post with a fixed warning. It does not falsely report that nothing was created. Opening the post retries trusted binding and current-post registration; it does not repeat the SDK postData update. The new install guard handles malformed/wrong event bodies before any creation and reports an SDK creation rejection as a fixed server failure without copying SDK details into the response or log. These changes do not add a test identity, time override or public endpoint.

Keep #20 open while the hosted anonymous/error/archive conditions above remain unexercised or constrained. Private daily posts still use the manual moderator menu; no scheduler is introduced. Physical-phone performance, touch comfort and first-time human playtesting remain separate criteria under #4, #24 and #25. No public publishing, app review submission, privacy change or public launch occurred.
