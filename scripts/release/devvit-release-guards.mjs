import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const APP = 'the-daily-lap';
export const PUBLIC_SUBREDDIT = 'theDailyLap';
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
    throw new Error(
      'Explicit source-upload and Reddit review confirmation is required.'
    );
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
    (env.DEVVIT_SUBREDDIT && env.DEVVIT_SUBREDDIT !== PUBLIC_SUBREDDIT)
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
    (config.dev?.subreddit && config.dev.subreddit !== PUBLIC_SUBREDDIT)
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
      'Devvit CLI pin changed; reverify the authentication, publish-for-review, and exact-version contracts first.'
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
