# Reddit Racer

A bite-sized daily arcade racer for Reddit, built from the official Devvit Web / Three.js starter. Hold to accelerate, release to slow, and learn the fastest line around a shared daily circuit. The registered Devvit app remains `full-throttle-dev`.

Practice tracks now generate varied elevated circuits, including a speed-dependent jump and rolling hills, with faster arcade handling. Practice laps continue automatically. Existing daily courses keep their original rules and records; newly created UTC days use the new generator. See [elevated circuits](docs/elevated-circuits.md) for local previews, validation and compatibility details.

## Development

Use Node **24.22.2** (`nvm use` with the committed `.nvmrc`) and npm. Devvit executes backend code in its managed Node 22 environment; local tooling uses the pinned Node version.

```sh
npm ci
npm run dev:local
```

Open http://localhost:5173/game.html in a desktop browser. For a phone on the same Wi-Fi, use the network URL printed by Vite. Local play is explicitly **LOCAL / UNRANKED** and does not impersonate Reddit authentication or write ranked results.

```sh
npm run dev          # official Devvit private playtest
npm run build        # production client and server
npm run type-check   # TypeScript
npm run lint
npm run test:unit
npm run test:e2e     # browser regression checks (install browsers below)
npm run tracks:check # 200 fixed-seed geometry + driving quality checks
npm run balance:check # explicit frozen 22-course controller/replay evaluation
npm run check        # formatting, types, lint, units, 200-track quality, build
```

For Reddit playtesting, run `npm run login` once if credentials are unavailable, then `npm run dev`. This starts the Devvit watch session: saved changes are built and installed as development versions, and logs stream in the terminal. Stopping the watcher leaves its last test version installed; it does not restore a previously installed build.

The private test subreddit is `r/full_throttle_dev_dev`; a developer account needs access to that subreddit and app. Follow the CLI's test-post link, or open [the original test post](https://www.reddit.com/r/full_throttle_dev_dev/comments/1xtz9oc/fullthrottledev/) or [the moderator-created daily post](https://www.reddit.com/r/full_throttle_dev_dev/comments/1xu6n05/reddit_racer_daily_time_attack/) while signed in with access. If Reddit redirects to login, use its normal sign-in flow. Once the automatic-daily build is installed, the server prepares the current UTC post on installation/upgrade and checks it every five minutes. The moderator menu's **Create today's race** action opens the existing healthy post or safely creates the missing one. [Automatic daily availability](docs/daily-race-availability.md) describes private scope, scheduling and recovery.

For a reproducible private build, choose a new unused version and upload/install that exact version after checks pass. The value below is an example for the next upload, not a claim that it has been tested:

```sh
RACER_TEST_VERSION=0.0.19
npm run check
npx devvit upload --version "$RACER_TEST_VERSION"
npx devvit install full_throttle_dev_dev "full-throttle-dev@$RACER_TEST_VERSION"
```

An explicit install does not run the development watcher. To reinstall the current fixed-camera countryside build `0.0.18` instead:

```sh
npx devvit install full_throttle_dev_dev full-throttle-dev@0.0.18
```

These commands upload an owner-visible build and install it only in the existing private test community. They do not publish the app or change community privacy. Keep the app identifier `full-throttle-dev` unchanged.

