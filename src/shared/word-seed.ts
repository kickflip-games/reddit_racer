/** Version pins both text normalization and the Other tracks generator mapping. */
export const COURSE_WORD_VERSION = 2;
export type CourseWord = {
  word: string;
  version: 1 | 2;
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
export function courseWord(
  input: string,
  version = COURSE_WORD_VERSION
): CourseWord {
  if (/[\p{Cc}\p{Cf}]/u.test(input))
    throw new Error(
      'Remove hidden or control characters from the course word.'
    );
  if (version !== 1 && version !== 2)
    throw new Error(
      'That course version is not supported. Use a v1 or v2 code.'
    );
  // The short code is shareable without depending on Reddit iframe URLs.
  const code = /^v(\d+):(.*)$/iu.exec(input.trim());
  if (code) {
    version = Number(code[1]);
    input = code[2] ?? '';
  }
  if (version !== 1 && version !== 2)
    throw new Error(
      'That course version is not supported. Use a v1 or v2 code.'
    );
  const word = normalizeCourseWord(input);
  if (`word-v${version}:${word}`.length > 96)
    throw new Error(
      'That word is too long for a course code. Try a shorter word.'
    );
  return {
    word,
    version,
    seed: `word-v${version}:${word}`,
    code: `v${version}:${word}`,
  };
}
