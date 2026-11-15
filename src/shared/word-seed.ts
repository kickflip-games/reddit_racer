/** Internal seed namespace stays stable; players share plain words. */
export type CourseWord = {
  word: string;
  seed: string;
  code: string;
};
export function normalizeCourseWord(input: string): string {
  if (/[\p{Cc}\p{Cf}]/u.test(input))
    throw new Error(
      'Use letters, numbers, spaces or hyphens, without hidden characters.'
    );
  const word = input
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
  if (!word || [...word].length > 48)
    throw new Error('Enter a word or short phrase of 1–48 characters.');
  if (!/^[\p{L}\p{M}\p{N} _'-]+$/u.test(word))
    throw new Error(
      'Use letters, numbers, spaces, apostrophes, underscores or hyphens.'
    );
  return word;
}
export function courseWord(input: string): CourseWord {
  if (/[\p{Cc}\p{Cf}]/u.test(input))
    throw new Error(
      'Remove hidden or control characters from the course word.'
    );
  // Previously shared codes are aliases, not requests for historical geometry.
  input = input.trim().replace(/^v[12]:/iu, '');
  const word = normalizeCourseWord(input);
  const seed = `word-v2:${word}`;
  if (seed.length > 96)
    throw new Error('That word is too long. Try a shorter word.');
  return { word, seed, code: word };
}
