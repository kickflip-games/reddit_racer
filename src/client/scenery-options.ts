import type { SceneryOptions } from './scenery-layout';

export type SceneryPreference = 'auto' | 'standard' | 'light';
/** Ranked production receives only the device fallback, never workshop overrides. */
export function readSceneryOptions(
  preference: SceneryPreference = 'auto',
  explicit = false
): SceneryOptions {
  const automatic =
    navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4
      ? 'light'
      : 'standard';
  const quality = preference === 'auto' ? automatic : preference;
  if (!import.meta.env.DEV)
    return { quality, wind: quality !== 'light', lighting: 'toon' };
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
    lighting: query.get('lighting') === 'soft' ? 'soft' : 'toon',
  };
}
