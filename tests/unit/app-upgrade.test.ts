import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Hono } from 'hono';
import {
  createAppUpgradeRouter,
  type AppUpgradeDependencies,
  type AppUpgradePublication,
} from '../../src/server/routes/app-upgrade.ts';

const path = '/internal/triggers/on-app-upgrade';
function mounted(deps: AppUpgradeDependencies): Hono {
  const triggers = new Hono();
  triggers.route('/', createAppUpgradeRouter(deps));
  const internal = new Hono();
  internal.route('/triggers', triggers);
  const app = new Hono();
  app.route('/internal', internal);
  return app;
}
function request(body = '{"type":"AppUpgrade"}', endpoint = path): Request {
  return new Request(`http://upgrade.test${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void test('invalid upgrade envelopes perform no publication or reporting', async () => {
  const calls: string[] = [];
  const app = mounted({
    ensure: async () => {
      calls.push('ensure');
      return { status: 'ready', postId: 't3_ready' };
    },
    reportPublication: () => calls.push('report publication'),
    reportError: () => calls.push('report error'),
  });
  for (const body of [
    '',
    '{bad',
    'null',
    '[]',
    'true',
    '42',
    '"AppUpgrade"',
    '{}',
    '{"type":"AppInstall"}',
    '{"type":1}',
  ]) {
    const response = await app.request(request(body));
    assert.equal(response.status, 400);
    assert.match(
      response.headers.get('Content-Type') ?? '',
      /^application\/json/
    );
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {
      status: 'error',
      message: 'An app upgrade event is required.',
    });
  }
  assert.deepEqual(calls, []);
});

void test('upgrade framework metadata supplies no authority and success waits for publication', async () => {
  const args: unknown[][] = [];
  const reports: AppUpgradePublication[] = [];
  let enter: () => void = () => {},
    finish: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let settled = false;
  const publication = { status: 'ready', postId: 't3_ready' };
  const app = mounted({
    ensure: async (...received: unknown[]) => {
      args.push(received);
      enter();
      await completed;
      return publication;
    },
    reportPublication: (result) => reports.push(result),
    reportError: () => assert.fail('Unexpected upgrade error'),
  });
  const pending = Promise.resolve(
    app.request(
      request(
        JSON.stringify({
          type: 'AppUpgrade',
          subreddit: { id: 't5_untrusted' },
          installer: { id: 't2_untrusted' },
          day: '2099-01-01',
          postId: 't3_untrusted',
        })
      )
    )
  );
  void pending.then(() => {
    settled = true;
  });
  await started;
  assert.equal(settled, false);
  assert.deepEqual(reports, []);
  assert.deepEqual(args, [[]]);
  finish();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'success',
    message: 'Daily race publication: ready.',
  });
  assert.deepEqual(reports, [publication]);
});

void test('busy, uncertain and unavailable publication are acknowledged without claiming a ready race', async () => {
  for (const status of ['busy', 'uncertain', 'unavailable']) {
    const app = mounted({
      ensure: async () => ({ status, postId: null }),
      reportPublication: () => {},
      reportError: () => assert.fail('Unexpected upgrade error'),
    });
    const response = await app.request(request());
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), {
      status: 'success',
      message: `Daily race publication: ${status}.`,
    });
    assert.equal(body.includes('ready'), false);
  }
});

void test('publication rejection exposes no secrets and error reporting receives no arguments', async () => {
  const reports: unknown[][] = [];
  const app = mounted({
    ensure: async () => {
      throw new Error('SECRET Reddit token');
    },
    reportPublication: () =>
      assert.fail('A failed publication cannot be reported'),
    reportError: (...args: unknown[]) => {
      reports.push(args);
      throw new Error('SECRET logger');
    },
  });
  const response = await app.request(request());
  assert.equal(response.status, 500);
  const body = await response.text();
  assert.equal(body.includes('SECRET'), false);
  assert.deepEqual(JSON.parse(body), {
    status: 'error',
    message: 'App upgrade could not complete.',
  });
  assert.deepEqual(reports, [[]]);
});

void test('a throwing publication reporter cannot reverse an awaited successful side effect', async () => {
  let ensured = 0;
  const app = mounted({
    ensure: async () => {
      ensured++;
      return { status: 'ready', postId: 't3_ready' };
    },
    reportPublication: () => {
      throw new Error('SECRET publication reporter');
    },
    reportError: () =>
      assert.fail('Logger errors must not reverse publication'),
  });
  const response = await app.request(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'success',
    message: 'Daily race publication: ready.',
  });
  assert.equal(ensured, 1);
});

void test('wrong methods or paths cannot invoke the upgrade work', async () => {
  let calls = 0;
  const app = mounted({
    ensure: async () => {
      calls++;
      return { status: 'ready', postId: 't3_ready' };
    },
    reportPublication: () => {},
    reportError: () => {},
  });
  assert.equal((await app.request(path)).status, 404);
  assert.equal(
    (await app.request(request(undefined, '/on-app-upgrade'))).status,
    404
  );
  assert.equal(calls, 0);
});

void test('the registered upgrade bootstrap keeps the app identity and uses the mounted internal endpoint', async () => {
  const config: unknown = JSON.parse(
    readFileSync(new URL('../../devvit.json', import.meta.url), 'utf8')
  );
  assert.ok(record(config));
  assert.equal(config.name, 'the-daily-lap');
  assert.ok(record(config.triggers));
  assert.equal(config.triggers.onAppUpgrade, path);
  const endpoint = config.triggers.onAppUpgrade;
  let ensured = 0;
  const app = mounted({
    ensure: async () => {
      ensured++;
      return { status: 'ready', postId: 't3_ready' };
    },
    reportPublication: () => {},
    reportError: () => {},
  });
  const response = await app.request(request(undefined, endpoint));
  assert.equal(response.status, 200);
  assert.equal(ensured, 1);
});
