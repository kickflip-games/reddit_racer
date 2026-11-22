# Manual private test releases

`.github/workflows/devvit-test-release.yaml` is the future release flow on
GitHub-hosted Ubuntu runners. It uploads **the-daily-lap** privately and installs
only into **r/full_throttle_dev_dev**. It has no push, pull-request, schedule,
public-publish, arbitrary-command, app-name or subreddit input. This setup does
not run a release or change the legacy app.

## Owner setup before first dispatch

These are manual repository-owner tasks, not settings performed by this change.

1. Protect `main` with the repository's reviewed-PR/status-check policy. The
   workflow and script both refuse an unprotected `main`.
2. Under **Settings → Environments**, create **the-daily-lap-test-release**.
   Set **Deployment branches and tags → Selected branches and tags** to the
   **branch `main` only**. Add no tag rules. Keep main's branch protection in
   place. Do not select an unrestricted environment policy. GitHub's “Protected
   branches only” setting alone permits all branches if none is protected, so
   the exact branch selection plus the workflow's protection guard are both
   intentional.
3. Configure required reviewers for this environment; prevent self-review and
   administrator bypass when appropriate to the team's approval policy.
4. In **that environment's Secrets**, independently provision
   **THE_DAILY_LAP_TEST_DEVVIT_AUTH_TOKEN** using the complete serialized payload
   from the authorized app owner's existing pinned-CLI login. Do not create a
   repository/organization secret of the same name. Do not provide its value in
   chat, source, dispatch inputs, logs, artifacts or PRs. This implementation
   never reads a workstation's token file or asks for its contents.
5. Confirm the new app already exists under that owner account, the developer
   account is ready, and the account can install into the named test subreddit.
   App initialization, account setup and subreddit creation are outside this
   workflow. It provides no prompt answers or ownership overrides.
6. Review and merge the workflow through normal repository review. No release
   occurs on merge. A manual-dispatch workflow must exist on the default branch
   before its Actions UI can be used.

Environment protections are GitHub settings, not declarable in this YAML.
Referencing a new environment can create it without protections; configure the
settings above **before adding its secret**. The code provides a separate
manual-event/repository/protected-main guard, but does not claim to have created
or audited GitHub's environment settings.

GitHub documents [environment branch restrictions and secrets](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[the protected-ref context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context),
and [manual dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_dispatch).

## Dispatch and exact version

In **Actions → Private test release → Run workflow**, select **main**, enter an
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
