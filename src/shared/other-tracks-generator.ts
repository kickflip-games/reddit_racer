import { generateElevatedCircuit } from './elevated-generator';
/** Explicitly opt-in; existing daily and legacy links keep their old generator. */
export const OTHER_TRACKS_GENERATOR_VERSION = 'other-tracks-v1';
export function generateOtherTracksCircuit(seed: string) {
  return generateElevatedCircuit(
    seed,
    { lengthMin: 730, lengthMax: 800 },
    OTHER_TRACKS_GENERATOR_VERSION
  );
}
