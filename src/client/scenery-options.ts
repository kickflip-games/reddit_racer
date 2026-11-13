import type { SceneryOptions } from './scenery-layout';

/** Ranked production receives only the device fallback, never workshop overrides. */
export function readSceneryOptions(): SceneryOptions {
  const quality =
    navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4
      ? 'light'
      : 'standard';
  if (!import.meta.env.DEV) return { quality };
  const query = new URLSearchParams(window.location.search);
  const number = (name: string): number =>
    query.has(name) ? Number(query.get(name)) : 1;
  return {
    quality:
      query.get('sceneryQuality') === 'light'
        ? 'light'
        : query.get('sceneryQuality') === 'standard'
          ? 'standard'
          : quality,
    seed: (query.get('scenerySeed') ?? 'default').slice(0, 96),
    regions: number('regions'),
    trees: number('trees'),
    groundCover: number('cover'),
    wind: query.get('wind') !== '0',
    lighting: query.get('lighting') === 'toon' ? 'toon' : 'soft',
  };
}
