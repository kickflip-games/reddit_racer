import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
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
import {
  EXISTING_APP_ID,
  UPLOAD_CONTRACT_HASHES,
  privateSourcePreflight,
  privateUploadPreflight,
  uploadPrivateVersion,
} from '../../scripts/release/devvit-private-upload.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const load = yaml.load ?? yaml.default?.load;
const auth = JSON.stringify({
  token: Buffer.from(
    JSON.stringify({
      accessToken: 'DUMMY_PRIVATE_ACCESS',
      refreshToken: 'DUMMY_PRIVATE_REFRESH',
      expiresAt: 4102444800000,
      scope: '*',
      tokenType: 'bearer',
    })
  ).toString('base64'),
  copyPaste: false,
});
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
  UPLOAD_CONFIRM: 'true',
  UPLOAD_VERSION: '0.0.123',
};

function fixture(t, scenario = '') {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), 'daily-lap-private-test-'))
  );
  const runnerTemp = realpathSync(
    mkdtempSync(join(tmpdir(), 'daily-lap-private-profile-test-'))
  );
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(runnerTemp, { recursive: true, force: true });
  });
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof value === 'string' ? value : JSON.stringify(value)
    );
  };
  for (const file of [
    'README.md',
    'devvit.json',
    'package.json',
    'package-lock.json',
  ])
    copyFileSync(join(repo, file), join(root, file));
  put('node_modules/devvit/package.json', {
    version: '0.15.4',
    type: 'module',
    dependencies: { '@devvit/cli': '0.15.4' },
  });
  put('node_modules/@devvit/cli/package.json', { version: '0.15.4' });
  for (const file of Object.keys(UPLOAD_CONTRACT_HASHES)) {
    const target = join(root, 'node_modules/@devvit/cli/dist', file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repo, 'node_modules/@devvit/cli/dist', file), target);
  }
  for (const file of [
    'dist/client/game.html',
    'dist/client/splash.html',
    'dist/server/index.cjs',
  ])
    put(file, 'dummy build');
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
  git('add', 'README.md');
  git(
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'user.name=PrivateTest',
    '-c',
    'user.email=private@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'private fixture'
  );
  const sha = git('rev-parse', 'HEAD');
  const env = {
    ...context,
    GITHUB_SHA: sha,
    UPLOAD_SOURCE_SHA: sha,
    DEVVIT_AUTH_TOKEN: auth,
    RUNNER_TEMP: runnerTemp,
    MOCK_SCENARIO: scenario,
    MOCK_LOG: join(root, 'calls.jsonl'),
    GITHUB_STEP_SUMMARY: join(root, 'summary.md'),
  };
  put(
    'node_modules/devvit/bin/devvit.js',
    `
    import assert from 'node:assert/strict';
    import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
    import {join} from 'node:path';
    const args=process.argv.slice(2), command=args[0], s=process.env.MOCK_SCENARIO;
    assert.equal(process.env.CI,'true'); assert.equal(process.env.MY_PORTAL,'0');
    assert.equal(process.env.DEVVIT_APP_NAME,'the-daily-lap');assert.equal(process.env.DEVVIT_SUBREDDIT,'theDailyLap');
    assert.equal(process.env.DEVVIT_ALLOW_SOURCE_UPLOAD,'0');
    assert(!process.env.DEVVIT_ROOT_DIR.startsWith(process.cwd()+'/'));
    assert.equal(process.env.DEVVIT_DIR_NAME,'.devvit');
    mkdirSync(join(process.env.DEVVIT_ROOT_DIR,'.devvit'),{recursive:true});
    writeFileSync(join(process.env.DEVVIT_ROOT_DIR,'.devvit/token'),process.env.DEVVIT_AUTH_TOKEN);
    appendFileSync(process.env.MOCK_LOG,JSON.stringify(args)+'\\n');
    console.error(process.env.DEVVIT_AUTH_TOKEN); // Must remain captured, even on failure.
    if(command==='whoami') { if(s==='auth-failed')process.exit(1); console.log('Logged in as u/FixtureOwner'); process.exit(0); }
    if(command==='view') {
      assert.equal(args.at(-1),'--json');
      const exact=args[1].includes('@'), uploaded=existsSync('uploaded.flag');
      if(s==='read-denied'||(s==='post-read-denied'&&uploaded)) {console.error('Error: forbidden');process.exit(1);}
      if(exact&&!uploaded&&s!=='occupied') {
        console.error(s==='ambiguous-absence'?'Error: network failure':'Error: Could not find version 0.0.123');
        process.exit(s==='wrong-absence-exit'?2:1);
      }
      const app={id:s==='wrong-app'?'other-app':${JSON.stringify(EXISTING_APP_ID)},slug:'the-daily-lap',owner:{displayName:s==='wrong-owner'?'OtherOwner':'FixtureOwner'}};
      const version={majorVersion:0,minorVersion:0,patchVersion:exact?123:(s==='too-old'?124:122),visibility:s==='not-private'?2:1,buildStatus:s==='build-failed'?2:s==='building'?0:1};
      if(s==='wrong-post-version'&&uploaded)version.patchVersion=124;
      if(s==='malformed')console.log('not json'); else console.log(JSON.stringify({app,version}));
      process.exit(0);
    }
    assert.deepEqual(args,['upload','--config','.devvit-ci-private-upload.json','--version','0.0.123']);
    const config=JSON.parse(readFileSync('.devvit-ci-private-upload.json','utf8'));
    assert.equal(config.name,'the-daily-lap');assert.equal(config.dev.subreddit,'theDailyLap');assert.deepEqual(config.scripts,{});
    writeFileSync('uploaded.flag','dummy private version');
    if(s==='upload-failed')process.exit(1);
    console.log('Private upload finished.');
  `
  );
  return {
    root,
    env,
    put,
    git,
    calls: () =>
      existsSync(env.MOCK_LOG)
        ? readFileSync(env.MOCK_LOG, 'utf8').trim().split('\n').map(JSON.parse)
        : [],
  };
}

