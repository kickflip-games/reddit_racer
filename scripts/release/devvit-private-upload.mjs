import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  APP,
  PUBLIC_SUBREDDIT,
  validateAuthPayload,
} from './devvit-release-guards.mjs';
import { reviewPreflight, reviewSourcePreflight } from './devvit-release.mjs';

export const EXISTING_APP_ID = '315876cd-0a70-4598-abe9-bff0691630c3';
const protectedVersions = new Set(['0.0.20261123', '0.0.20261124']);
// Offline-reviewed 0.15.4 code. A changed CLI must be reviewed again, not trusted by version alone.
export const UPLOAD_CONTRACT_HASHES = Object.freeze({
  'commands/upload.js':
    '86618670c109d579970a532cef45317de496f4480ab23a6b195f4fd8a004a561',
  'util/AppVersionUploader.js':
    '719b7107a4ade94a8d94cde43607cdbd640d667a539cf0bd247e410976abc3a5',
  'commands/init.js':
    '015d026d2647eae50e1d5aa08f760e70460b11b23e0f6bd7fc942f9648dcccd2',
});

function uploadContext(env) {
  if (env.UPLOAD_CONFIRM !== 'true')
    throw new Error('Explicit private-upload-only confirmation is required.');
  return {
    ...env,
    REVIEW_CONFIRM: env.UPLOAD_CONFIRM,
    REVIEW_VERSION: env.UPLOAD_VERSION,
    REVIEW_SOURCE_SHA: env.UPLOAD_SOURCE_SHA,
  };
}

export function privateSourcePreflight(root, env) {
  reviewSourcePreflight(root, uploadContext(env));
  if (protectedVersions.has(env.UPLOAD_VERSION))
    throw new Error(
      'The approved and pending public versions are reserved. Choose an unused exact version.'
    );
}

export function privateUploadPreflight(root, env) {
  privateSourcePreflight(root, env);
  const checked = reviewPreflight(root, uploadContext(env));
  for (const [file, expected] of Object.entries(UPLOAD_CONTRACT_HASHES)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(root, 'node_modules/@devvit/cli/dist', file)))
      .digest('hex');
    if (actual !== expected)
      throw new Error(
        'Pinned upload/provisioning contract changed; reverify it before private upload.'
      );
  }
  return checked;
}

function cliJSON(result) {
  if (result.error || result.status !== 0)
    throw new Error(
      'Private upload metadata check failed; no fallback or new login is attempted.'
    );
  try {
    return JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  } catch {
    throw new Error(
      'Private upload metadata was not valid JSON; raw output withheld.'
    );
  }
}

function checkedVersion(info) {
  const parts = ['majorVersion', 'minorVersion', 'patchVersion'].map(
    (key) => info?.[key]
  );
  if (
    parts.some((n) => !Number.isSafeInteger(n) || n < 0 || n > 2147483647) ||
    (info.prereleaseVersion != null &&
      ![0, -1].includes(info.prereleaseVersion))
  )
    throw new Error('Expected an exact stable version in metadata.');
  return parts.join('.');
}

function existingOwnedApp(metadata, username) {
  if (
    metadata?.app?.id !== EXISTING_APP_ID ||
    metadata.app.slug !== APP ||
    metadata.app.owner?.displayName !== username
  )
    throw new Error(
      'Existing app identity or credential owner does not match; upload refused.'
    );
}

