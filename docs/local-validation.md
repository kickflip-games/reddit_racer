# Local validation and short CI

Automatic CI has one `check` job: locked dependency install with lifecycle scripts
disabled, the small release/workflow contract suite (dummy credentials only), type
checking, and a production build. It runs for PRs targeting `main` or
`release/daily-lap`. The existing Sunday 16:00 UTC schedule and manual CI dispatch
remain, and run the same short gate. There is no push trigger, duplicate post-merge
run, automatic browser download, full unit suite or sampled track campaign.

The job has an eight-minute ceiling; expected normal hosted time is roughly one
to two minutes, subject to runner startup and package cache/network speed. Local
and observed hosted timings must be reported separately. Its exact commands are:

```sh
npm ci --ignore-scripts --no-fund
npm run test:release
npm run type-check
npm run build
```

The existing `npm run check`, full Playwright suite, track generators and their
acceptance thresholds are retained. Run heavier checks on the local machine before
requesting release; they are not part of automatic CI or the release job.

## Complete offline checks

From a clean checkout with the Node version in `.nvmrc`:

```sh
npm ci --ignore-scripts --no-fund
npm run check
npm run tracks:check -- --elevated --prefix elevated-regression --report /tmp/daily-lap-offline/elevated-quality.json
npm run courses:check -- /tmp/daily-lap-offline/linked-courses
npx playwright install chromium webkit
npm run test:production -- --workers=1
CI=1 npm run test:e2e -- --workers=1 --reporter=line,json
```

`npm run check` includes formatting, types, lint, the complete unit/release-contract
suites, 200 flat track samples, and build. The next two commands check 200 elevated
samples/jump replays and the 205-seed linked-course population. The production
browser suite serves the built assets. The final command runs every configured
desktop/mobile Chromium and WebKit replay/audio test, rather than only `@smoke`.
`CI=1` here only configures the local test runner; it does not dispatch GitHub CI.
It prevents silently reusing another checkout's Vite server. Ports 5173 and 5210
must be free; stop only servers belonging to this checkout. Browser installation
downloads official local engines and does not create a hosted app or installation.

For the former narrow browser subset, run:

```sh
CI=1 npm run test:e2e -- --grep @smoke --workers=1 --reporter=line,json
```

Backend compatibility can also be checked on the pinned Devvit runtime without
changing package files:

```sh
npx --yes --package=node@22.23.5 --call 'npm run test:unit'
```

Record the checkout SHA, command, result and relevant screenshots/reports. A local
test failure is not overridden by a green short gate. Resolve or explicitly record
its scope before release; physical-device and account-role checks remain separate.

## Required-rule migration

The protected release ruleset keeps its existing `check` context, GitHub Actions
integration ID 15368, strict up-to-date policy, PR requirement, no bypass actors,
and force-push/deletion blocks. Only the required `browser` context is removed.
Main's existing unprotected status is unchanged.

Migration order:

1. Save the live ruleset, prepare and locally verify the short workflow on separate
   branches based on current release and main. Do not move game commits between them.
2. Remove the required `browser` context while the old implementation still exists.
   Keep `check` required throughout, and verify every other rule is unchanged.
3. Open the focused PRs. Their workflow definitions produce the same `check`
   context with the short implementation; no pending retired context strands them.
4. Verify the fast checks on each exact head before merging under the existing
   review requirements. Do not bypass a required approval or use admin merge.
5. Verify both branch workflow files and the live ruleset after merge. There is no
   post-merge push run. Keep source branches for inspection.

If ruleset editing is denied, stop the migration and report it. Do not create fake
success statuses, turn enforcement off, add a bypass actor, or remove `check` to
get a PR merged. A rollback can restore the saved ruleset together with the old
workflow implementation; do not restore a required context with no implementation.

## Short release path

The manual release workflow has one job and no duplicate test job. It requires an
explicit full reviewed SHA equal to the dispatched protected release commit,
rejects tracked edits, installs locked dependencies with scripts disabled, builds,
and applies the existing preflight and exact unlisted-review submission guards.
Its `contents: read` permission, pinned actions, no stored checkout credentials,
fixed app/community, explicit source-upload consent and single secret-bearing
submission step remain. No heavy browser/track/unit suite runs there.

Review the merged source and offline evidence before using the existing dispatch
with `version`, `source_sha` and `confirm_review_submission=true`. This CI migration
does not dispatch it, change any already submitted version, install or withdraw
anything, alter the app's daily publication schedule, or include the timer change.
