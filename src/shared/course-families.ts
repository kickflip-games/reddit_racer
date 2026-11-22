export type CourseFamily =
  'sweeping' | 'switchbacks' | 'technical' | 'ridge' | 'crossover';
const ordinaryFamilies: readonly CourseFamily[] = [
  'sweeping',
  'switchbacks',
  'technical',
  'ridge',
];
export const COURSE_FAMILIES: readonly CourseFamily[] = [
  ...ordinaryFamilies,
  'crossover',
];
export function courseRandomFor(seed: string) {
  let n = 2166136261;
  for (const c of seed) n = Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => {
    n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
export function courseFamilyForSeed(seed: string): CourseFamily {
  // An occasional localized bridge, independent of the four ordinary recipes.
  if (courseRandomFor(`variety-overpass|${seed}`)() < 1 / 6) return 'crossover';
  return ordinaryFamilies[
    Math.floor(
      courseRandomFor(`variety-family|${seed}`)() * ordinaryFamilies.length
    )
  ]!;
}
