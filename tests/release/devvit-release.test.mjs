import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as yaml from 'js-yaml';
import { validateAuthPayload } from '../../scripts/release/devvit-release-guards.mjs';
import {
  reviewPreflight,
  reviewSourcePreflight,
  submitUnlistedReview,
} from '../../scripts/release/devvit-release.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Release and main intentionally have different js-yaml major versions.
const load = yaml.load ?? yaml.default?.load;
const dummyToken = {
  accessToken: 'DUMMY_ACCESS_NOT_A_CREDENTIAL',
  refreshToken: 'DUMMY_REFRESH_NOT_A_CREDENTIAL',
  expiresAt: 4102444800000,
  scope: '*',
  tokenType: 'bearer',
};
const base64 = Buffer.from(JSON.stringify(dummyToken)).toString('base64');
const auth = JSON.stringify({ token: base64, copyPaste: false });
const context = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'kickflip-games/reddit_racer',
  GITHUB_REF: 'refs/heads/release/daily-lap',
  GITHUB_REF_TYPE: 'branch',
  GITHUB_REF_PROTECTED: 'true',
  REVIEW_CONFIRM: 'true',
  REVIEW_VERSION: '0.0.123',
  GITHUB_SHA: 'a'.repeat(40),
};
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
function fixture(t) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'daily-lap-release-test-'))
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof value === 'string' ? value : JSON.stringify(value)
    );
  };
  const runnerTemp = realpathSync(
    mkdtempSync(join(tmpdir(), 'daily-lap-review-temp-'))
  );
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const config = json(join(repo, 'devvit.json'));
  const pkg = json(join(repo, 'package.json'));
  const lock = json(join(repo, 'package-lock.json'));
  put('README.md', '# The Daily Lap\nLaunch review fixture.');
  put('devvit.json', config);
  put('package.json', pkg);
  put('package-lock.json', lock);
  put('node_modules/devvit/package.json', {
    type: 'module',
    version: '0.15.4',
    dependencies: { '@devvit/cli': '0.15.4' },
  });
  put('node_modules/@devvit/cli/package.json', { version: '0.15.4' });
  for (const path of [
    'dist/client/splash.html',
    'dist/client/game.html',
    'dist/server/index.cjs',
  ])
    put(path, 'dummy build artifact');
  const git = (...args) => {
    const r = spawnSync('git', args, {
      cwd: root,
      env: context,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '--quiet');
  git(
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'user.name=ReleaseTest',
    '-c',
    'user.email=release-test@example.invalid',
    'commit',
    '--quiet',
    '--allow-empty',
    '-m',
    'dummy release fixture'
  );
  const sourceSha = git('rev-parse', 'HEAD');
  const env = {
    ...context,
    GITHUB_SHA: sourceSha,
    REVIEW_SOURCE_SHA: sourceSha,
    DEVVIT_AUTH_TOKEN: auth,
    RUNNER_TEMP: runnerTemp,
    MOCK_LOG: join(root, 'mock-commands.jsonl'),
    GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
  };
  put(
    'node_modules/devvit/bin/devvit.js',
    `
    import assert from 'node:assert/strict';
    import {appendFileSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
    import {join} from 'node:path';
    const args=process.argv.slice(2), phase=args[0];
    assert.equal(phase,'publish');assert(!args.includes('--public'));
    assert.equal(process.env.DEVVIT_ALLOW_SOURCE_UPLOAD,'1');
    const config=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8'));
    assert.equal(config.name,'the-daily-lap');assert.equal(config.dev.subreddit,'theDailyLap');assert.deepEqual(config.scripts,{});
    assert.notEqual(process.env.DEVVIT_ROOT_DIR, undefined);
    assert.equal(process.env.DEVVIT_DIR_NAME,'.devvit');
    assert.equal(process.env.DEVVIT_APP_NAME,'the-daily-lap');assert.equal(process.env.DEVVIT_SUBREDDIT,'theDailyLap');
    assert.equal(args[args.indexOf('--config')+1],'.devvit-ci-review.json');
    mkdirSync(join(process.env.DEVVIT_ROOT_DIR,'.devvit'),{recursive:true});
    writeFileSync(join(process.env.DEVVIT_ROOT_DIR,'.devvit','token'),'DUMMY refreshed state');
    appendFileSync(process.env.MOCK_LOG,JSON.stringify({args,authPresent:!!process.env.DEVVIT_AUTH_TOKEN})+'\\n');
    // Deliberately misleading human output must never select the installed version.
    console.log('Latest is 9.9.9, an unrelated value.');
    console.error(process.env.DEVVIT_AUTH_TOKEN);
    if(process.env.MOCK_FAIL===phase) process.exit(1);
    assert.deepEqual(args.slice(-2),['--version','0.0.123']);
    if(!process.env.MOCK_NO_CONFIRMATION) console.log("You'll receive an email when your app has been approved.");
  `
  );
  return {
    root,
    env,
    config,
    pkg,
    lock,
    put,
    git,
    calls: () =>
      existsSync(env.MOCK_LOG)
        ? readFileSync(env.MOCK_LOG, 'utf8').trim().split('\n').map(JSON.parse)
        : [],
  };
}

for (const [name, changes] of [
  ['PR', { GITHUB_EVENT_NAME: 'pull_request' }],
  ['local invocation', { GITHUB_ACTIONS: 'false' }],
  ['push', { GITHUB_EVENT_NAME: 'push' }],
  ['main', { GITHUB_REF: 'refs/heads/main' }],
  ['bare release', { GITHUB_REF: 'refs/heads/release' }],
  [
    'legacy branch',
    { GITHUB_REF: 'refs/heads/release/legacy-publisher-pause' },
  ],
  ['lookalike', { GITHUB_REF: 'refs/heads/release/daily-lap-next' }],
  ['nested ref', { GITHUB_REF: 'refs/heads/release/daily-lap/preview' }],
  ['case mismatch', { GITHUB_REF: 'refs/heads/release/Daily-Lap' }],
  ['unprotected release', { GITHUB_REF_PROTECTED: 'false' }],
  ['tag', { GITHUB_REF_TYPE: 'tag' }],
  ['fork', { GITHUB_REPOSITORY: 'someone/reddit_racer' }],
  ['no review consent', { REVIEW_CONFIRM: 'false' }],
  [
    'unrelated consent alone',
    { REVIEW_CONFIRM: undefined, RELEASE_CONFIRM: 'true' },
  ],
  ['alias', { REVIEW_VERSION: 'latest' }],
  ['prerelease', { REVIEW_VERSION: '1.0.0-next' }],
  ['shell input', { REVIEW_VERSION: '1.0.0; echo bad' }],
  ['wrong SHA', { GITHUB_SHA: 'b'.repeat(40) }],
  ['missing reviewed SHA', { REVIEW_SOURCE_SHA: undefined }],
  ['short reviewed SHA', { REVIEW_SOURCE_SHA: 'abc123' }],
  ['different reviewed SHA', { REVIEW_SOURCE_SHA: 'b'.repeat(40) }],
  ['legacy app override', { DEVVIT_APP_NAME: 'full-throttle-dev' }],
  ['wrong target override', { DEVVIT_SUBREDDIT: 'somewhere_else' }],
]) {
  test(`review rejects ${name} before invoking a CLI`, (t) => {
    const f = fixture(t);
    assert.throws(() => submitUnlistedReview(f.root, { ...f.env, ...changes }));
    assert.deepEqual(f.calls(), []);
  });
}

test('reviewed source is verified without dependencies, build artifacts, credentials or network', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'node_modules'), { recursive: true });
  rmSync(join(f.root, 'dist'), { recursive: true });
  reviewSourcePreflight(f.root, { ...f.env, DEVVIT_AUTH_TOKEN: undefined });
  assert.deepEqual(f.calls(), []);
});

