# Word courses in Other tracks

Choose **Other tracks**, then **Choose a word** (also available in Settings).
Enter a word such as `banana`, or paste its shareable code `v1:banana`.
The code shown in Settings is selectable text; friends can enter the same code.
Random **Other tracks / New track** selections use this generator too and
show a revisitable word code; explicit legacy seed links retain their original
course. This avoids promising that an expanded Reddit iframe URL is a portable share link.

Version 1 uses NFKC normalization, trim/collapsed spaces, locale-independent
lowercase, and a maximum 48 Unicode code points. It accepts letters, combining
marks, numbers, spaces, apostrophes, hyphens and underscores. Hidden/control/bidi
characters are rejected. The full internal `word-v1:` seed is also capped at 96
UTF-16 units for the generator. Invalid inputs keep the current track intact.
Unsupported version codes are rejected rather than silently reinterpreted.

The v1 code maps only to `generateOtherTracksCircuit` / `other-tracks-v1`.
Do not change this mapping when introducing a future word-course version.
Legacy explicit development `?practice=1&seed=...` uses the original generator
unchanged. The posted daily challenge and ranked flow are untouched.

Explicit browser entry `?practice=1&word=banana&wordVersion=1` selects a word
course. Without `practice=1`, word parameters cannot override the daily race.
This is useful for local testing/direct browser entry, not a guaranteed Reddit
share URL. Unknown versions show an error and can be repaired through the word
form. No address navigation or reload is needed to choose another word.

Local bests and ghosts use the serialized actual track fingerprint, including
the generator version, plus the existing physics/handling/continuous-lap keys.
They therefore reproduce across normalized word aliases without mixing with
other words, changed versions or the daily circuit. This is local, unranked
sharing, not a new leaderboard or shared ghost service.

## Integrated validation

Combined with the natural-scenery, ramp-side surface and stopped-car fixes:
`npm run check` passed 401 unit tests, 200 legacy track checks, formatting,
types, lint and production build. The existing large-chunk warning remains.
Sixteen desktop/mobile Chromium cases passed across word input, unsupported
version recovery, random reusable codes, two continuous laps, ghost appearance,
returning to the immutable daily course, interrupted input and stopped-car pose.
These are local browser tests, not a claim of an installed Reddit deployment
or testing on a physical mobile keyboard/GPU.
