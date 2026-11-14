/** Presentation only. Never fed back into the deterministic vehicle simulation. */
export function createLandingFeedback() {
  let attempt = -1;
  let count = 0;
  let age = 1;
  let strength = 0;
  return {
    update(frame: {
      attemptId: number;
      landings: number;
      impact: number;
      active: boolean;
      reducedMotion: boolean;
      deltaSeconds: number;
    }) {
      const fresh = frame.attemptId !== attempt || frame.landings < count;
      const landed = !fresh && frame.landings > count;
      attempt = frame.attemptId;
      count = frame.landings;
      if (fresh || !frame.active || frame.reducedMotion) {
        age = 1;
        strength = 0;
      } else if (landed) {
        age = 0;
        strength = Math.min(1, Math.max(0, frame.impact));
      } else {
        age += Math.min(0.05, Math.max(0, frame.deltaSeconds));
      }
      const envelope = age < 0.45 ? Math.exp(-age * 12) : 0;
      if (envelope === 0 || strength === 0)
        return { compression: 0, cameraPixels: 0 };
      return {
        // One compression, a smaller rebound, then exactly at rest.
        compression: strength * envelope * Math.cos(age * 18) * 0.09,
        cameraPixels: strength * envelope * Math.sin(age * 24) * 1.5,
      };
    },
  };
}