for (const [name, change] of [
  ['PR', { GITHUB_EVENT_NAME: 'pull_request' }],
  ['local', { GITHUB_ACTIONS: 'false' }],
  ['main', { GITHUB_REF: 'refs/heads/main' }],
  ['unprotected', { GITHUB_REF_PROTECTED: 'false' }],
  ['fork', { GITHUB_REPOSITORY: 'someone/reddit_racer' }],
  ['tag', { GITHUB_REF_TYPE: 'tag' }],
  ['missing consent', { UPLOAD_CONFIRM: 'false' }],
  [
    'public consent alone',
    { UPLOAD_CONFIRM: undefined, REVIEW_CONFIRM: 'true' },
  ],
  ['alias', { UPLOAD_VERSION: 'latest' }],
  ['prerelease', { UPLOAD_VERSION: '1.2.3.4' }],
  ['shell input', { UPLOAD_VERSION: '1.2.3 --public' }],
  ['leading zero', { UPLOAD_VERSION: '01.2.3' }],
  ['approved version', { UPLOAD_VERSION: '0.0.20261123' }],
  ['pending version', { UPLOAD_VERSION: '0.0.20261124' }],
  ['wrong source', { UPLOAD_SOURCE_SHA: 'b'.repeat(40) }],
  ['wrong app override', { DEVVIT_APP_NAME: 'another-app' }],
  ['wrong community override', { DEVVIT_SUBREDDIT: 'another-community' }],
  ['missing token', { DEVVIT_AUTH_TOKEN: '' }],
])
  test(`private upload rejects ${name} before any CLI invocation`, (t) => {
    const f = fixture(t);
    assert.throws(() => uploadPrivateVersion(f.root, { ...f.env, ...change }));
    assert.deepEqual(f.calls(), []);
  });

test('private source check needs neither dependencies, build nor credential', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, 'node_modules'), { recursive: true });
  rmSync(join(f.root, 'dist'), { recursive: true });
  privateSourcePreflight(f.root, { ...f.env, DEVVIT_AUTH_TOKEN: undefined });
});

test('tracked edits and modified pinned upload code fail closed', (t) => {
  const f = fixture(t);
  f.put('README.md', '# The Daily Lap\nchanged');
  assert.throws(() => privateSourcePreflight(f.root, f.env), /tracked changes/);
  f.git('checkout', '--', 'README.md');
  f.put('node_modules/@devvit/cli/dist/commands/upload.js', 'changed SDK');
  assert.throws(
    () => privateUploadPreflight(f.root, f.env),
    /contract changed/
  );
});

