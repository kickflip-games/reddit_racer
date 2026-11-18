# Legacy publisher pause release

This branch is for `full-throttle-dev` only. Do NOT merge its app identity into
main, which now targets `the-daily-lap`. Nothing is paused by committing or
uploading this branch: it takes effect only when the owner installs its version.

The publication adapter returns `unavailable` without SDK or Redis calls. All
creation callers share that adapter: scheduled checks and upgrade hooks become
no-ops; moderator creation and a fresh install report unavailable. Existing race
posts, gameplay handlers, replay validation, scores, Redis keys, and leaderboard
code remain unchanged. No data is deleted or copied. Existing posts may still
accept legitimate gameplay writes. The cron remains configured but cannot publish.

## Owner cutover (do not run early)

1. Initialize and privately install/test `the-daily-lap` from main. Complete a
   ranked finish, refresh, and verify saved time. Keep the old app installed.
2. In the Developer Portal record the exact old version currently installed in
   `r/theDailyLap`. This is the rollback version; do not assume a historical one.
3. From this branch run `npm ci`, `npm run check`, then `npx devvit upload`.
   Verify it uploads to **full-throttle-dev** and record the returned pause version.
4. Only when ready for handover, install that exact pause version into the public
   community: `npx devvit install theDailyLap full-throttle-dev@PAUSE_VERSION`.
5. Confirm the installed version and wait through a five-minute scheduler interval
   for any already-running old publisher to settle. Check its logs and existing
   daily posts before proceeding. The pause cannot revoke a request already in flight.
6. Install the exact privately tested new-app version:
   `npx devvit install theDailyLap the-daily-lap@NEW_VERSION`. Verify its post,
   a complete saved finish, and scheduled reuse rather than duplicate publication.
7. If new installation fails and no new publisher is active, restore only the
   recorded old version. If the new app is active, stop its publisher safely first;
   do not leave two publishers active. Never uninstall/delete either app as a shortcut.

Do not use `devvit publish`: directory review is not needed for this cutover.
A prepared branch is not a verified deployment. Reddit operations remain owner
performed while the explicit automated-access restriction is unresolved.
