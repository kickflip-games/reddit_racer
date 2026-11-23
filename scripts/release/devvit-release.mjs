import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
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
  preflight,
  validateAuthPayload,
} from './devvit-release-guards.mjs';

const completionMessage =
  "You'll receive an email when your app has been approved.";

/** Exact repo/ref/SHA/CLI guards and explicit source/review consent. */
export function reviewPreflight(root, env) {
  if (env.REVIEW_CONFIRM !== 'true')
    throw new Error(
      'Explicit consent to upload source and submit unlisted review is required.'
    );
  const checked = preflight(root, {
    ...env,
    RELEASE_CONFIRM: 'true',
    RELEASE_VERSION: env.REVIEW_VERSION,
  });
  if (
    !checked.config.post?.entrypoints?.default ||
    !checked.config.post?.entrypoints?.game ||
    Object.keys(checked.config.permissions ?? {}).length !== 1 ||
    checked.config.permissions.redis !== true
  )
    throw new Error(
      'Review automation supports only the current custom-post and Redis capabilities; reverify the CLI contract before changing them.'
    );
  if (
    !readFileSync(join(root, 'README.md'), 'utf8').startsWith(
      '# The Daily Lap\n'
    )
  )
    throw new Error(
      'The launch README is missing or has the wrong app identity.'
    );
  return checked;
}

/** No installation command. Tests invoke only a dummy CLI with dummy auth. */
export function submitUnlistedReview(root, env) {
  const { version, config } = reviewPreflight(root, env);
  validateAuthPayload(env.DEVVIT_AUTH_TOKEN);
  const configPath = join(root, '.devvit-ci-review.json');
  const authRoot = mkdtempSync(
    join(env.RUNNER_TEMP || tmpdir(), 'daily-lap-review-')
  );
  let createdConfig = false;
  try {
    if (realpathSync(authRoot).startsWith(`${realpathSync(root)}${sep}`))
      throw new Error(
        'Temporary auth state must remain outside the uploaded project source.'
      );
    writeFileSync(
      configPath,
      JSON.stringify({
        ...config,
        dev: { ...config.dev, subreddit: PUBLIC_SUBREDDIT },
        scripts: {},
      }),
      {
        flag: 'wx',
        mode: 0o600,
      }
    );
    createdConfig = true;
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/devvit/bin/devvit.js'),
        'publish',
        '--config',
        '.devvit-ci-review.json',
        '--version',
        version,
      ],
      {
        cwd: root,
        env: {
          ...env,
          CI: 'true',
          FORCE_COLOR: '0',
          MY_PORTAL: '0',
          DEVVIT_ROOT_DIR: authRoot,
          DEVVIT_DIR_NAME: '.devvit',
          DEVVIT_APP_NAME: APP,
          DEVVIT_SUBREDDIT: PUBLIC_SUBREDDIT,
          DEVVIT_ALLOW_SOURCE_UPLOAD: '1',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 8 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      }
    );
    if (result.error || result.status !== 0)
      throw new Error(
        'Devvit review submission failed; raw output withheld to protect credentials. Inspect the Developer Portal before retrying.'
      );
    // The pinned CLI can exit before submitting if it needs account/policy setup.
    // This message is emitted only after Submit succeeds for custom-post apps.
    if (!result.stdout.includes(completionMessage))
      throw new Error(
        'The pinned CLI did not confirm review submission; raw output withheld. Inspect the Developer Portal before retrying.'
      );
    const receipt = `CLI confirmed unlisted review submission for ${APP}@${version}. Source: ${env.GITHUB_SHA}. Reddit approval remains pending; no installation was requested.`;
    console.log(receipt);
    if (env.GITHUB_STEP_SUMMARY)
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${receipt}\n`);
    return {
      app: APP,
      version,
      source: env.GITHUB_SHA,
      visibility: 'unlisted',
      installed: false,
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
    if (process.argv[2] === 'preflight')
      reviewPreflight(process.cwd(), process.env);
    else if (process.argv[2] === 'submit')
      submitUnlistedReview(process.cwd(), process.env);
    else throw new Error('Choose preflight or submit.');
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Review submission failed.'
    );
    process.exitCode = 1;
  }
}
