import { Hono } from 'hono';

export const DAILY_RACE_TASK_NAME = 'ensure-daily-race';
export type DailySchedulerResult = { status: string; postId: string | null };
export type DailySchedulerDependencies = {
  ensure: () => Promise<DailySchedulerResult>;
  reportResult: (result: DailySchedulerResult) => void;
  reportError: () => void;
};

function isTask(input: unknown): boolean {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 2 ||
    !('name' in input) ||
    input.name !== DAILY_RACE_TASK_NAME ||
    !('data' in input)
  )
    return false;
  const data = input.data;
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    Object.keys(data).length === 1 &&
    'schemaVersion' in data &&
    data.schemaVersion === 1
  );
}

/** Internal task envelope validation is separate from the adapter's trusted SDK scope. */
export function createDailySchedulerRouter(
  deps: DailySchedulerDependencies
): Hono {
  const app = new Hono();
  app.post('/ensure-daily-race', async (c) => {
    c.header('Cache-Control', 'no-store');
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      return c.json(
        { status: 'error', message: 'A valid daily race task is required.' },
        400
      );
    }
    if (!isTask(input))
      return c.json(
        { status: 'error', message: 'A valid daily race task is required.' },
        400
      );
    let result: DailySchedulerResult;
    try {
      result = await deps.ensure();
    } catch {
      try {
        deps.reportError();
      } catch {
        // A diagnostic failure never changes the fixed, safe HTTP response.
      }
      return c.json(
        { status: 'error', message: 'The daily race task could not complete.' },
        500
      );
    }
    try {
      deps.reportResult(result);
    } catch {
      // Publication has already settled; logging cannot turn it into a failed task.
    }
    return c.json(
      { status: 'ok', publication: result.status, postId: result.postId },
      200
    );
  });
  return app;
}
