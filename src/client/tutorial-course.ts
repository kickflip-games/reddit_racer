import { createOvalTrack } from '../shared/track-authoring';
import { validateTrack, type Track } from '../shared/track';

/** Wide and flat, but using the same current handling as newly generated races. */
export function createTutorialCourse(): Track {
  const oval = createOvalTrack({
    radiusX: 32,
    radiusZ: 52,
    width: 12,
    seed: 'driving-lesson',
  });
  const track: Track = {
    ...oval,
    schemaVersion: 2,
    generatorVersion: 'tutorial-circuit-v1',
    samples: oval.samples.map((sample) => ({
      ...sample,
      y: 0,
      grade: 0,
      verticalCurvature: 0,
    })),
    jumps: [],
  };
  validateTrack(track);
  return track;
}
