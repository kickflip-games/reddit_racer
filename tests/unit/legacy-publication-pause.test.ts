import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDevvitDailyPublicationService } from '../../src/server/devvit-daily-publication.ts';

void test('legacy publication is an SDK-independent no-op, including repeated scheduler/bootstrap calls', async () => {
  const service = createDevvitDailyPublicationService();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => service.ensureToday())
  );
  for (const result of results) {
    assert.equal(result.status, 'unavailable');
    assert.equal(result.postId, null);
    assert.match(result.day, /^\d{4}-\d{2}-\d{2}$/);
  }
  // A paused release must not silently reintroduce an SDK/Redis write path.
  const source = readFileSync('src/server/devvit-daily-publication.ts', 'utf8');
  assert.doesNotMatch(
    source,
    /from ['"]@devvit|submitCustomPost|createRedis|createDailyPublicationService\(/
  );
  const config = JSON.parse(readFileSync('devvit.json', 'utf8'));
  assert.equal(config.name, 'full-throttle-dev');
});