for (const scenario of [
  'auth-failed',
  'read-denied',
  'wrong-app',
  'wrong-owner',
  'too-old',
  'occupied',
  'ambiguous-absence',
  'wrong-absence-exit',
  'malformed',
])
  test(`private upload stops on ${scenario}, without invoking upload`, (t) => {
    const f = fixture(t, scenario);
    assert.throws(() => uploadPrivateVersion(f.root, f.env));
    assert(!f.calls().some((args) => args[0] === 'upload'));
    assert.deepEqual(readdirSync(f.env.RUNNER_TEMP), []);
  });

for (const scenario of [
  'upload-failed',
  'not-private',
  'build-failed',
  'post-read-denied',
  'wrong-post-version',
])
  test(`private upload ${scenario} has no retry or success receipt and cleans up`, (t) => {
    const f = fixture(t, scenario);
    assert.throws(() => uploadPrivateVersion(f.root, f.env));
    assert.equal(f.calls().filter((args) => args[0] === 'upload').length, 1);
    assert(!existsSync(join(f.root, '.devvit-ci-private-upload.json')));
    assert(!existsSync(f.env.GITHUB_STEP_SUMMARY));
    assert.deepEqual(readdirSync(f.env.RUNNER_TEMP), []);
  });

test('actual wrapper entry point with a mocked CLI withholds credential output on failure', (t) => {
  const f = fixture(t, 'upload-failed');
  const r = spawnSync(
    process.execPath,
    [join(repo, 'scripts/release/devvit-private-upload.mjs'), 'upload'],
    {
      cwd: f.root,
      env: f.env,
      encoding: 'utf8',
    }
  );
  assert.equal(r.status, 1);
  assert(r.stderr.includes('inspect the portal before retrying'));
  assert(!`${r.stdout}${r.stderr}`.includes(auth));
  assert(!`${r.stdout}${r.stderr}`.includes('DUMMY_PRIVATE_ACCESS'));
  assert.equal(f.calls().filter((args) => args[0] === 'upload').length, 1);
  assert.deepEqual(readdirSync(f.env.RUNNER_TEMP), []);
});

for (const [scenario, build] of [
  ['', 'ready'],
  ['building', 'building'],
])
  test(`private ${build} receipt verifies the exact version without publish, install or playtest`, (t) => {
    const f = fixture(t, scenario),
      r = uploadPrivateVersion(f.root, f.env);
    assert.deepEqual(r, {
      app: 'the-daily-lap',
      version: '0.0.123',
      source: f.env.GITHUB_SHA,
      visibility: 'private',
      build,
      installed: false,
      published: false,
    });
    assert.deepEqual(
      f.calls().map((args) => args[0]),
      ['whoami', 'view', 'view', 'upload', 'view']
    );
    assert(
      !f
        .calls()
        .flat()
        .some((arg) =>
          [
            'publish',
            'install',
            'playtest',
            '--bump',
            '--just-do-it',
            '--employee-update',
            '--token',
          ].includes(arg)
        )
    );
    const summary = readFileSync(f.env.GITHUB_STEP_SUMMARY, 'utf8');
    assert(summary.includes('No publication or installation requested.'));
    assert(!summary.includes(auth));
    assert(!existsSync(join(f.root, '.devvit-ci-private-upload.json')));
    assert.deepEqual(readdirSync(f.env.RUNNER_TEMP), []);
  });

test('private upload preserves an existing config and rejects an inside-project auth root', (t) => {
  const f = fixture(t);
  f.put('.devvit-ci-private-upload.json', 'existing');
  assert.throws(() => uploadPrivateVersion(f.root, f.env));
  assert.equal(
    readFileSync(join(f.root, '.devvit-ci-private-upload.json'), 'utf8'),
    'existing'
  );
  assert(!f.calls().some((args) => args[0] === 'upload'));
  assert.throws(
    () => uploadPrivateVersion(f.root, { ...f.env, RUNNER_TEMP: f.root }),
    /outside the project/
  );
});