The [November 14 phone-test post](https://www.reddit.com/r/full_throttle_dev_dev/comments/1xvnujw/reddit_racer_daily_time_attack/) loads the installed test build, including the fixed camera, countryside, minimap and integrated course features. Open it on your phone while signed in with access to the test community. [Hosted observations](docs/hosted-playtest.md#2026-11-14-spring-countryside-and-circuit-minimap) record the source version and verified lap.

On 2026-11-12, private build `0.0.6` completed actual authenticated races, preserved a personal best across a full post reload and kept it after a slower retry. Build `0.0.7` checked the updated results UI and moderator post creation/navigation; `0.0.8` verified a full run with the Kenney car and chase camera, `0.0.9` rechecked the subsequent drawing-cost fix, `0.0.10` checked sound/motion activation, authenticated finish, Retry and focus cleanup; and `0.0.11` verified the simpler clock-only driving UI, collapsed Settings and a fresh ranked finish/retry. Build `0.0.12` checked continuous generated practice, New track and restoration of the original archived daily course; `0.0.13` observed automatic upgrade creation, two genuine scheduled checks reusing that post, archive-to-today navigation and a new verified November 13 standing. [Hosted playtest evidence](docs/hosted-playtest.md) records the exact sources, account, results, screenshots and remaining acceptance matrix. These observations include Reddit's mobile preview; they do not establish physical-phone performance. Logged-out in-game play is not proved by a private community's access gate, and hosted network-error/replay-rejection/archive checks remain open under #20. Current results and remaining work are in [the progress log](docs/implementation-progress.md).

Read private server logs with:

```sh
npx devvit logs full_throttle_dev_dev full-throttle-dev --since 30m
```

`npm run deploy` builds/checks and uploads a **private** Devvit version. Do not run `devvit publish` or submit for general app review. Private upload/playtesting is sufficient for the hackathon development workflow. Never commit credentials.

For automated browser checks, install the pinned Playwright browser runtimes once:

```sh
npx playwright install chromium webkit
npm run test:e2e
npm run test -- src/shared/simulation.test.ts  # one isolated test file
```

Linux CI uses `npx playwright install --with-deps chromium webkit`. Rendered gameplay checks cover desktop and mobile-sized Chromium; pure authoritative replay fixtures additionally run in WebKit. These checks do not substitute for a physical phone or hosted Reddit test.

CI has two jobs on pushes and pull requests: `check` runs every unit test on Node 22.23.5, then the pinned Node 24 format/type/lint/unit/build checks and 200 classic plus 200 elevated circuit validations; `browser` runs 29 tagged smoke cases covering desktop/mobile driving, touch, interruption, scenery, minimap, ranked submission and cross-browser replay agreement. Both jobs must pass when reviewing a change. Browser tests use one worker and no retries, with the existing CI time budgets.

The complete browser suite runs weekly on Sunday at 16:00 UTC and through **Actions → CI → Run workflow → Run the complete browser suite**. Run the smoke selection locally with `npm run test:e2e -- --grep @smoke --workers=1`, or use `npm run test:e2e` for all cases. Failure screenshots, captured gameplay stills, per-test JSON results and circuit reports are retained for seven days. [Validation coverage and evidence boundaries](docs/validation.md) maps the checks to their source files and explains the clock controls.

The main game uses a fixed oblique follow camera, uniform asphalt/grip and predictable centreline routing. Jumps and overpasses are integrated into ordinary daily/practice generation; there are no separate stunt or slot modes. [Current routes and driving rules](docs/predictable-routes.md) explain the intentional pre-release competition reset and show actual renders.

The shared simulation runs at 120 Hz with versioned input replays; see [simulation rules](docs/simulation.md) and [canonical geometry](docs/track-geometry.md), and [lap lifecycle/checkpoints](docs/race-rules.md).

Inspect procedural courses at http://localhost:5173/track-gallery.html while `npm run dev:local` is running. Enter a seed or generate up to 300 SVG previews. The gallery is excluded from the Devvit production build. Grid cards show structural previews. Check a selected course with the real shared simulator, then use Drive selected seed for local unranked practice. The default local game retains the reference oval. Choose **Practice tracks** for generated circuits with continuous flying laps; Settings offers **New track** and **Daily race**. Practice has no leaderboard and does not stop at the finish line. Open `/game.html?practice=1&seed=practice-1` locally to reproduce a course. [Continuous practice](docs/practice.md) documents lap timing, generation and mode changes.

On Reddit, each post loads its permanently bound UTC daily circuit from Redis through tRPC. The complete accepted geometry and race versions are stored; deployments never replace an existing day. Old posts remain unranked practice. Reset messaging follows the server clock, while an already loaded course stays fixed through retries.

Daily attempts request an authenticated session before countdown. After finishing, the server calculates time from the recorded accelerator inputs using the stored course and shared simulation. The result stays unverified until the server accepts it. Signed-out or unavailable verification can continue as clearly labelled practice. See [ranked verification](docs/ranked-verification.md) for expiry, idempotency, rate limits and the explicit limitation that valid input replays do not prove human play. #20 tracks the remaining hosted conditions and final UI.

Verified results update one personal best per Reddit account and UTC challenge. Receipt, personal best and improvement outcome are committed together. Results show the top 20, your current best/place and nearby racers; equal tick times share places (1, 1, 3). The board loads on results or manual refresh, and a board outage does not undo a verified time or block practice. Results remain readable for 90 days; old course geometry remains retained for practice. [Leaderboard storage](docs/leaderboard.md) documents concurrency, bounded reads and recovery. No development records are inserted into the deployed board.

The **Settings** disclosure contains independent **Sound** and **Motion** choices and closes when a new race starts. The race view keeps just the lap clock and a small race-mode label; gates, speed and accelerator/braking text are not displayed. Sound starts from a race or unmute gesture and becomes quiet on interruption. Motion follows the device by default; Reduced clears decorative effects and body lean while keeping the car and braking road visible. Settings have native keyboard behavior and do not add driving controls. [Sound and motion](docs/driving-audio.md) and [pooled driving effects](docs/driving-effects.md) document resource limits and test boundaries.

The finish card puts the result, current personal best/place, this run's improvement and a server-backed target above **Race again**. **Daily standings** expands without another request. The current best can be faster than this run if another attempt already improved it. Network requests have a ten-second deadline: unavailable daily loading offers labelled reference practice, unavailable session preparation keeps the loaded course in practice, and an unconfirmed submission never claims a verified time.

The app-install handler validates JSON and the `AppInstall` event type before creating a post. Invalid requests return 400 without creation; a creation failure returns a fixed 500 response and safe log message. If Reddit already created the post and later metadata repair or link registration fails, the existing creation helper returns that post with a safe warning so opening it can retry binding and current-post registration. These route semantics have automated coverage; they are not a claim of a newly exercised hosted install event.

The moderator menu's **Create today's race** action shares the durable daily coordinator with install/upgrade and the five-minute internal scheduler. Existing healthy posts are reused; unknown submission outcomes stay guarded rather than causing duplicate posts. On first access, older starter posts bind to their trusted Reddit creation date. See [daily challenge storage and rollover](docs/daily-challenges.md) for persistence, fallback and session-expiry policy. `?daily=1` in local development exercises the same daily transport, requiring a connected backend or explicitly mocked test response; it does not create a local fake leaderboard.

Archived posts start practice immediately. A next-day button opens a server-checked current Reddit post when one is registered; otherwise practice and a manual check remain available. Links expire at the returned UTC boundary and never replace the loaded course. [Today's post navigation](docs/today-race-posts.md) documents first-winner registration, trusted URL checks and safe recovery after a post has already been created.

```sh
npm run tracks:check -- --prefix showcase --count 10
npm run tracks:check -- --structural # faster geometry-only inspection
npm run tracks:check -- --report /tmp/racer-tracks.json
```

See [procedural generation](docs/procedural-generation.md) for motifs and [track quality](docs/track-quality.md) for bounded controller checks, thresholds and reports. The separate [frozen evaluation kit](docs/driving-evaluation.md) compares 22 saved geometries without regeneration and includes an intentionally blank human-observation sheet; it does not change the production game.

## Architecture

- `src/client`: Vite / Three.js expanded game and lightweight inline splash.
- `src/shared`: platform-independent deterministic simulation and track definitions; no DOM, Three.js or Devvit imports.
- `src/server`: Hono and tRPC v11 backend with request-local Devvit identity and installation-scoped Redis. Verified times are calculated by replaying input on the server; client times, user IDs and track data are never accepted as ranking authority.
- `assets/3d_models.zip`: supplied Kenney models. Selectively extract useful models; do not serve the entire archive.

The expanded scene uses a locally stored Kenney racer, instanced scenery and generated road/kerb meshes. Its orthographic chase camera fits the upcoming 35 m of road around the HUD; visuals do not change canonical road bounds or racing rules. [Asset selection and ownership](docs/assets.md) records source, CC0, payload sizes, fallbacks and disposal.

Keep heavy rendering dependencies out of the inline splash. Use Devvit client navigation/toasts instead of browser navigation/alerts. The project uses Devvit Web, not Blocks or the legacy public API.

## Daily Games brief

Build a short, intuitive daily experience that inspires collective joy, with fresh calibrated content, a clear visual identity, readable phone layouts, focused gameplay and a useful result/retry loop. Avoid long setup screens and complicated menus. Use contextual instructions and community competition. Instrument supported Devvit Journeys as the real hosted loop becomes available.

The hackathon submission needs an app listing and a working Reddit demo post. A port must use IP the developer owns. Upload and privately playtest during development; public publishing is a separate action and is not authorised in this project. The original brief listed a $35,000 prize pool, including Best Daily Game, Best Ported Daily Game, honourable mentions, helper and feedback awards; consult the official event page for current details.

## Resources

- [Devvit documentation](https://developers.reddit.com/docs/llms.txt)
- [Devvit quickstart](https://developers.reddit.com/docs/quickstart)
- [Official Three.js starter](https://github.com/reddit/devvit-template-threejs)
- [Vite](https://vite.dev/), [Three.js](https://threejs.org/), [Hono](https://hono.dev/), [TypeScript](https://www.typescriptlang.org/)
- [Games on Reddit](https://www.reddit.com/r/GameOnReddit/), [Devvit community](https://www.reddit.com/r/Devvit/)
- [Daily Games hackathon](https://redditgameofday2026.devpost.com/)

See [implementation progress](docs/implementation-progress.md) for merged work, decisions, validation and remaining blockers.
