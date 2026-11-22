import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import {
  preflight,
  release,
  validateAuthPayload,
  validateContext,
} from '../../scripts/release/devvit-test-release.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
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
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REF_TYPE: 'branch',
  GITHUB_REF_PROTECTED: 'true',
  RELEASE_CONFIRM: 'true',
  RELEASE_VERSION: '0.0.123',
  GITHUB_SHA: 'a'.repeat(40),
};
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'daily-lap-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof value === 'string' ? value : JSON.stringify(value)
    );
  };
  const config = json(join(repo, 'devvit.json'));
  const pkg = json(join(repo, 'package.json'));
  const lock = json(join(repo, 'package-lock.json'));
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
  const env = {
    ...context,
    GITHUB_SHA: git('rev-parse', 'HEAD'),
    DEVVIT_AUTH_TOKEN: auth,
    RUNNER_TEMP: root,
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
    const config=JSON.parse(readFileSync(args[args.indexOf('--config')+1],'utf8'));
    assert.equal(config.name,'the-daily-lap');assert.equal(config.dev.subreddit,'full_throttle_dev_dev');assert.deepEqual(config.scripts,{});
    assert.notEqual(process.env.DEVVIT_ROOT_DIR, undefined);
    assert.equal(process.env.DEVVIT_DIR_NAME,'.devvit');
    assert.equal(process.env.DEVVIT_APP_NAME,'the-daily-lap');assert.equal(process.env.DEVVIT_SUBREDDIT,'full_throttle_dev_dev');
    assert.equal(args[args.indexOf('--config')+1],'.devvit-ci-release.json');
    mkdirSync(join(process.env.DEVVIT_ROOT_DIR,'.devvit'),{recursive:true});
    writeFileSync(join(process.env.DEVVIT_ROOT_DIR,'.devvit','token'),'DUMMY refreshed state');
    appendFileSync(process.env.MOCK_LOG,JSON.stringify({args,authPresent:!!process.env.DEVVIT_AUTH_TOKEN})+'\\n');
    // Deliberately misleading human output must never select the installed version.
    console.log('Latest is 9.9.9, an unrelated value.');
    console.error(process.env.DEVVIT_AUTH_TOKEN);
    if(process.env.MOCK_FAIL===phase) process.exit(1);
    if(phase==='upload') assert.deepEqual(args.slice(-2),['--version','0.0.123']);
    else {assert.equal(phase,'install');assert.deepEqual(args.slice(-2),['full_throttle_dev_dev','the-daily-lap@0.0.123']);}
  `
  );
  return {
    root,
    env,
    config,
    pkg,
    lock,
    put,
    calls: () =>
      existsSync(env.MOCK_LOG)
        ? readFileSync(env.MOCK_LOG, 'utf8').trim().split('\n').map(JSON.parse)
        : [],
  };
}

for (const [name, changes] of [
  ['PR', { GITHUB_EVENT_NAME: 'pull_request' }],
  ['push', { GITHUB_EVENT_NAME: 'push' }],
  ['feature branch', { GITHUB_REF: 'refs/heads/feature/x' }],
  ['unprotected main', { GITHUB_REF_PROTECTED: 'false' }],
  ['fork', { GITHUB_REPOSITORY: 'someone/reddit_racer' }],
  ['tag', { GITHUB_REF_TYPE: 'tag' }],
  ['unconfirmed', { RELEASE_CONFIRM: 'false' }],
  ['local invocation', { GITHUB_ACTIONS: 'false' }],
])
  test(`rejects ${name} before a CLI can run`, () =>
    assert.throws(() => validateContext({ ...context, ...changes })));

for (const version of [
  'latest',
  '@latest',
  '1.2',
  '1.2.3.4',
  '1.2.3-beta',
  '01.2.3',
  '1.2.3;touch /tmp/should-not-run',
  '1.2.3\n--version 9.9.9',
  '2147483648.0.0',
]) {
  test(`rejects noncanonical version ${JSON.stringify(version)}`, () =>
    assert.throws(() =>
      validateContext({ ...context, RELEASE_VERSION: version })
    ));
}
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
for (const change of [
  'legacy app',
  'wrong subreddit',
  'CLI bump',
  'source mismatch',
  'missing build',
])
  test(`rejects ${change} before upload`, (t) => {
    const f = fixture(t);
    if (change === 'legacy app')
      f.put('devvit.json', { ...f.config, name: 'full-throttle' });
    if (change === 'wrong subreddit')
      f.put('devvit.json', {
        ...f.config,
        dev: { subreddit: 'somewhere_else' },
      });
    if (change === 'CLI bump')
      f.put('node_modules/@devvit/cli/package.json', { version: '0.15.5' });
    if (change === 'source mismatch') f.env.GITHUB_SHA = 'b'.repeat(40);
    if (change === 'missing build')
      rmSync(join(f.root, 'dist/server/index.cjs'));
    assert.throws(() => release(f.root, f.env));
    assert.deepEqual(f.calls(), []);
  });
test('mocked full release uploads privately by exact version and installs only that app/version/target', (t) => {
  const f = fixture(t);
  const messages = [];
  t.mock.method(console, 'log', (message) => messages.push(message));
  assert.doesNotThrow(() => preflight(f.root, f.env));
  const receipt = release(f.root, f.env);
  assert.deepEqual(receipt, {
    app: 'the-daily-lap',
    version: '0.0.123',
    subreddit: 'full_throttle_dev_dev',
    source: f.env.GITHUB_SHA,
  });
  assert.equal(messages.length, 1);
  const calls = f.calls();
  assert.equal(calls.length, 2);
  assert(calls.every((c) => c.authPresent));
  assert.equal(calls[0].args[0], 'upload');
  assert.equal(calls[1].args[0], 'install');
  assert.deepEqual(json(join(f.root, 'devvit.json')), f.config);
  assert.equal(existsSync(join(f.root, '.devvit-ci-release.json')), false);
  assert(!readdirSync(f.root).some((n) => n.startsWith('daily-lap-devvit-')));
  const summary = readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8');
  assert(!summary.includes(auth));
  assert(!summary.includes(dummyToken.accessToken));
});
for (const phase of ['upload', 'install'])
  test(`a failed ${phase} stops, suppresses credential output, and removes temporary state`, (t) => {
    const f = fixture(t);
    assert.throws(
      () => release(f.root, { ...f.env, MOCK_FAIL: phase }),
      (error) =>
        error.message.includes(`Devvit ${phase} failed`) &&
        !error.message.includes(auth)
    );
    assert.equal(f.calls().length, phase === 'upload' ? 1 : 2);
    assert.equal(existsSync(join(f.root, '.devvit-ci-release.json')), false);
    assert(!readdirSync(f.root).some((n) => n.startsWith('daily-lap-devvit-')));
    assert.equal(existsSync(f.env.GITHUB_STEP_SUMMARY), false);
  });
test('missing credentials never fall back to workstation auth', (t) => {
  const f = fixture(t);
  assert.throws(
    () => release(f.root, { ...f.env, DEVVIT_AUTH_TOKEN: '' }),
    /missing/
  );
  assert.deepEqual(f.calls(), []);
});
test('an existing temporary config is not overwritten or deleted', (t) => {
  const f = fixture(t);
  f.put('.devvit-ci-release.json', 'existing file');
  assert.throws(() => release(f.root, f.env));
  assert.equal(
    readFileSync(join(f.root, '.devvit-ci-release.json'), 'utf8'),
    'existing file'
  );
  assert.deepEqual(f.calls(), []);
});
test('workflow has only a guarded manual trigger, least privilege, one environment-scoped secret step, and exact-SHA checkout', () => {
  const raw = readFileSync(
    join(repo, '.github/workflows/devvit-test-release.yaml'),
    'utf8'
  );
  const workflow = yaml.safeLoad(raw);
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.confirm_test_install.default,
    false
  );
  assert.equal(workflow.jobs.release.needs, 'validate');
  assert.equal(
    workflow.jobs.release.environment.name,
    'the-daily-lap-test-release'
  );
  const secretSteps = [];
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const guard of [
      "github.event_name == 'workflow_dispatch'",
      "github.repository == 'kickflip-games/reddit_racer'",
      "github.ref == 'refs/heads/main'",
      'github.ref_protected == true',
      'inputs.confirm_test_install == true',
    ])
      assert(job.if.includes(guard));
    assert.equal(job['runs-on'], 'ubuntu-24.04');
    for (const step of job.steps) {
      if (JSON.stringify(step).includes('secrets.'))
        secretSteps.push([name, step]);
      if (step.run)
        assert(
          !step.run.includes('${{'),
          'never interpolate inputs into a shell program'
        );
      if (step.uses?.startsWith('actions/checkout@')) {
        assert.equal(step.with['persist-credentials'], false);
        assert.equal(step.with.ref, '${{ github.sha }}');
      }
      if (step.uses) assert(/@[0-9a-f]{40}$/.test(step.uses));
    }
  }
  assert.equal(secretSteps.length, 1);
  assert.equal(secretSteps[0][0], 'release');
  assert.deepEqual(secretSteps[0][1].env, {
    DEVVIT_AUTH_TOKEN: '${{ secrets.THE_DAILY_LAP_TEST_DEVVIT_AUTH_TOKEN }}',
  });
  assert.equal(
    secretSteps[0][1].run,
    'node scripts/release/devvit-test-release.mjs release'
  );
  assert(!raw.includes('pull_request'));
  assert(!raw.includes('devvit publish'));
});
test('installed upload source pins private visibility, explicit version and exact-version install resolution', () => {
  const upload = readFileSync(
    join(repo, 'node_modules/@devvit/cli/dist/commands/upload.js'),
    'utf8'
  );
  const install = readFileSync(
    join(repo, 'node_modules/@devvit/cli/dist/commands/install.js'),
    'utf8'
  );
  assert(upload.includes('visibility: VersionVisibility.PRIVATE'));
  assert(upload.includes('let appVersionNumber = flags.version'));
  assert(
    upload.includes(
      'const buildCommand = this.project.appConfig.scripts?.build'
    )
  );
  assert(
    install.includes(
      'getVersionByNumber(inferredParams.version, appInfo?.versions)'
    )
  );
});

test('pinned SDK resolves the relative temporary config and same project root without authenticating', (t) => {
  const f = fixture(t);
  f.put('.devvit-ci-release.json', { ...f.config, scripts: {} });
  const module = pathToFileURL(
    join(repo, 'node_modules/@devvit/cli/dist/util/project.js')
  ).href;
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';const {newProject}=await import(${JSON.stringify(module)});const project=await newProject('.devvit-ci-release.json','Dynamic');assert.equal(project.root,${JSON.stringify(f.root)});assert.equal(project.name,'the-daily-lap');assert.equal(project.getSubreddit('Dev'),'full_throttle_dev_dev');assert.deepEqual(project.appConfig.scripts,{});`,
    ],
    { cwd: f.root, env: context, encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
});

test('CLI environment overrides cannot redirect app or subreddit', () => {
  assert.throws(
    () => validateContext({ ...context, DEVVIT_APP_NAME: 'full-throttle' }),
    /overrides/
  );
  assert.throws(
    () => validateContext({ ...context, DEVVIT_SUBREDDIT: 'other_subreddit' }),
    /overrides/
  );
});