test('private workflow is manual, immutable/protected and secret-scoped, sharing the public version mutex', () => {
  const w = load(
    readFileSync(
      join(repo, '.github/workflows/devvit-private-upload.yaml'),
      'utf8'
    )
  );
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(w.on.workflow_dispatch.inputs).sort(), [
    'confirm_private_upload',
    'source_sha',
    'version',
  ]);
  assert.equal(
    w.on.workflow_dispatch.inputs.confirm_private_upload.default,
    false
  );
  assert.deepEqual(w.permissions, { contents: 'read' });
  assert.equal(w.concurrency.group, 'the-daily-lap-release');
  assert.equal(w.concurrency['cancel-in-progress'], false);
  assert.deepEqual(Object.keys(w.jobs), ['upload']);
  const j = w.jobs.upload;
  assert.equal(j.environment, undefined);
  for (const part of [
    "github.event_name == 'workflow_dispatch'",
    "github.repository == 'kickflip-games/reddit_racer'",
    "github.ref == 'refs/heads/release/daily-lap'",
    'github.ref_protected == true',
    'inputs.confirm_private_upload == true',
  ])
    assert(j.if.includes(part));
  const secrets = j.steps.filter((step) =>
    JSON.stringify(step).includes('secrets.')
  );
  assert.equal(secrets.length, 1);
  assert.equal(secrets[0], j.steps.at(-1));
  assert.deepEqual(secrets[0].env, {
    DEVVIT_AUTH_TOKEN: '${{ secrets.DEVVIT_AUTH_TOKEN }}',
  });
  assert.deepEqual(
    j.steps.filter((s) => s.run).map((s) => s.run),
    [
      'node scripts/release/devvit-private-upload.mjs source',
      'npm ci --ignore-scripts --no-fund',
      'npm run build',
      'node scripts/release/devvit-private-upload.mjs preflight',
      'node scripts/release/devvit-private-upload.mjs upload',
    ]
  );
  for (const s of j.steps) {
    if (s.run) assert(!s.run.includes('${{'));
    if (s.uses) assert(/@[0-9a-f]{40}$/.test(s.uses));
    if (s.uses?.startsWith('actions/checkout@')) {
      assert.equal(s.with.ref, '${{ github.sha }}');
      assert.equal(s.with['persist-credentials'], false);
    }
  }
});

test('pinned CLI explicitly selects private/exact version and suppresses both provisioning and install when Dev target exists', () => {
  const read = (p) =>
    readFileSync(join(repo, 'node_modules/@devvit/cli/dist', p), 'utf8');
  const u = read('commands/upload.js'),
    uploader = read('util/AppVersionUploader.js');
  for (const snippet of [
    'let appVersionNumber = flags.version;',
    'visibility: VersionVisibility.PRIVATE,',
    "let shouldCreatePlaytestSubreddit = !this.project.getSubreddit('Dev');",
    '}, bundles, !shouldCreatePlaytestSubreddit);',
    'if (shouldCreatePlaytestSubreddit) {\n                const installationInfo',
  ])
    assert(u.includes(snippet));
  assert(
    uploader.includes(
      'preventPlaytestSubredditCreation: preventSubredditCreation,'
    )
  );
  assert(!u.includes('.Submit('));
  assert(!u.includes('AppPublishRequestVisibility'));
  assert(read('commands/whoami.js').includes('Logged in as u/${userName}'));
  const constants = readFileSync(
    join(repo, 'node_modules/@devvit/shared-types/constants.js'),
    'utf8'
  );
  assert(constants.includes('MAX_ALLOWED_SUBSCRIBER_COUNT = 200;'));
});

test('real pinned flags accept exact stable versions, and project loader sees the suppression target without auth/network', (t) => {
  const f = fixture(t);
  f.put('.devvit-ci-private-upload.json', {
    ...JSON.parse(readFileSync(join(f.root, 'devvit.json'), 'utf8')),
    dev: { subreddit: 'theDailyLap' },
    scripts: {},
  });
  const url = (p) => pathToFileURL(join(repo, 'node_modules', p)).href;
  const r = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';const {default:Upload}=await import(${JSON.stringify(url('@devvit/cli/dist/commands/upload.js'))});const {parse}=await import(${JSON.stringify(url('@oclif/core/lib/parser/index.js'))});const {flags}=await parse(['--version','1.2.3'],{flags:Upload.flags});assert.equal(flags.version.toString(),'1.2.3');assert.equal(flags.bump,undefined);const {newProject}=await import(${JSON.stringify(url('@devvit/cli/dist/util/project.js'))});const p=await newProject('.devvit-ci-private-upload.json','Dynamic');assert.equal(p.name,'the-daily-lap');assert.equal(p.getSubreddit('Dev'),'theDailyLap');assert.deepEqual(p.appConfig.scripts,{});`,
    ],
    { cwd: f.root, env: context, encoding: 'utf8' }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(f.calls(), []);
});
