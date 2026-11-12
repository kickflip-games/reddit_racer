import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Hono } from 'hono';
import { createAppInstallRouter } from '../../src/server/routes/app-install.ts';
import type { AppInstallDependencies } from '../../src/server/routes/app-install.ts';

/** Same nesting and full endpoint used by the production internal routes. */
function mounted(deps: AppInstallDependencies): Hono {
  const triggers = new Hono();
  triggers.route('/', createAppInstallRouter(deps));
  const internal = new Hono();
  internal.route('/triggers', triggers);
  const app = new Hono();
  app.route('/internal', internal);
  return app;
}
const path = '/internal/triggers/on-app-install';
const request = (body: string) =>
  new Request(`http://install.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

void test('invalid or malformed install requests perform no post creation or error reporting', async () => {
  let creations = 0,
    reports = 0;
  const app = mounted({
    createPost: async () => {
      creations++;
    },
    reportError: () => {
      reports++;
    },
  });
  for (const body of [
    '',
    '{bad',
    'null',
    '[]',
    '"AppInstall"',
    '42',
    'true',
    '{}',
    '{"type":"AppUpgrade"}',
    '{"type":1}',
  ]) {
    const response = await app.request(request(body));
    assert.equal(response.status, 400);
    assert.match(
      response.headers.get('content-type') ?? '',
      /^application\/json/
    );
    assert.deepEqual(await response.json(), {
      status: 'error',
      message: 'An app installation event is required.',
    });
  }
  assert.equal(creations, 0);
  assert.equal(reports, 0);
});

void test('valid SDK metadata is accepted and the mounted route awaits creation before acknowledging success', async () => {
  let creations = 0,
    reports = 0,
    settled = false;
  let entered: () => void = () => {},
    finish: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const app = mounted({
    createPost: async () => {
      creations++;
      entered();
      await completed;
      return { id: 't3_created' };
    },
    reportError: () => {
      reports++;
    },
  });
  const pending = Promise.resolve(
    app.request(
      request(
        JSON.stringify({
          type: 'AppInstall',
          subreddit: { id: 't5_home', name: 'private_home' },
          installer: { id: 't2_owner', name: 'Owner' },
        })
      )
    )
  );
  void pending.then(() => {
    settled = true;
  });
  await started;
  assert.equal(creations, 1);
  assert.equal(settled, false);
  finish();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'success',
    message: 'Race post created.',
  });
  assert.equal(reports, 0);
});

void test('SDK creation rejection yields a fixed server failure and never exposes raw error or request metadata', async () => {
  const reportedArguments: unknown[][] = [];
  const app = mounted({
    createPost: async () => {
      throw new Error('SDK token=SECRET owner=PrivateOwner');
    },
    reportError: (...args: unknown[]) => {
      reportedArguments.push(args);
    },
  });
  const response = await app.request(
    request('{"type":"AppInstall","installer":{"name":"PrivateOwner"}}')
  );
  assert.equal(response.status, 500);
  assert.match(
    response.headers.get('content-type') ?? '',
    /^application\/json/
  );
  const body = await response.text();
  assert.equal(body.includes('SECRET'), false);
  assert.equal(body.includes('PrivateOwner'), false);
  assert.deepEqual(JSON.parse(body), {
    status: 'error',
    message: 'Race post creation is unavailable.',
  });
  assert.deepEqual(reportedArguments, [[]]);
});

void test('wrong HTTP methods do not reach an install side effect', async () => {
  let creations = 0;
  const app = mounted({
    createPost: async () => {
      creations++;
    },
    reportError: () => {},
  });
  assert.equal((await app.request(path)).status, 404);
  assert.equal(creations, 0);
});
