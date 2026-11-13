import type { SceneryOptions } from './scenery-layout';

export type SceneryPreference = 'auto' | 'standard' | 'light';
const key = 'reddit-racer.scenery-detail.v1';
let sessionPreference: SceneryPreference | undefined;
export function readSceneryPreference(): SceneryPreference {
  if (sessionPreference !== undefined) return sessionPreference;
  try {
    const value = localStorage.getItem(key);
    return value === 'standard' || value === 'light' ? value : 'auto';
  } catch {
    return 'auto';
  }
}
export function saveSceneryPreference(value: SceneryPreference): void {
  sessionPreference = value;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Session choice still applies. */
  }
}

/** Ranked production receives only the device fallback, never workshop overrides. */
export function readSceneryOptions(
  preference = readSceneryPreference(),
  explicit = false
): SceneryOptions {
  const automatic =
    navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4
      ? 'light'
      : 'standard';
  const quality = preference === 'auto' ? automatic : preference;
  if (!import.meta.env.DEV) return { quality, wind: quality !== 'light' };
  const query = new URLSearchParams(window.location.search);
  const number = (name: string): number =>
    query.has(name) ? Number(query.get(name)) : 1;
  const selectedQuality = explicit
    ? quality
    : query.get('sceneryQuality') === 'light'
      ? 'light'
      : query.get('sceneryQuality') === 'standard'
        ? 'standard'
        : quality;
  return {
    quality: selectedQuality,
    seed: (query.get('scenerySeed') ?? 'default').slice(0, 96),
    regions: number('regions'),
    trees: number('trees'),
    groundCover: number('cover'),
    wind: query.has('wind')
      ? query.get('wind') !== '0'
      : selectedQuality !== 'light',
    lighting: query.get('lighting') === 'toon' ? 'toon' : 'soft',
  };
}
