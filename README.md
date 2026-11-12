# Reddit Racer

A bite-sized daily arcade racer for Reddit, built from the official Devvit Web / Three.js starter. Hold to accelerate, release to slow, and learn the fastest line around a shared daily circuit. The registered Devvit app remains `full-throttle-dev`.

## Development

Use Node **24.22.2** (`nvm use` with the committed `.nvmrc`) and npm. Devvit executes backend code in its managed Node environment; local tooling uses the pinned Node version.

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
npm run check        # formatting, types, lint, unit tests, build
```

For Reddit playtesting, run `npm run login` once if credentials are unavailable, then `npm run dev`. The existing private test subreddit is `r/full_throttle_dev_dev`; a developer account needs access to that subreddit and app. Follow the CLI's test-post link. Standalone browser success does **not** establish hosted Reddit integration; verified test-post results and blockers are recorded in [the progress log](docs/implementation-progress.md).

`npm run deploy` builds/checks and uploads a **private** Devvit version. Do not run `devvit publish` or submit for general app review. Private upload/playtesting is sufficient for the hackathon development workflow. Never commit credentials.

For automated browser checks, install the pinned Playwright browser runtimes once:

```sh
npx playwright install chromium webkit
npm run test:e2e
npm run test -- src/shared/simulation.test.ts  # one isolated test file
```

Linux CI uses `npx playwright install --with-deps chromium webkit`. Rendered gameplay checks cover desktop and mobile-sized Chromium; pure authoritative replay fixtures additionally run in WebKit. These checks do not substitute for a physical phone or hosted Reddit test.

The shared simulation runs at 120 Hz with versioned input replays; see [simulation rules](docs/simulation.md) and [canonical geometry](docs/track-geometry.md), and [lap lifecycle/checkpoints](docs/race-rules.md).

## Architecture

- `src/client`: Vite / Three.js expanded game and lightweight inline splash.
- `src/shared`: platform-independent deterministic simulation and track definitions; no DOM, Three.js or Devvit imports.
- `src/server`: Hono backend with authenticated Devvit context and Redis. Future ranked scores are calculated by replaying input on the server, never accepted as client times.
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
