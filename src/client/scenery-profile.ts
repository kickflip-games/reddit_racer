/** Composition changes, not biomes: every course remains green countryside.
 * Derived solely from canonical seed, never device quality or wall-clock time.
 */
export function sceneryHash(value: string): number {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
const profiles = [
  {
    name: 'open-meadow',
    treeDensity: 0.45,
    outcrops: 3,
    hillScale: 0.7,
    regions: [
      'meadow',
      'meadow',
      'grassland',
      'clearing',
      'hedge',
      'grove',
      'woodland',
    ],
  },
  {
    name: 'woodland-clearings',
    treeDensity: 1.25,
    outcrops: 3,
    hillScale: 1,
    regions: ['woodland', 'woodland', 'grove', 'meadow', 'clearing', 'hedge'],
  },
  {
    name: 'rocky-pasture',
    treeDensity: 0.7,
    outcrops: 8,
    hillScale: 1.35,
    regions: [
      'grassland',
      'grassland',
      'meadow',
      'clearing',
      'woodland',
      'hedge',
    ],
  },
] as const;
export function courseComposition(seed: string) {
  return (
    profiles[sceneryHash(`${seed}|green-composition`) % profiles.length] ??
    profiles[0]
  );
}
