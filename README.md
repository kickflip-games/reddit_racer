# Reddit Racer

A bite-sized daily arcade racer for Reddit, built from the official Devvit Web / Three.js starter. Hold to accelerate, release to slow, and learn the fastest line around a shared daily circuit. The registered Devvit app remains `full-throttle-dev`.

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
npm run check        # formatting, types, lint, units, 200-track quality, build
```

For Reddit playtesting, run `npm run login` once if credentials are unavailable, then `npm run dev`. The existing private test subreddit is `r/full_throttle_dev_dev`; a developer account needs access to that subreddit and app. Follow the CLI's test-post link, or open [the existing private test post](https://www.reddit.com/r/full_throttle_dev_dev/comments/1xtz9oc/fullthrottledev/) while signed in with access. Use the subreddit moderator menu's **Create today's race** action for a fresh UTC-day post. If Reddit redirects to login, complete its normal sign-in flow; private-community access is required.

On 2026-11-12, private build `0.0.6` completed actual authenticated races, preserved a personal best across a full post reload and kept it after a slower retry. [Hosted playtest evidence](docs/hosted-playtest.md) records the exact source, account, results and screenshots. This includes Reddit's mobile preview; it does not establish physical-phone performance. Standalone mock tests and private storage diagnostics are documented separately. Current results and remaining checks are in [the progress log](docs/implementation-progress.md).

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

The shared simulation runs at 120 Hz with versioned input replays; see [simulation rules](docs/simulation.md) and [canonical geometry](docs/track-geometry.md), and [lap lifecycle/checkpoints](docs/race-rules.md).

Inspect procedural courses at http://localhost:5173/track-gallery.html while `npm run dev:local` is running. Enter a seed or generate up to 300 SVG previews. The gallery is excluded from the Devvit production build. Grid cards show structural previews. Check a selected course with the real shared simulator, then use Drive selected seed for local unranked practice. The default local game retains the reference oval.

On Reddit, each post loads its permanently bound UTC daily circuit from Redis through tRPC. The complete accepted geometry and race versions are stored; deployments never replace an existing day. Old posts remain unranked practice. Reset messaging follows the server clock, while an already loaded course stays fixed through retries.

Daily attempts request an authenticated session before countdown. After finishing, the server calculates time from the recorded accelerator inputs using the stored course and shared simulation. The result stays unverified until the server accepts it. Signed-out or unavailable verification can continue as clearly labelled practice. See [ranked verification](docs/ranked-verification.md) for expiry, idempotency, rate limits and the explicit limitation that valid input replays do not prove human play. #20 tracks the remaining hosted conditions and final UI.

Verified results update one personal best per Reddit account and UTC challenge. Receipt, personal best and improvement outcome are committed together. Results show the top 20, your current best/place and nearby racers; equal tick times share places (1, 1, 3). The board loads on results or manual refresh, and a board outage does not undo a verified time or block practice. Results remain readable for 90 days; old course geometry remains retained for practice. [Leaderboard storage](docs/leaderboard.md) documents concurrency, bounded reads and recovery. No development records are inserted into the deployed board.

The moderator menu's **Create today's race** action creates a post for the current UTC circuit. There is no recurring post scheduler yet. On first access, older starter posts bind to their trusted Reddit creation date. See [daily challenge storage and rollover](docs/daily-challenges.md) for persistence, fallback and session-expiry policy. `?daily=1` in local development exercises the same daily transport, requiring a connected backend or explicitly mocked test response; it does not create a local fake leaderboard.

```sh
npm run tracks:check -- --prefix showcase --count 10
npm run tracks:check -- --structural # faster geometry-only inspection
npm run tracks:check -- --report /tmp/racer-tracks.json
```

See [procedural generation](docs/procedural-generation.md) for motifs and [track quality](docs/track-quality.md) for bounded controller checks, thresholds and reports.

## Architecture

- `src/client`: Vite / Three.js expanded game and lightweight inline splash.
- `src/shared`: platform-independent deterministic simulation and track definitions; no DOM, Three.js or Devvit imports.
- `src/server`: Hono and tRPC v11 backend with request-local Devvit identity and installation-scoped Redis. Verified times are calculated by replaying input on the server; client times, user IDs and track data are never accepted as ranking authority.
- `assets/3d_models.zip`: supplied Kenney models. Selectively extract useful models; do not serve the entire archive.

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
