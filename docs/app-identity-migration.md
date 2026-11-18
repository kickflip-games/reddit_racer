# The Daily Lap app identity migration

## Prepared, not deployed

Avi approved replacing the development app identity on 18 November 2026. This
branch targets `the-daily-lap`, with public display name **The Daily Lap**.
Availability and ownership of that slug are **not verified**. No new app has been
created, uploaded, installed, or published. The existing `full-throttle-dev` app,
posts, installations, and stored data remain unchanged.

Reddit explicitly denied automated browser access. Do not work around that denial
through a different session, account, API, or CLI. The owner must create the new
app through Reddit's supported interface, or obtain a supported resolution to the
access restriction, before automated Reddit operations can resume.

## Owner step

Open [Reddit’s app-creation page](https://developers.reddit.com/new), create a new
app with identifier `the-daily-lap`
and set its display name to **The Daily Lap**. If unavailable, stop and choose a
new identifier before updating this branch; changing only the JSON is insufficient.
Do not delete or uninstall `full-throttle-dev` and do not submit either app for
public directory review as part of this preparation.

## What this branch changes

- Devvit and npm package identities target `the-daily-lap`.
- Publication guards use the new exact app identity for the existing authorized
  private test community and public `r/theDailyLap` community. Their IDs, names,
  privacy checks, and trusted SDK validation remain unchanged.
- Scheduler and upgrade tests assert the new identity. The private diagnostic
  smoke test intentionally remains limited to the legacy app; it must not be
  broadened to run on the new public app.
- Gameplay, replay versions, score validation, and Redis key formats do not change.

## Data and cutover boundaries

Devvit Redis is scoped to app and community. A new app does not automatically
inherit old challenges, best times, receipts, or leaderboard history. Do not claim
those have migrated. Keep the legacy app and its posts as the preserved historical
copy. This preparation does not copy, delete, reset, or fabricate any scores.

Installing this app invokes its automatic daily-post bootstrap, and its scheduler
runs every five minutes. Do not install it publicly while the legacy app's daily
publisher is still active without a deliberate handover: the independent stores
could create two daily posts. Prepare a separate legacy update that disables only
its future daily publishing while preserving existing gameplay/data, validate it,
and apply it at cutover. Do not uninstall the old app as a shortcut.

## Release checklist after access is restored

1. Verify new app ownership and exact identifier; align config and guard if needed.
2. Rebase on current main, run `npm run check` and required browser smoke checks,
   and confirm CI for the exact release commit.
3. Upload an owner-visible version to the new app; do not run `devvit publish`.
4. Test in the existing private community. Verify actual app identity, title,
   course load, full authenticated finish, saved time after reload, and retry.
   Leave legacy test posts/data intact and distinguish new-app scores.
5. Validate and apply the non-destructive legacy publishing pause. Install the new
   exact version in `r/theDailyLap`; verify one new daily post and scheduler reuse.
6. Update the welcome/play links to the verified new post. Explain that rankings
   start fresh under the new app while historical records stay with the old app.
7. Record actual app/version/commit/post links and test outcomes; retain rollback
   information. If the new install fails, restore the old publisher, not old data.

No network availability check or Reddit action is part of the local tests.
