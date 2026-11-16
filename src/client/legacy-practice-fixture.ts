/** Development-only historical geometry for existing renderer/physics fixtures.
 * Not linked from the production game; ordinary courses use the braking generator.
 */
import { generateElevatedCircuit } from '../shared/elevated-generator';
import { hashTrack } from '../shared/track';
export async function generateLegacyPracticeFixture(seed: string) {
  const result = generateElevatedCircuit(seed);
  if (!result.quality.valid) throw new Error('Invalid development fixture.');
  return {
    track: result.track,
    seed,
    fallbackUsed: result.diagnostics.fallbackUsed,
    trackHash: await hashTrack(result.track),
    wordCourse: undefined,
  };
}
