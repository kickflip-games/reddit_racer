import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const APP = 'the-daily-lap';
export const SUBREDDIT = 'full_throttle_dev_dev';
export const CLI_VERSION = '0.15.4';
const repository = 'kickflip-games/reddit_racer';
const readJSON = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** No SDK initialization, token-file reads, login, or network calls. */
export function validateContext(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== 'refs/heads/release/daily-lap' ||
    env.GITHUB_REF_TYPE !== 'branch' ||
    env.GITHUB_REF_PROTECTED !== 'true'
  ) {
    throw new Error(
      'Release requires manual dispatch on this repository’s protected release/daily-lap branch.'
    );
  }
  if (env.RELEASE_CONFIRM !== 'true')
    throw new Error('Explicit test-install confirmation is required.');
  const version = env.RELEASE_VERSION ?? '';
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version
      .split('.')
      .some((n) => !Number.isSafeInteger(Number(n)) || Number(n) > 2147483647)
  ) {
    throw new Error(
      'Version must be an exact canonical major.minor.patch number, without aliases or extra arguments.'
    );
  }
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ''))
    throw new Error('A complete source commit SHA is required.');
  if (
    (env.DEVVIT_APP_NAME && env.DEVVIT_APP_NAME !== APP) ||
    (env.DEVVIT_SUBREDDIT && env.DEVVIT_SUBREDDIT !== SUBREDDIT)
  )
    throw new Error(
      'Devvit environment overrides may not change the guarded app or subreddit.'
    );
  return version;
}

export function validateAuthPayload(raw) {
  if (!raw?.trim())
    throw new Error('The Devvit Actions credential is missing.');
  let encoded = raw.trim();
  try {
    if (encoded.startsWith('{')) encoded = JSON.parse(encoded).token;
    if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      throw new Error();
    const token = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (
      !token ||
      typeof token.accessToken !== 'string' ||
      !token.accessToken ||
      typeof token.refreshToken !== 'string' ||
      !token.refreshToken ||
      !Number.isFinite(token.expiresAt) ||
      token.expiresAt <= 0 ||
      token.tokenType !== 'bearer' ||
      typeof token.scope !== 'string' ||
      !token.scope.split(':').includes('*')
    )
      throw new Error();
  } catch {
    throw new Error(
      'Devvit credential must be the serialized CLI token payload, not a plain OAuth access token.'
    );
  }
}

export function preflight(root, env) {
  const version = validateContext(env);
  const config = readJSON(join(root, 'devvit.json'));
  const pkg = readJSON(join(root, 'package.json'));
  const lock = readJSON(join(root, 'package-lock.json'));
  if (
    config.name !== APP ||
    pkg.name !== APP ||
    lock.packages?.['']?.name !== APP ||
    config.dev?.subreddit !== SUBREDDIT
  )
    throw new Error('App or development subreddit identity guard failed.');
  const installed = readJSON(join(root, 'node_modules/devvit/package.json'));
  const cli = readJSON(join(root, 'node_modules/@devvit/cli/package.json'));
  if (
    pkg.dependencies?.devvit !== CLI_VERSION ||
    installed.version !== CLI_VERSION ||
    installed.dependencies?.['@devvit/cli'] !== CLI_VERSION ||
    cli.version !== CLI_VERSION ||
    lock.packages?.['node_modules/devvit']?.version !== CLI_VERSION ||
    lock.packages?.['node_modules/@devvit/cli']?.version !== CLI_VERSION
  ) {
    throw new Error(
      'Devvit CLI pin changed; reverify the authentication, private upload, and exact-version contracts first.'
    );
  }
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    env,
    encoding: 'utf8',
  });
  if (head.status !== 0 || head.stdout.trim() !== env.GITHUB_SHA)
    throw new Error('Checkout does not match the dispatched commit.');
  for (const path of [
    'dist/client/splash.html',
    'dist/client/game.html',
    'dist/server/index.cjs',
  ]) {
    if (!existsSync(join(root, path)))
      throw new Error(
        'Prebuilt release assets are missing. Build before the credential-bearing step.'
      );
  }
  return { version, config };
}

/** The only credential-bearing operation; local tests use a dummy CLI fixture. */
export function release(root, env) {
  const { version, config } = preflight(root, env);
  validateAuthPayload(env.DEVVIT_AUTH_TOKEN);
  const configPath = join(root, '.devvit-ci-release.json');
  const authRoot = mkdtempSync(
    join(env.RUNNER_TEMP || tmpdir(), 'daily-lap-devvit-')
  );
  let createdConfig = false;
  try {
    // Same app/config paths, with the CLI's automatic build hooks disabled.
    // Dependency installation, checks and the real build already ran without this secret.
    writeFileSync(configPath, JSON.stringify({ ...config, scripts: {} }), {
      flag: 'wx',
      mode: 0o600,
    });
    createdConfig = true;
    const cli = join(root, 'node_modules/devvit/bin/devvit.js');
    const childEnv = {
      ...env,
      CI: 'true',
      FORCE_COLOR: '0',
      DEVVIT_ROOT_DIR: authRoot,
      DEVVIT_DIR_NAME: '.devvit',
      MY_PORTAL: '0',
      DEVVIT_APP_NAME: APP,
      DEVVIT_SUBREDDIT: SUBREDDIT,
    };
    for (const [phase, args] of [
      [
        'upload',
        ['upload', '--config', '.devvit-ci-release.json', '--version', version],
      ],
      [
        'install',
        [
          'install',
          '--config',
          '.devvit-ci-release.json',
          SUBREDDIT,
          `${APP}@${version}`,
        ],
      ],
    ]) {
      // No shell interpolation or interactive login, and no raw CLI output in logs/artifacts.
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: root,
        env: childEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 8 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error || result.status !== 0) {
        throw new Error(
          `Devvit ${phase} failed; raw output withheld to protect credentials. No further release command was run.`
        );
      }
    }
    const receipt = `Privately uploaded ${APP}@${version} and installed that exact version only into r/${SUBREDDIT}. Source: ${env.GITHUB_SHA}.`;
    console.log(receipt);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${receipt}\n`);
    return { app: APP, version, subreddit: SUBREDDIT, source: env.GITHUB_SHA };
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
    if (process.argv[2] === 'preflight') preflight(process.cwd(), process.env);
    else if (process.argv[2] === 'release') release(process.cwd(), process.env);
    else throw new Error('Choose preflight or release.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release failed.');
    process.exitCode = 1;
  }
}
