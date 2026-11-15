# Word courses in Other tracks

Choose **Other tracks**, then **Choose a word** (also in Settings).
Enter and share a plain word such as `banana`. Random **Other tracks / New
track** selections show a reusable plain word too. There is one current course
generator, with no version selector or historical generation route.

Previously shared `v1:banana` and `v2:banana` codes are accepted only as aliases
for `banana`. In particular old v1 codes now remap to current geometry; they
do not reproduce the old track. Unknown prefixed codes are invalid input.
The internal `word-v2:` namespace is retained so the measured current courses
remain identical. This is provenance, not a user-selectable version.

Normalization uses NFKC, trimming/collapsed spaces and locale-independent
lowercase; maximum 48 Unicode code points and 96 UTF-16 units including the
internal namespace. Letters, combining marks, numbers, spaces, apostrophes,
hyphens and underscores are allowed; hidden/control/bidi characters rejected.

Every ordinary practice generation path uses `generateBrakingCircuit` and
its bounded quality gates. See `braking-validation.md` for measured results
and negative cases. No unvalidated reserve is used.

`?practice=1&word=banana` selects a named course. The old `wordVersion`
parameter is ignored and cannot select another generator. Without practice=1,
word parameters cannot override a posted daily challenge. Sharing the word is
preferred over an iframe URL, which may not be portable outside Reddit.

Local bests and ghosts still use the serialized actual track and handling
fingerprint. An old ghost cannot attach to remapped geometry. No score or
stored daily-challenge data is rewritten by this change.

Only development builds retain `?practice=1&seed=...` for historical
renderer/physics fixtures, through an explicitly development-only import.
The separately injected flat test harness also remains; neither is an
alternative in the production UI.

Validation for this simplification is recorded in the change report. Historical
v1/v2 experiments remain in other reports as evidence, not selectable modes.

## Plain-word simplification checks

411 unit tests passed, including deterministic accepted current-course hashes;
the additional assertion against the actual historical banana track confirms
its ghost key differs after remapping. Six desktop/mobile Chromium word-form
cases passed (plain input, old-code alias, invalid input recovery, random word
sharing). These are local browser tests, not physical-device or deployment tests.

The production build also passed two desktop/mobile smoke cases with the old
late generator URL blocked, including invalid-word recovery and normalized
word reproducibility. The build does not emit the development fixture module.
