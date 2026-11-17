/** Ease visual facing only; authoritative position, speed and replay stay untouched. */
export function smoothCarHeading(
  current: number,
  target: number,
  deltaSeconds: number,
  reset: boolean
): number {
  if (reset) return target;
  const delta = Math.atan2(
    Math.sin(target - current),
    Math.cos(target - current)
  );
  const dt = Math.min(0.05, Math.max(0, deltaSeconds));
  // Take the shortest arc, with a fast response and no one-frame restart snap.
  const step = delta * (1 - Math.exp(-dt / 0.08));
  const limit = 4 * dt;
  if (Math.abs(delta) < 0.00001 && dt > 0) return target;
  return current + Math.max(-limit, Math.min(limit, step));
}
