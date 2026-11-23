# The Daily Lap identity and public cutover

The source targets app `the-daily-lap`, with intended public home r/theDailyLap.
GitHub integration and CI do not verify Reddit registration, ownership, approval
or installation. `full-throttle-dev` is a separate installation with its own
app-scoped data and posts.

The current direction preserves the legacy app and public subreddit while
preparing new-app review. Earlier retirement/uninstall instructions are not the
current cutover plan. Do not uninstall, archive or delete the old app.

## Review before public installation

Use the [unlisted review workflow](reddit-review-release.md) after root/owner scope
and readiness review. It submits an exact version and source for Reddit review,
without an App Directory listing or installation. Do not dispatch the older
private upload/install workflow for the public launch.

The definition remains on unprotected main for dispatch; execution requires exact
protected `release/daily-lap`, explicit source/review consent and the dispatched
SHA. The existing repository secret is scoped to the submission step, with no
GitHub Environment. Repository writers are trusted with that secret. Actual
credentials are neither accessed nor changed by setup/tests.

Reddit access restrictions must be resolved through supported owner/platform
processes. This workflow is not a route around an account or network denial.

## Separate, reversible cutover decision

Before installing any approved version on r/theDailyLap, independently verify:

1. App ownership, exact-version approval and installation eligibility, and the
   installing moderator's permissions.
2. Physical phone and distinct developer/moderator/regular-account behavior on
   that source/version; CI alone does not establish these.
3. Actual legacy installation/version and a tested non-destructive publisher
   pause. Preserve `release/legacy-publisher-pause` and its runbook.
4. A rollback that pauses the new publisher and restores the old known version,
   preserving old records/posts. Uninstall/reinstall does not guarantee this.
5. Only one active publisher before installation; install/upgrade immediately
   prepares today's post, with scheduled checks every five minutes. Record exact
   versions, source SHA and resulting post URLs.

The new app does not inherit old standings. Explain that to players when an
approved cutover actually occurs.

Reddit's [launch guide](https://developers.reddit.com/docs/guides/launch/launch-guide)
describes review/unlisted visibility. Its [FAQ](https://developers.reddit.com/docs/guides/faq)
states publishing does not automatically update installations and warns that
uninstallation can remove data/settings. These repo changes perform no public
Reddit operation.