test('review rejects tracked source changes after the reviewed commit', (t) => {
  const f = fixture(t);
  f.git('add', 'README.md');
  f.git(
    '-c',
    'user.name=ReleaseTest',
    '-c',
    'user.email=release-test@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'track fixture README'
  );
  const sha = f.git('rev-parse', 'HEAD');
  f.put('README.md', '# The Daily Lap\nUnreviewed edit.');
  assert.throws(
    () =>
      reviewSourcePreflight(f.root, {
        ...f.env,
        GITHUB_SHA: sha,
        REVIEW_SOURCE_SHA: sha,
      }),
    /tracked changes/
  );
  assert.deepEqual(f.calls(), []);
});

for (const version of [
  '@latest',
  '1.2',
  '1.2.3.4',
  '01.2.3',
  '1.2.3\n--version 9.9.9',
  '2147483648.0.0',
]) {
  test(`review rejects noncanonical version ${JSON.stringify(version)}`, (t) => {
    const f = fixture(t);
    assert.throws(() =>
      reviewPreflight(f.root, { ...f.env, REVIEW_VERSION: version })
    );
    assert.deepEqual(f.calls(), []);
  });
}

for (const [name, change] of [
  [
    'wrong app',
    (f) => f.put('devvit.json', { ...f.config, name: 'full-throttle-dev' }),
  ],
  [
    'wrong development target',
    (f) =>
      f.put('devvit.json', {
        ...f.config,
        dev: { subreddit: 'somewhere_else' },
      }),
  ],
  [
    'no custom post',
    (f) => f.put('devvit.json', { ...f.config, post: undefined }),
  ],
  [
    'additional capability',
    (f) =>
      f.put('devvit.json', {
        ...f.config,
        permissions: { redis: true, http: true },
      }),
  ],
  [
    'changed CLI',
    (f) =>
      f.put('node_modules/@devvit/cli/package.json', { version: '0.15.5' }),
  ],
  ['wrong README', (f) => f.put('README.md', '# Other app\n')],
  ['missing build', (f) => rmSync(join(f.root, 'dist/client/game.html'))],
]) {
  test(`review preflight rejects ${name}`, (t) => {
    const f = fixture(t);
    change(f);
    assert.throws(() => reviewPreflight(f.root, f.env));
    assert.deepEqual(f.calls(), []);
  });
}

