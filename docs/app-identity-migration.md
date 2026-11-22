# The Daily Lap app identity migration

## Prepared, not deployed

The project targets `the-daily-lap` with public display name **The Daily Lap**.
Availability and ownership of the new app identifier have **not been verified**.
The repository's previous `full-throttle-dev` app is a separate installation
and has its own Reddit-scoped Redis data.

On 22 November 2026, the owner authorized **retiring and removing
`full-throttle-dev`**, including discarding its historic leaderboard when
uninstalled. That permission does not mean the old app is already removed.

Reddit previously denied automated browser access. Do not work around that
denial via a different session, account, API, or CLI. The owner must create the
new app through Reddit's supported interface, or obtain a supported resolution
to the restriction, before automated Reddit operations resume.

## Owner step

Open [Reddit’s app-creation page](https://developers.reddit.com/new) and create
the identifier `the-daily-lap` with display name **The Daily Lap**. If the
identifier is unavailable, choose a new identifier and align this repo's
`devvit.json`, npm package identity, and publication guards before deployment.

## What the migration changes

- Devvit and npm package identities target `the-daily-lap`.
- Publication guards use the new app identity for the existing authorized
  private test community and public `r/theDailyLap` community.
- Scheduler and upgrade tests assert the new identity. The legacy private
  diagnostic smoke test must not be repointed at a public app without review.
- Gameplay, replay versions, score validation, and Redis key formats are unchanged.

## GitHub Actions

The `main` branch has a `deploy-private` job in
`.github/workflows/ci.yaml`. The owner added the `DEVVIT_AUTH_TOKEN`
GitHub Actions secret on 22 November 2026.

This job uploads only after `check` and `browser` both pass, and only on a
push or manual run on `main` with the repository Actions variable
`DEVVIT_DEPLOY_ENABLED=true`. With the variable unset, deployment is off.

After app registration and access are confirmed, enable with:

```sh
gh variable set DEVVIT_DEPLOY_ENABLED --body true --repo kickflip-games/reddit_racer
```

To suspend private uploads:

```sh
gh variable set DEVVIT_DEPLOY_ENABLED --body false --repo kickflip-games/reddit_racer
```

The job verifies `devvit.json` targets `the-daily-lap`, authenticates
from the GitHub secret, builds, and runs `npx devvit upload`. It does **not**
publish, install, uninstall, or archive either app. Enabling it is not a
workaround for Reddit's access restriction.

## Data and cutover boundaries

Devvit Redis is scoped to app and community. A new app does not inherit old
challenges, times, receipts, or leaderboard history. Uninstalling the legacy
app can delete its stored data and cause old game posts to stop working.
The owner has accepted that tradeoff; the migration must never claim data
was transferred.

Installing `the-daily-lap` invokes the automatic daily-post bootstrap, and
its scheduler checks every five minutes. Avoid overlapping publishers in
the same target subreddit. Once the replacement has been tested and is
eligible for public installation, uninstall the old app from that community
_before_ installing the new one there.

## Cutover checklist

1. Confirm Reddit access, ownership, and the exact `the-daily-lap` identifier.
2. Confirm tests and GitHub CI pass for the release commit.
3. Upload a private new-app version with GitHub Actions. Do not automatically
   publish or install it.
4. Install the tested new version in the private community and verify course
   loading, authenticated finish, leaderboard persistence, retry, and
   scheduled daily-post behavior.
5. Confirm the new app version is eligible to install into `r/theDailyLap`.
   Public installations may require Reddit's separate publish/review process.
6. Inspect legacy installations with `npx devvit list installs`. At cutover,
   uninstall `full-throttle-dev` from the public target (if installed), then
   install the approved `the-daily-lap` version and verify exactly one daily
   post. Remove legacy private-test installations when no longer needed.
7. Update welcome/play links and disclose that leaderboard rankings start
   fresh under the new app. Archive the legacy app in its Developer Portal
   page. For permanent deletion, contact r/Devvit Modmail (there is no
   documented self-service permanent-delete command).
8. Record the tested app/version/commit/post URLs and test results.

Official [Devvit FAQ](https://developers.reddit.com/docs/guides/faq)
documents uninstall, archive, and account/app deletion options. No Reddit
action is performed by updating these migration instructions.
