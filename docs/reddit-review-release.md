# Unlisted Reddit review submission

The intended player launch is `the-daily-lap` on public r/theDailyLap. App
Directory listing is not requested. Reddit's [launch guide](https://developers.reddit.com/docs/guides/launch/launch-guide)
distinguishes default unlisted review submission from `publish --public`, which
requests directory listing. The [FAQ](https://developers.reddit.com/docs/guides/faq)
also distinguishes review from later installation.

## Prepared workflow, not a submitted or approved app

**Release The Daily Lap** (`devvit-release.yaml`) is manual.
Keep its definition on main for dispatch availability and promote tested source
through a PR into exact protected `release/daily-lap`. Its active rule requires
PRs and strict `check`/`browser` from GitHub Actions app 15368, has no bypass actors,
and blocks force pushes/deletion. Main remains unprotected. This workflow changes
no branch/ruleset setting.

Do not dispatch until the release owner has reviewed scope, readiness and exact-source
green CI. Inputs are an unused stable `version` (`major.minor.patch`) and
`confirm_review_submission=true`, explicitly consenting to source upload and
unlisted review. That checkbox defaults to false. The older private upload/install
workflow is removed; this is the one maintained
release path.

Both jobs check out the dispatched SHA. Dependencies, checks and the build run
without the Devvit secret. Only the submission step references the existing
repository secret `DEVVIT_AUTH_TOKEN`; no GitHub Environment is used. Repository
writers remain trusted with this repository-scoped secret. Setup/tests never
access or test the actual credential.

## Verified pinned CLI contract

Installed `devvit`/`@devvit/cli` 0.15.4 source was inspected without authentication:

- `publish --version <exact-version>` creates a version and submits a request with
  `AppPublishRequestVisibility.UNLISTED` by default. The wrapper passes neither
  `--public` nor `--withdraw`, and invokes no installation command.
- Publishing uploads source. Manual consent enables the CLI's
  `DEVVIT_ALLOW_SOURCE_UPLOAD=1` behavior in that child process only. SDK auth
  state is explicitly kept outside the uploaded project/source archive.
- The CLI can create/install a default playtest community if `dev.subreddit` is
  missing. The wrapper supplies fixed `theDailyLap` only in the temporary publish config
  and child environment, suppressing that branch. This does not invoke an
  installation. The tracked config has no dev-community default; npm development
  is local and the private upload alias is removed.
- Build hooks are removed from the temporary config; the real build already ran
  without the secret. Current custom-post/Redis-only capabilities are required;
  additional capabilities require re-verifying the publish contract.
- Raw CLI output is captured and withheld. Exit zero alone is insufficient: the
  wrapper requires the pinned custom-post confirmation emitted after submission.
  The fixed receipt records exact app/version/SHA and states approval is pending.

Temporary config/auth state is removed on normal success/failure. A failure can
still leave an uploaded version or request; inspect the Developer Portal before
retrying. The flow never retries, withdraws, changes version automatically,
installs or uninstalls an app.

## Readiness and public cutover remain separate

The player/reviewer README describes controls, entry points, automatic posting,
storage and migration. Local/hosted browser checks cover the launch screen and
responsive game. They do not establish physical-phone behavior, multiple real
account roles, new-app registration/ownership, accepted terms or review status.
Record those outcomes and obtain the release owner's readiness decision before submission.

The launch guide requires mobile/web and account-role testing, app documentation
and a custom game first screen. The pinned CLI sends custom-post apps for review
and returns before making them an approved installable version. Verify the exact
version's approval and target eligibility before any public installation.

Leave the legacy app, data, posts and `release/legacy-publisher-pause` untouched.
Installing the new app would trigger daily-post creation. Do not install alongside
an active legacy publisher. A separate authorized cutover must verify a legacy
publisher pause and a tested way to pause the new publisher and restore the old
known version on rollback. Uninstalling legacy can discard data and is not a
reversible rollback plan. No cutover is performed by this workflow.

`npm run test:release` uses dummy auth and a mocked publish executable to check
guards, exact version/default unlisted behavior, source consent, outside-project
auth, no installation, early-exit/failure handling and cleanup. It checks installed
CLI source and workflow pins without any Devvit network call or real session.

## Supported public launch and updates

For every launch/update, submit a new exact stable version for review, verify its
approval and eligibility, then separately install that approved exact version on
r/theDailyLap through the supported owner/moderator interface or pinned CLI
(`devvit install theDailyLap the-daily-lap@<approved-exact-version>`). Do not use
`latest`. Installation is not automated by this workflow and is not authorized
while readiness/review/cutover checks remain pending. Updates maintain this one
app; existing live service stays in place until a replacement is ready and
publicly verified. No removal, data wipe or parallel private installation is part
of that maintenance path.

The public Developer Portal app page was not accessible through the available
read-only web tool. Current new-app ownership, approval and live installation
remain unverified; do not infer any of them from source or green GitHub checks.