/** Only this operator-invoked final workflow step can invoke authenticated CLI commands. */
export function uploadPrivateVersion(root, env) {
  const { version, config } = privateUploadPreflight(root, env);
  validateAuthPayload(env.DEVVIT_AUTH_TOKEN);
  const authRoot = mkdtempSync(
    join(env.RUNNER_TEMP || tmpdir(), 'daily-lap-private-auth-')
  );
  const configPath = join(root, '.devvit-ci-private-upload.json');
  let createdConfig = false;
  try {
    if (realpathSync(authRoot).startsWith(`${realpathSync(root)}${sep}`))
      throw new Error('Temporary auth state must remain outside the project.');
    const childEnv = {
      ...env,
      CI: 'true',
      FORCE_COLOR: '0',
      MY_PORTAL: '0',
      DEVVIT_ROOT_DIR: authRoot,
      DEVVIT_DIR_NAME: '.devvit',
      DEVVIT_APP_NAME: APP,
      DEVVIT_SUBREDDIT: PUBLIC_SUBREDDIT,
      DEVVIT_ALLOW_SOURCE_UPLOAD: '0',
    };
    const run = (args, timeout = 60_000) => {
      // Carry a normal refresh forward without touching the user's/global profile.
      const refreshed = join(authRoot, '.devvit/token');
      if (existsSync(refreshed)) {
        const raw = readFileSync(refreshed, 'utf8');
        validateAuthPayload(raw);
        childEnv.DEVVIT_AUTH_TOKEN = raw;
      }
      return spawnSync(
        process.execPath,
        [join(root, 'node_modules/devvit/bin/devvit.js'), ...args],
        {
          cwd: root,
          env: childEnv,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout,
          maxBuffer: 8 * 1024 * 1024,
        }
      );
    };
    const who = run(['whoami']);
    const users =
      who.stdout?.match(/^Logged in as u\/[A-Za-z0-9_-]+\s*$/gm) ?? [];
    if (who.error || who.status !== 0 || users.length !== 1)
      throw new Error(
        'Existing credential identity could not be verified; upload not invoked.'
      );
    const username = users[0].trim().slice('Logged in as u/'.length);
    const before = cliJSON(run(['view', APP, '--json']));
    existingOwnedApp(before, username);
    const latest = checkedVersion(before.version);
    const wantedParts = version.split('.').map(Number),
      latestParts = latest.split('.').map(Number);
    const different = wantedParts.findIndex((n, i) => n !== latestParts[i]);
    if (different < 0 || wantedParts[different] < latestParts[different])
      throw new Error(
        'Private version must be unused and newer than the current highest stable version; no auto-bump.'
      );
    const absent = run(['view', `${APP}@${version}`, '--json']);
    if (
      absent.error ||
      absent.status !== 1 ||
      !absent.stderr
        ?.split(/\r?\n/)
        .some(
          (line) => line.trim() === `Error: Could not find version ${version}`
        )
    )
      throw new Error(
        'Exact version is occupied or absence could not be verified; upload not invoked.'
      );
    writeFileSync(
      configPath,
      JSON.stringify({
        ...config,
        dev: { ...config.dev, subreddit: PUBLIC_SUBREDDIT },
        scripts: {},
      }),
      { flag: 'wx', mode: 0o600 }
    );
    createdConfig = true;
    const uploaded = run(
      [
        'upload',
        '--config',
        '.devvit-ci-private-upload.json',
        '--version',
        version,
      ],
      8 * 60_000
    );
    if (uploaded.error || uploaded.status !== 0)
      throw new Error(
        'Private upload failed or timed out; raw output withheld. A version may exist: inspect the portal before retrying.'
      );
    let after;
    try {
      after = cliJSON(run(['view', `${APP}@${version}`, '--json']));
      existingOwnedApp(after, username);
      if (
        checkedVersion(after.version) !== version ||
        after.version.visibility !== 1 ||
        ![0, 1].includes(after.version.buildStatus)
      )
        throw new Error('Unexpected uploaded version metadata.');
    } catch {
      throw new Error(
        'Upload returned success but private-version verification failed; a version may exist. Inspect the portal before retrying. No success receipt was issued.'
      );
    }
    const build = after.version.buildStatus === 1 ? 'ready' : 'building';
    const receipt = `Verified private version ${APP}@${version}. Source: ${env.GITHUB_SHA}. Build: ${build}. No publication or installation requested.`;
    console.log(receipt);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${receipt}\n`);
    return {
      app: APP,
      version,
      source: env.GITHUB_SHA,
      visibility: 'private',
      build,
      installed: false,
      published: false,
    };
  } finally {
    if (createdConfig) rmSync(configPath);
    rmSync(authRoot, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv[2] === 'source')
      privateSourcePreflight(process.cwd(), process.env);
    else if (process.argv[2] === 'preflight')
      privateUploadPreflight(process.cwd(), process.env);
    else if (process.argv[2] === 'upload')
      uploadPrivateVersion(process.cwd(), process.env);
    else throw new Error('Choose source, preflight or upload.');
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Private upload failed.'
    );
    process.exitCode = 1;
  }
}