test('mocked review submits only the exact unlisted version, outside-project auth and source consent', (t) => {
  const f = fixture(t);
  const receipt = submitUnlistedReview(f.root, f.env);
  assert.deepEqual(receipt, {
    app: 'the-daily-lap',
    version: '0.0.123',
    source: f.env.GITHUB_SHA,
    visibility: 'unlisted',
    installed: false,
  });
  assert.deepEqual(f.calls(), [
    {
      args: [
        'publish',
        '--config',
        '.devvit-ci-review.json',
        '--version',
        '0.0.123',
      ],
      authPresent: true,
    },
  ]);
  const summary = readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8');
  assert(
    summary.includes(
      'Reddit approval remains pending; no installation was requested.'
    )
  );
  assert(!summary.includes(auth));
  assert(!existsSync(join(f.root, '.devvit-ci-review.json')));
  assert.deepEqual(readdirSync(f.env.RUNNER_TEMP), []);
});

for (const [name, changes] of [
  ['CLI failure', { MOCK_FAIL: 'publish' }],
  ['early success without submission', { MOCK_NO_CONFIRMATION: '1' }],
]) {
  test(`review ${name} fails without receipt or credential output and cleans up`, (t) => {
    const f = fixture(t);
    assert.throws(
      () => submitUnlistedReview(f.root, { ...f.env, ...changes }),
      (error) => {
        assert(!error.message.includes(auth));
        assert(error.message.includes('raw output withheld'));
        return true;
      }
    );
    assert.equal(f.calls().length, 1);
    assert(!existsSync(f.env.GITHUB_STEP_SUMMARY));
    assert(!existsSync(join(f.root, '.devvit-ci-review.json')));
    assert.deepEqual(readdirSync(f.env.RUNNER_TEMP), []);
  });
}

test('review never uploads auth state inside the project source', (t) => {
  const f = fixture(t);
  assert.throws(
    () => submitUnlistedReview(f.root, { ...f.env, RUNNER_TEMP: f.root }),
    /outside/
  );
  assert.deepEqual(f.calls(), []);
  assert(!readdirSync(f.root).some((p) => p.startsWith('daily-lap-review-')));
});

test('review refuses missing credentials without fallback or CLI execution', (t) => {
  const f = fixture(t);
  assert.throws(() =>
    submitUnlistedReview(f.root, { ...f.env, DEVVIT_AUTH_TOKEN: '' })
  );
  assert.deepEqual(f.calls(), []);
});

