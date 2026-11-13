import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Hono } from 'hono';
import {
  DAILY_RACE_TASK_NAME,
  createDailySchedulerRouter,
  type DailySchedulerDependencies,
  type DailySchedulerResult,
} from '../../src/server/routes/daily-scheduler.ts';

const endpoint = '/internal/scheduler/ensure-daily-race';
const task = { name: DAILY_RACE_TASK_NAME, data: { schemaVersion: 1 } };
function mounted(deps: DailySchedulerDependencies): Hono {
  const internal = new Hono();
  internal.route('/scheduler', createDailySchedulerRouter(deps));
  const app = new Hono();
  app.route('/internal', internal);
  return app;
}
function request(body: string, path = endpoint): Request {
  return new Request(`http://scheduler.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void test('malformed, unsupported and authority-bearing scheduler bodies never reach publication', async () => {
  let ensured = 0;
  const reports: unknown[] = [];
  const app = mounted({
    ensure: async () => {
      ensured++;
      return { status: 'created', postId: 't3_created' };
    },
    reportResult: (value) => reports.push(value),
    reportError: () => reports.push('error'),
  });
  const bodies = [
    '',
    '{bad',
    'null',
    '[]',
    'true',
    '42',
    '"ensure-daily-race"',
    '{}',
    JSON.stringify({ name: DAILY_RACE_TASK_NAME }),
    JSON.stringify({ data: { schemaVersion: 1 } }),
    JSON.stringify({ name: 'other-task', data: { schemaVersion: 1 } }),
    JSON.stringify({ name: DAILY_RACE_TASK_NAME, data: {} }),
    JSON.stringify({ name: DAILY_RACE_TASK_NAME, data: null }),
    JSON.stringify({ name: DAILY_RACE_TASK_NAME, data: [] }),
    JSON.stringify({
      name: DAILY_RACE_TASK_NAME,
      data: { schemaVersion: '1' },
    }),
    JSON.stringify({ name: DAILY_RACE_TASK_NAME, data: { schemaVersion: 2 } }),
  ];
  for (const field of [
    'day',
    'subredditId',
    'postId',
    'userId',
    'authority',
    'extra',
  ]) {
    bodies.push(JSON.stringify({ ...task, [field]: 'client-selected' }));
    bodies.push(
      JSON.stringify({
        ...task,
        data: { ...task.data, [field]: 'client-selected' },
      })
    );
  }
  for (const body of bodies) {
    const response = await app.request(request(body));
    assert.equal(response.status, 400, body);
    assert.match(
      response.headers.get('Content-Type') ?? '',
      /^application\/json/
    );
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), {
      status: 'error',
      message: 'A valid daily race task is required.',
    });
  }
  assert.equal(ensured, 0);
  assert.deepEqual(reports, []);
});

void test('the full mounted scheduler route awaits publication and reports only its settled result', async () => {
  let entered: () => void = () => {},
    finish: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = { status: 'created', postId: 't3_created' };
  const argumentsReceived: unknown[][] = [];
  const reported: DailySchedulerResult[] = [];
  let settled = false;
  const app = mounted({
    ensure: async (...args: unknown[]) => {
      argumentsReceived.push(args);
      entered();
      await completed;
      return result;
    },
    reportResult: (value) => reported.push(value),
    reportError: () => assert.fail('Unexpected error report'),
  });
  const pending = Promise.resolve(
    app.request(
      request(JSON.stringify(task), `${endpoint}?day=client&subredditId=client`)
    )
  );
  void pending.then(() => {
    settled = true;
  });
  await started;
  assert.equal(settled, false);
  assert.deepEqual(reported, []);
  assert.deepEqual(argumentsReceived, [[]]);
  finish();
  const response = await pending;
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    status: 'ok',
    publication: 'created',
    postId: 't3_created',
  });
  assert.deepEqual(reported, [result]);
});

void test('pending or existing publication statuses preserve the service result without inventing a post', async () => {
  for (const result of [
    { status: 'pending', postId: null },
    { status: 'existing', postId: 't3_existing' },
  ]) {
    const app = mounted({
      ensure: async () => result,
      reportResult: () => {},
      reportError: () => assert.fail('Unexpected error report'),
    });
    const response = await app.request(request(JSON.stringify(task)));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      publication: result.status,
      postId: result.postId,
    });
  }
});

void test('publication failure is fixed JSON and safe reporting receives no secret error or request data', async () => {
  const reports: unknown[][] = [];
  const app = mounted({
    ensure: async () => {
      throw new Error('SDK token=SECRET owner=PRIVATE_OWNER');
    },
    reportResult: () =>
      assert.fail('A failure cannot report a publication result'),
    reportError: (...args: unknown[]) => {
      reports.push(args);
    },
  });
  const response = await app.request(request(JSON.stringify(task)));
  assert.equal(response.status, 500);
  assert.match(
    response.headers.get('Content-Type') ?? '',
    /^application\/json/
  );
  const body = await response.text();
  assert.equal(body.includes('SECRET'), false);
  assert.equal(body.includes('PRIVATE_OWNER'), false);
  assert.deepEqual(JSON.parse(body), {
    status: 'error',
    message: 'The daily race task could not complete.',
  });
  assert.deepEqual(reports, [[]]);
});

void test('throwing diagnostic callbacks cannot reverse publication success or expose a failure', async () => {
  for (const succeeds of [true, false]) {
    let ensured = 0;
    const app = mounted({
      ensure: async () => {
        ensured++;
        if (!succeeds) throw new Error('SECRET service error');
        return { status: 'created', postId: 't3_created' };
      },
      reportResult: () => {
        throw new Error('SECRET result logger');
      },
      reportError: () => {
        throw new Error('SECRET error logger');
      },
    });
    const response = await app.request(request(JSON.stringify(task)));
    assert.equal(response.status, succeeds ? 200 : 500);
    const body = await response.text();
    assert.equal(body.includes('SECRET'), false);
    assert.deepEqual(
      JSON.parse(body),
      succeeds
        ? { status: 'ok', publication: 'created', postId: 't3_created' }
        : {
            status: 'error',
            message: 'The daily race task could not complete.',
          }
    );
    assert.equal(ensured, 1);
  }
});

void test('wrong methods and public or unmounted paths cannot invoke the internal task', async () => {
  let ensured = 0;
  const app = mounted({
    ensure: async () => {
      ensured++;
      return { status: 'existing', postId: null };
    },
    reportResult: () => {},
    reportError: () => {},
  });
  for (const path of [
    endpoint,
    '/scheduler/ensure-daily-race',
    '/api/ensure-daily-race',
  ]) {
    assert.equal((await app.request(path)).status, 404);
    if (path !== endpoint)
      assert.equal(
        (await app.request(request(JSON.stringify(task), path))).status,
        404
      );
  }
  assert.equal(ensured, 0);
});

void test('the registered task keeps the existing app identity and resolves to the same full mounted endpoint', async () => {
  const config: unknown = JSON.parse(
    readFileSync(new URL('../../devvit.json', import.meta.url), 'utf8')
  );
  assert.ok(record(config));
  assert.equal(config.name, 'full-throttle-dev');
  assert.ok(record(config.dev));
  assert.equal(config.dev.subreddit, 'full_throttle_dev_dev');
  assert.ok(record(config.scheduler));
  assert.ok(record(config.scheduler.tasks));
  const registration = config.scheduler.tasks[DAILY_RACE_TASK_NAME];
  assert.ok(record(registration));
  assert.equal(registration.endpoint, endpoint);
  assert.equal(registration.cron, '*/5 * * * *');
  assert.deepEqual(registration.data, { schemaVersion: 1 });
  const app = mounted({
    ensure: async () => ({ status: 'existing', postId: 't3_existing' }),
    reportResult: () => {},
    reportError: () => {},
  });
  const response = await app.request(
    request(
      JSON.stringify({ name: DAILY_RACE_TASK_NAME, data: registration.data }),
      registration.endpoint
    )
  );
  assert.equal(response.status, 200);
});
