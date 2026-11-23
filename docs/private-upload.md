# Private uploads for the existing Daily Lap app

[Upload The Daily Lap Privately](https://github.com/kickflip-games/reddit_racer/actions/workflows/devvit-private-upload.yaml)
is a manual **upload-only** action for the existing `the-daily-lap` app. It creates
a private version/package visible to the app owner. It does not publish or submit
Reddit review, install/upgrade an app, run a playtest, create an app/community, or
change the running race in r/theDailyLap. Uploading is not a private playable
preview by itself; running the package on Reddit would require a separate install.

The workflow is present on both main and `release/daily-lap`. Main is the default
branch, making the action available in GitHub's Actions UI. Actual execution is
locked to a manual dispatch of the exact protected `release/daily-lap` source.
Choosing main in the Run workflow dropdown skips the guarded job and uploads
nothing. No GitHub environment, new credential, private app or test installation
is created. The public [Release The Daily Lap](reddit-review-release.md) action
and the [short automatic CI](local-validation.md) remain separate and unchanged.

## Operator steps

1. Review the intended source and its green short PR check, merge it into protected
   `release/daily-lap`, and copy the **full merged SHA**. Follow the existing local
   validation guidance for the changes being packaged. A source SHA from another
   branch, an abbreviated SHA, or a different dispatch commit is rejected.
2. Inspect the existing app's [versions in the Developer Portal](https://developers.reddit.com/apps/the-daily-lap).
   Choose an **unused exact stable `major.minor.patch`**, newer than the highest
   existing stable version, including private and pending versions. There is no
   default version or automatic bump. Do not reuse the approved `0.0.20261123` or
   pending `0.0.20261124`; this path explicitly reserves both.
3. Open **Actions → Upload The Daily Lap Privately → Run workflow**. Select
   **release/daily-lap**, enter the exact version and full reviewed `source_sha`,
   and tick **confirm_private_upload** only when ready to upload that package.
   The checkbox defaults to false. The equivalent deliberate CLI dispatch is:

   ```sh
   gh workflow run devvit-private-upload.yaml \
     --repo kickflip-games/reddit_racer --ref release/daily-lap \
     -f version="$PRIVATE_VERSION" -f source_sha="$REVIEWED_SOURCE_SHA" \
     -f confirm_private_upload=true
   ```

   Set those variables to the reviewed choices first; this is an operator command,
   not something run during configuration setup.

4. Read the job receipt and inspect the exact version in the portal. The wrapper
   verifies the same existing app ID, owner, exact version and **private**
   visibility. The receipt distinguishes `building` from `ready`; a successful
   upload does not establish that a build has finished or that an install occurred.
5. On any failure, inspect the exact version before retrying. A failed/timed-out
   upload or failed post-upload read can leave a version present. The workflow
   never retries, withdraws a publication, deletes a version, selects another
   number or changes an installation automatically. Authentication/permission
   failures in the read-only preflight stop before upload. The wrapper does not
   invoke a credential setup or app-initialization wizard.

## Shared version namespace

Private uploads and public review submissions use the **same app and version
namespace**. A private build consumes its chosen version number and can become
the highest version returned by `latest`. The public submission wrapper also
creates a new version; do not attempt to publish an already-uploaded private
number through it. Choose another unused exact version for a later public update.
Never use `latest` for an install or rollback. Uploading a newer private package
does not replace the separately pending `0.0.20261124` publication request or the
installed approved `0.0.20261123`.

Both upload and public submission workflows share the existing
`the-daily-lap-release` concurrency group to serialize version creation. The
private wrapper checks credential ownership and candidate absence immediately
before its single upload call. The server remains authoritative about uniqueness;
another external uploader can race this check, so a collision fails rather than
overwriting or bumping to another version.

## Optional in-place install is a separate action

The pinned CLI describes private versions as owner-visible and installable only
to a small community with **fewer than 200 subscribers**. Reddit enforces actual
eligibility and owner/moderator permissions; no subscriber check or installation
was exercised during this setup. Uploading a package does not bypass that limit
or grant access to a private preview.

An optional, separately authorized `devvit install COMMUNITY the-daily-lap@EXACT`
would upgrade an existing installation of this same app in place. It is not part
of this workflow. Choose an already existing eligible target and verify its
installation first; do not remove/reinstall or create a second app/community.
Installing a private build into the current public r/theDailyLap installation
would change the app used by its players, rather than create an isolated preview.
That requires an explicit separate decision and is not authorized by upload alone.

Before any optional install, record the actual previous approved exact version
and check data/replay compatibility. An in-place return to an eligible approved
version may be a rollback option, but it does not undo Redis writes, race posts,
scores, schedules or upgrade-trigger effects. Never assume uninstall/reinstall
is a safe rollback. No rollback was tested or performed here.

## Verified pinned CLI contract and safeguards

Offline inspection of Devvit/@devvit/cli **0.15.4** established:

- `upload --version EXACT` is supported and selects PRIVATE visibility. Omitting
  the version enables automatic bumping, which this wrapper never does.
- Without a Dev target, upload can provision a default playtest community and
  auto-install there. A temporary config supplies the fixed `theDailyLap` Dev
  target solely to suppress those branches. The real pinned project loader sees
  it, and the uploader passes `preventPlaytestSubredditCreation=true`. This is
  not an install target instruction: this path invokes no install command.
- Before invoking upload, read-only CLI checks require the existing app UUID
  `315876cd-0a70-4598-abe9-bff0691630c3` and exact credential-owner match. Missing
  app, wrong account, denied access, occupied version or ambiguous absence stops
  before upload. The CLI is noninteractive and receives no initialization code.
- Build runs first without credentials. Build hooks are stripped from the
  temporary upload config, and no flags enable employee overrides, just-do-it,
  publication, installation, playtest, or source-archive upload. The reviewed
  upload/uploader/initialization source files are hash checked; a changed SDK
  requires a new offline contract review.
- Only the final step receives the existing `DEVVIT_AUTH_TOKEN`. Its serialized
  payload is validated; normal refresh state stays in a private temporary profile
  outside the project and is removed in `finally`. Raw CLI output is captured,
  not printed or uploaded as an artifact. The workflow keeps `contents: read`,
  full action pins, exact SHA checkout and no persisted checkout credentials.

Focused offline verification uses mocked CLI/credentials and the real pinned
parser/project loader. It does not prove live credential validity, successful
remote upload, server eligibility, installability, or rollback. No logged-in
upload or playtest was dispatched to verify this configuration.
