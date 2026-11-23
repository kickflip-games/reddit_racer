# Local development and validation

The maintained app is `the-daily-lap`, intended for public r/theDailyLap.
Normal local development makes no Reddit changes. Use Node 24.22.2 from `.nvmrc`.

```sh
npm ci
npm run dev
npm run check
```

`npm run dev` delegates to `dev:local`. Open the Vite URL for the local game.
Local play is unranked; it does not impersonate a Reddit account or save a ranked
result. There is no default private subreddit or npm private-deploy alias.

CI runs `check` and `browser` for main and release/daily-lap pushes and PRs.
It includes Node 22 backend tests, pinned Node 24 checks, geometry/replay sweeps,
52 production browser cases and 61 smoke cases. Hosted browser cases do not prove
physical-phone performance or distinct real account-role behavior.

```sh
npm run test:release
npm run type-check
npm run lint
npm run tracks:check
npm run courses:check
npm run test:production
npm run test:e2e -- --grep @smoke --workers=1
```

Browser checks need the pinned Playwright runtimes. The only maintained release
entry is the guarded **Release The Daily Lap** GitHub workflow. See
[public release and review](docs/reddit-review-release.md); it makes no automatic
installation and must not be dispatched until readiness and CI are verified.

Prior hosted observations are retained as historical evidence in
[hosted playtests](docs/hosted-playtest.md), not as proof of this release's current
Reddit ownership, approval, install or phone behavior.
