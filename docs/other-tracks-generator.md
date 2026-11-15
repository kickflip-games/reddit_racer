# Other tracks v1

Opt-in API: `generateOtherTracksCircuit(seed)`. The word-code UI supplies
`word-v1:<normalized word>`; canonical geometry declares `other-tracks-v1`.
The default elevated generator, daily/ranked storage, physics and legacy seed
links are unchanged. Golden geometry hashes freeze both legacy examples and
banana/tui/river word routes. Any future remapping requires a new version.

## Shapes and safety

A deterministic per-seed family selects roughly 30% overpass crossings, 30%
generous U-inlet loops, and 40% wavy inset loops. The inlet is a readable broad
U-turn, not a tight 180-degree hairpin. Less spline fairing preserves the
insets. These remain one grassy environment with existing scenery/rendering.

Length is 730–800 m (legacy 560–720), with the same 7 m road, minimum 10 m
radius, shoulder/clearance checks and hold/cautious/fast controller validation.
Crossing/inlet routes require at least two curvature reversals; wavy loops four.
Generation is bounded by 32 candidates and eight quality assessments, then a
separately validated procedural reserve. Failure of that reserve throws rather
than accepting unsafe geometry. Different words could share the reserve on
exhaustion, so unique word codes do not promise unique geometry.

## Measured comparison

Reproduce: `node --import tsx scripts/other-tracks-check.ts 100`.
Measured on UoA Mac, Node, sequential paired legacy/new generation, seeds
`word-v1:other-evaluation-0` through `word-v1:other-evaluation-99`.

| Metric                                 |    Legacy |  Other v1 |
| -------------------------------------- | --------: | --------: |
| Structurally/quality valid             |   100/100 |   100/100 |
| Hold, cautious, fast completion (each) |   100/100 |   100/100 |
| Reserve fallback                       |         0 |         0 |
| Distinct canonical hashes              |       100 |       100 |
| Mean curvature direction changes       |      3.27 |      3.20 |
| Minimum measured radius, m             | 10.026535 | 10.045506 |
| Minimum measured clearance, m          | 10.051122 | 10.065853 |
| Median generation, ms                  |     169.5 |     165.0 |
| Maximum generation, ms                 |     454.8 |     198.3 |

New accepted families: 28 crossings, 33 U-inlets, 39 wavy loops. This is broader
shape variety, **not** an increase in mean reversal count or proof of human fun.
Controller completion is an automated safety proxy, not mobile human playtesting.

An earlier four-reversal gate rejected all crossings and produced mostly rounded
loops. It was rejected after visual review. A random-per-attempt U family also
skewed accepted shapes toward easy candidates; seed-fixed families avoid that
selection bias. The final implementation retains crossings and broad U turns.

## Visual and test evidence

A local Chromium environment-gallery capture used the actual production track
renderer, switching only its generator import and twelve explicit word seeds.
The same words were captured with the legacy generator for comparison; the
intercept asserts both replacements occurred. `hill` visibly shows the deep
U-inlet; `river`, `meadow`, `cloud` show crossings; `banana` and `kiwi`
show smoother insets. This is an overview comparison, not a claim of completed
human driving trials. No recordings were generated.

Focused elevated/Other tracks unit tests, TypeScript, lint and production build
pass. Build retains the existing large-chunk warning.
