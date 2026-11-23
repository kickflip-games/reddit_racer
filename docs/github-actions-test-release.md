# Manual private test releases

`.github/workflows/devvit-test-release.yaml` is the future release flow on
GitHub-hosted Ubuntu runners. It uploads **the-daily-lap** privately and installs
only into **r/full_throttle_dev_dev**. It has no push, pull-request, schedule,
public-publish, arbitrary-command, app-name or subreddit input. Deployment is a
manual action from the exact protected `release/daily-lap` branch.
This setup does not run a release or change the legacy app.

## Owner setup before first dispatch

No separate GitHub Environment is required. The workflow references the owner's
existing repository Actions secret **DEVVIT_AUTH_TOKEN**, only in the final
release step. This change does not read, copy, modify or test its actual value.

1. Keep `main` as the unprotected default/development branch. Review and merge
   this workflow patch into `main` first, keeping the dispatchable workflow at
   its existing path on the default branch. The workflow must also be present
   in the selected `release/daily-lap` revision.
2. Only after owner confirmation, establish the exact branch `release/daily-lap` and an
   active no-bypass ruleset for `refs/heads/release/daily-lap`, using the checks below.
   Promote subsequent changes through PRs targeting `release/daily-lap`. Require PRs and
   up-to-date checks, reject force pushes and deletion, and allow no bypass
   actors, including admin-role bypasses. Approval-count policy remains an
   owner decision. This patch changes no branch, ruleset or organization setting.
   Both workflow jobs and the script reject `main`, lookalike refs and an
   unprotected `release/daily-lap`.
3. Keep the existing repository Actions secret **DEVVIT_AUTH_TOKEN**. The pinned
   CLI expects the complete serialized login payload described below, not a plain
   OAuth access token. Its value belongs only in GitHub's secret settings, never
   in chat, source, dispatch inputs, logs, artifacts or PRs. These tests use dummy
   values and never inspect a workstation's token file.
4. Independently confirm the new app exists under its authorized owner, the
   developer account is ready, and it can install into the named private Reddit
   target. App initialization, account setup, subreddit creation and changes to
   Reddit access restrictions are outside this workflow.
5. No release occurs on merge or promotion. Do not dispatch until the approved
   branch setup is complete, the selected source is tested and that specific
   private release is authorized.

GitHub documents [Actions secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions),
[the protected-ref context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context),
and [manual dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatch).

## Required checks for the proposed release ruleset

CI runs for pushes to `main`/`release/daily-lap` and PRs targeting either branch. Both jobs
run on promotion PRs; ordinary CI remains secret-free and cannot release.
Use these exact check-run contexts, verified from the repository's
[successful CI run for PR #108](https://github.com/kickflip-games/reddit_racer/actions/runs/45051994421)
(not the UI's workflow/job breadcrumb):

| Required context | Expected GitHub App | Ruleset integration ID |
| ---------------- | ------------------- | ---------------------- |
| `check`          | GitHub Actions      | `15368`                |
| `browser`        | GitHub Actions      | `15368`                |

For the proposed repository ruleset, target only `refs/heads/release/daily-lap`, leave
`bypass_actors` empty, and enable strict/up-to-date required checks with those
contexts and `integration_id` values. The manual workflow's `validate` and
`release` jobs are not promotion-PR checks and must not be required by this rule.
This is an un-applied proposal pending owner approval, not a claim that a
protected branch or ruleset exists.

## Trust model

Repository writers are trusted with the repository-scoped Devvit secret: they
can edit workflows that reference it. The protected release branch and manual
guards govern promotion and dispatch. The workflow uses the existing
`DEVVIT_AUTH_TOKEN` only in its final release step and uses no GitHub Environment.
No actual token is accessed or tested by this patch or its offline tests.

## Dispatch and exact version

In **Actions → Private test release → Run workflow**, select **release/daily-lap**, enter an
**unused** exact version such as `0.0.123`, and enable the test-install
confirmation. The example is illustrative, not the project's next release.
Aliases (`latest`, `playtest`), prereleases, extra arguments and noncanonical
versions are refused. No version is inferred from `package.json` or CLI text.

The secret-free validation job runs `npm run check`, including the offline
release tests. The release job checks out the same dispatched SHA, installs
locked dependencies without lifecycle scripts, builds without the Devvit secret,
and verifies app, target, source, build outputs and pinned CLI. Its sole
credential-bearing step then runs the pinned local CLI, equivalent to:

```text
devvit upload --config <temporary-config> --version <exact-version>
devvit install --config <temporary-config> full_throttle_dev_dev the-daily-lap@<same-exact-version>
```

`upload` must exit successfully before `install` starts. There is no `publish`
command or automatic public deployment. No `npx` fallback downloads a different
CLI. Explicit `--version` removes the need to parse unstructured upload output or
race a separate `latest` lookup. The temporary config keeps the original app,
permissions, entrypoints and test subreddit while removing build hooks, so the
CLI does not rerun the project build with the secret present. The tracked
`devvit.json` is unchanged.

Commands are noninteractive, bounded and run without shell interpolation. CLI
stdout/stderr are captured and withheld, including on failure, because SDK error
output could contain transformed credentials. Only a fixed app/version/target/SHA
receipt is written to the job summary after both commands succeed. A private
temporary Devvit configuration root contains any SDK refresh-token file; that
root and the temporary app config are removed on ordinary completion/failure.
The GitHub-hosted runner is ephemeral if a job is forcibly interrupted.

A failed or canceled release can still have created its private version,
including when installation fails after upload. The workflow reports failure and
does not switch to another version or claim that upload was rolled back. Inspect that state independently before a
new manual run; a new run requires another unused version. The concurrency group
serializes releases and does not automatically cancel an active release.

## Verified CLI authentication contract

The repository pins both `devvit` and `@devvit/cli` to **0.15.4**. Inspection of the
installed source, plus offline tests with dummy values, establishes:

- `dist/lib/auth/AuthTokenStore.js` checks `DEVVIT_AUTH_TOKEN` before the token
  file. It accepts JSON `{ "token": "<base64 serialized StoredToken>",
"copyPaste": false }` (the normal login-file payload), or the older bare
  base64 serialized token. A plain OAuth access token is not this format.
- `dist/lib/auth/StoredToken.js` expects `accessToken`, `refreshToken`, numeric
  `expiresAt`, `scope`, and `tokenType: "bearer"`. The CLI's auth configuration
  requires its developer `*` scope. Expired payloads may be refreshed by the SDK.
- `dist/lib/config.js` supports `DEVVIT_ROOT_DIR` for isolated temporary auth
  state; no `HOME` override or workstation token copying is needed.
- `dist/commands/upload.js` accepts `flags.version`, creates the version with
  `VersionVisibility.PRIVATE`, and runs `appConfig.scripts.build` if configured.
- `dist/commands/install.js` resolves `app-name@version` through
  `getVersionByNumber`, which matches the requested version fields exactly.

The release preflight checks package/lock/installed CLI pins. A CLI upgrade
requires rechecking these contracts and updating their tests before release.

## Local verification without credentials or release calls

```sh
npm run test:release
npm run check
```

The release tests use a temporary project and a mocked CLI executable, including
misleading version output, upload/install failures, cleanup, exact target/version,
wrong app, changed CLI pin, wrong SHA, PR/fork/tag/unprotected-branch rejection,
missing credentials and shell-injection inputs. The real installed SDK is used
only to decode explicitly supplied dummy auth in a child process pointed at a
nonexistent temporary token directory. No real credentials, SDK authentication,
Devvit upload/install/publish or release network calls are used by these tests.
