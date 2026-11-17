import test from 'node:test';
import assert from 'node:assert/strict';
import { createTutorialCourse } from '../../src/client/tutorial-course.ts';
import {
  ELEVATED_HANDLING,
  ELEVATED_SIMULATION_VERSION,
  runtimeForTrack,
} from '../../src/shared/scored-runtime.ts';
import { validateTrack } from '../../src/shared/track.ts';
void test('tutorial is a forgiving flat course with current race handling', () => {
  const course = createTutorialCourse();
  validateTrack(course);
  assert.equal(runtimeForTrack(course).handling, ELEVATED_HANDLING);
  assert.equal(
    runtimeForTrack(course).simulationVersion,
    ELEVATED_SIMULATION_VERSION
  );
  assert.ok(
    course.samples.every((p) => p.width === 12 && p.y === 0 && p.grade === 0)
  );
  assert.equal(course.jumps?.length, 0);
});
