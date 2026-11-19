import { sampleTrack, type Track } from '../shared/track';
import { jumpRoadHeight } from '../shared/stunt-course';

export type HomePreviewMode = 'playing' | 'paused' | 'static';
export type HomePreviewPose = Readonly<{
  distance: number;
  x: number;
  z: number;
  elevation: number;
  heading: number;
  grade: number;
  speed: number;
}>;

/** A visual distance clock on the loaded circuit. It owns no race state or input. */
export function createHomePreview(track: Track) {
  let distance = 0;
  return {
    reset(): void {
      distance = 0;
    },
    update(deltaSeconds: number, mode: HomePreviewMode): HomePreviewPose {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
        throw new Error('Preview time must be finite and nonnegative');
      if (mode === 'static') distance = 0;
      const speed = mode === 'playing' ? 14 : 0;
      distance =
        (distance + Math.min(0.1, deltaSeconds) * speed) % track.totalLength;
      const frame = sampleTrack(track, track.startS + distance);
      return {
        distance,
        x: frame.x,
        z: frame.z,
        elevation:
          (frame.y ?? 0) +
          (track.schemaVersion === 2
            ? 0
            : jumpRoadHeight(track.jumps ?? [], frame.s)),
        heading: Math.atan2(frame.tx, frame.tz),
        grade: frame.grade ?? 0,
        speed,
      };
    },
  };
}
