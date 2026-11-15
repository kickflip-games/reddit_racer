export type GhostPoint = [number, number, number, number];
export type GhostLap = { ticks: number; points: GhostPoint[] };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const key = 'reddit-racer.best-ghost.v1';
export const MAX_GHOST_POINTS = 4096;
function validLap(value: unknown): value is GhostLap {
  if (
    !value ||
    typeof value !== 'object' ||
    !('ticks' in value) ||
    !('points' in value)
  )
    return false;
  if (
    typeof value.ticks !== 'number' ||
    !Number.isSafeInteger(value.ticks) ||
    value.ticks <= 0 ||
    !Array.isArray(value.points) ||
    value.points.length < 2 ||
    value.points.length > MAX_GHOST_POINTS
  )
    return false;
  let previous = -1;
  for (const p of value.points) {
    if (
      !Array.isArray(p) ||
      p.length !== 4 ||
      !p.every(
        (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e7
      ) ||
      p[0] <= previous ||
      p[0] > value.ticks
    )
      return false;
    previous = p[0];
  }
  return value.points[0][0] === 0 && previous === value.ticks;
}
export function createGhostStore(storage?: Store) {
  const laps = new Map<string, GhostLap>();
  try {
    const raw = storage?.getItem(key);
    const entries: unknown = raw && JSON.parse(raw);
    if (Array.isArray(entries))
      for (const entry of entries.slice(-8)) {
        if (
          Array.isArray(entry) &&
          typeof entry[0] === 'string' &&
          entry[0].length < 20000 &&
          validLap(entry[1])
        )
          laps.set(entry[0], entry[1]);
      }
  } catch {
    /* Private browsing/corrupt storage must not affect racing. */
  }
  return {
    get(course: string) {
      return laps.get(course) ?? null;
    },
    save(course: string, lap: GhostLap) {
      if (!validLap(lap) || (laps.get(course)?.ticks ?? Infinity) <= lap.ticks)
        return false;
      laps.delete(course);
      laps.set(course, lap);
      while (laps.size > 8) {
        const oldest = laps.keys().next().value;
        if (oldest !== undefined) laps.delete(oldest);
      }
      try {
        storage?.setItem(key, JSON.stringify([...laps]));
      } catch {
        /* Retain session best. */
      }
      return true;
    },
  };
}
export function ghostPosition(
  lap: GhostLap,
  ticks: number
): [number, number, number] | null {
  if (ticks < 0 || ticks > lap.ticks) return null;
  let low = 0,
    high = lap.points.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (lap.points[mid]![0] <= ticks) low = mid;
    else high = mid;
  }
  const a = lap.points[low]!,
    b = lap.points[high]!;
  const f = Math.max(0, Math.min(1, (ticks - a[0]) / (b[0] - a[0])));
  return [
    a[1] + f * (b[1] - a[1]),
    a[2] + f * (b[2] - a[2]),
    a[3] + f * (b[3] - a[3]),
  ];
}