test('review does not overwrite or delete an existing temporary config', (t) => {
  const f = fixture(t);
  f.put('.devvit-ci-review.json', 'existing');
  assert.throws(() => submitUnlistedReview(f.root, f.env));
  assert.equal(
    readFileSync(join(f.root, '.devvit-ci-review.json'), 'utf8'),
    'existing'
  );
  assert.deepEqual(f.calls(), []);
  assert.deepEqual(readdirSync(f.env.RUNNER_TEMP), []);
});

test('review workflow is manual, exact-ref/SHA guarded, pinned and has one scoped secret step', () => {
  const raw = readFileSync(
    join(repo, '.github/workflows/devvit-release.yaml'),
    'utf8'
  );
  const workflow = load(raw);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(workflow.on.workflow_dispatch.inputs).sort(), [
    'confirm_review_submission',
    'source_sha',
    'version',
  ]);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.confirm_review_submission.default,
    false
  );
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(Object.keys(workflow.jobs), ['submit']);
  assert.equal(workflow.jobs.submit.needs, undefined);
  assert.equal(workflow.on.workflow_dispatch.inputs.source_sha.required, true);
  assert.equal(
    workflow.jobs.submit.env.REVIEW_SOURCE_SHA,
    '${{ inputs.source_sha }}'
  );
  assert.deepEqual(
    workflow.jobs.submit.steps
      .filter((step) => step.run)
      .map((step) => step.run),
    [
      'node scripts/release/devvit-release.mjs source',
      'npm ci --ignore-scripts --no-fund',
      'npm run build',
      'node scripts/release/devvit-release.mjs preflight',
      'node scripts/release/devvit-release.mjs submit',
    ]
  );
  const secretSteps = [];
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert(!Object.hasOwn(job, 'environment'));
    for (const guard of [
      "github.event_name == 'workflow_dispatch'",
      "github.repository == 'kickflip-games/reddit_racer'",
      "github.ref == 'refs/heads/release/daily-lap'",
      'github.ref_protected == true',
      'inputs.confirm_review_submission == true',
    ])
      assert(job.if.includes(guard));
    for (const step of job.steps) {
      if (JSON.stringify(step).includes('secrets.'))
        secretSteps.push([name, step]);
      if (step.run) assert(!step.run.includes('${{'));
      if (step.uses) assert(/@[0-9a-f]{40}$/.test(step.uses));
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.equal(step.with.ref, '${{ github.sha }}');
        assert.equal(step.with['persist-credentials'], false);
      }
    }
  }
  assert.equal(secretSteps.length, 1);
  assert.equal(secretSteps[0][0], 'submit');
  assert.deepEqual(secretSteps[0][1].env, {
    DEVVIT_AUTH_TOKEN: '${{ secrets.DEVVIT_AUTH_TOKEN }}',
  });
  assert.equal(
    secretSteps[0][1].run,
    'node scripts/release/devvit-release.mjs submit'
  );
  assert(!raw.includes('--public'));
  assert(!raw.includes('devvit install'));
});

test('pinned publish source confirms unlisted Submit, stable version, consent and conditional auto-install', () => {
  const source = readFileSync(
    join(repo, 'node_modules/@devvit/cli/dist/commands/publish.js'),
    'utf8'
  );
  assert(
    source.includes('let visibility = AppPublishRequestVisibility.UNLISTED;')
  );
  assert(source.includes('let appVersionNumber = flags.version;'));
  assert(source.includes('.Submit({ appVersionId, visibility })'));
  assert(
    source.includes(
      "const shouldCreatePlaytestSubreddit = !this.project.getSubreddit('Dev');"
    )
  );
  assert(
    source.includes(
      'if (shouldCreatePlaytestSubreddit) {\n                const installationInfo'
    )
  );
  assert(source.includes('}, bundles, !shouldCreatePlaytestSubreddit);'));
  assert(source.includes('if (DEVVIT_ALLOW_SOURCE_UPLOAD()) {'));
  assert(
    source.includes(
      'const buildCommand = this.project.appConfig.scripts?.build;'
    )
  );
  const submitted = source.indexOf(
    '_Publish_submitForReview).call(this, latestVersion.id'
  );
  const confirmed = source.indexOf(
    'this.log("You\'ll receive an email when your app has been approved.");'
  );
  assert(submitted > 0 && confirmed > submitted);
  assert(
    readFileSync(
      join(repo, 'node_modules/@devvit/cli/dist/lib/config.js'),
      'utf8'
    ).includes("process.env.DEVVIT_ALLOW_SOURCE_UPLOAD === '1'")
  );
});

test('only the documented complete serialized token formats are accepted', () => {
  assert.doesNotThrow(() => validateAuthPayload(auth));
  assert.doesNotThrow(() => validateAuthPayload(base64));
  for (const raw of [
    '',
    'plain-access-token',
    '{bad json}',
    JSON.stringify({ token: 'garbage' }),
    Buffer.from(JSON.stringify({ ...dummyToken, scope: 'read' })).toString(
      'base64'
    ),
  ])
    assert.throws(() => validateAuthPayload(raw));
});
test('pinned SDK reads dummy env auth without touching a real token file or authenticating', (t) => {
  const f = fixture(t);
  const module = pathToFileURL(
    join(repo, 'node_modules/@devvit/cli/dist/lib/auth/AuthTokenStore.js')
  ).href;
  for (const raw of [auth, base64]) {
    const r = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import assert from 'node:assert/strict'; const {AuthTokenStore}=await import(${JSON.stringify(module)}); const store=new AuthTokenStore(${JSON.stringify(join(f.root, 'nonexistent-auth'))}); const result=await store.readFSToken(); assert.equal(result.token.accessToken,'DUMMY_ACCESS_NOT_A_CREDENTIAL'); assert.equal(result.token.refreshToken,'DUMMY_REFRESH_NOT_A_CREDENTIAL');`,
      ],
      { env: { ...context, DEVVIT_AUTH_TOKEN: raw }, encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr);
  }
  assert.equal(existsSync(join(f.root, 'nonexistent-auth')), false);
});

test('the real pinned project loader sees a public dev target, suppressing auto-create/install', (t) => {
  const f = fixture(t);
  f.put('.devvit-ci-review.json', {
    ...f.config,
    dev: { subreddit: 'theDailyLap' },
    scripts: {},
  });
  const module = pathToFileURL(
    join(repo, 'node_modules/@devvit/cli/dist/util/project.js')
  ).href;
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';const {newProject}=await import(${JSON.stringify(module)});const p=await newProject('.devvit-ci-review.json','Dynamic');assert.equal(p.root,${JSON.stringify(f.root)});assert.equal(p.name,'the-daily-lap');assert.equal(p.getSubreddit('Dev'),'theDailyLap');assert.deepEqual(p.appConfig.scripts,{});`,
    ],
    { cwd: f.root, env: context, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
});

test('one public workflow replaces private deploy defaults and ordinary CI stays secret-free', () => {
  assert.deepEqual(readdirSync(join(repo, '.github/workflows')).sort(), [
    'ci.yaml',
    'devvit-private-upload.yaml',
    'devvit-release.yaml',
  ]);
  const config = json(join(repo, 'devvit.json'));
  assert.equal(config.name, 'the-daily-lap');
  assert.equal(config.dev, undefined);
  const pkg = json(join(repo, 'package.json'));
  assert.equal(pkg.scripts.deploy, undefined);
  assert.equal(pkg.scripts.dev, 'npm run dev:local');
  const raw = readFileSync(join(repo, '.github/workflows/ci.yaml'), 'utf8');
  const workflow = load(raw);
  assert.deepEqual(Object.keys(workflow.jobs), ['check']);
  assert.deepEqual(workflow.on.pull_request.branches, [
    'main',
    'release/daily-lap',
  ]);
  assert.equal(workflow.on.push, undefined);
  assert.deepEqual(workflow.on.schedule, [{ cron: '0 16 * * 0' }]);
  assert.equal(workflow.on.workflow_dispatch, null);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(
    workflow.jobs.check.steps
      .filter((step) => step.run)
      .map((step) => step.run),
    [
      'npm ci --ignore-scripts --no-fund',
      'npm run test:release',
      'npm run type-check',
      'npm run build',
    ]
  );
  for (const step of workflow.jobs.check.steps) {
    if (step.uses) assert(/@[0-9a-f]{40}$/.test(step.uses));
    if (step.uses?.startsWith('actions/checkout@'))
      assert.equal(step.with['persist-credentials'], false);
  }
  for (const [id, job] of Object.entries(workflow.jobs))
    assert.equal(job.name ?? id, id);
  assert(!raw.includes('secrets.'));
  assert(!raw.includes('devvit publish'));
  assert(!raw.includes('devvit install'));
});
