# Real-physics braking validation

## Protocol and scope

Geometry is frozen at `49f248d` (other-tracks-v2), file SHA256
`9095b1b1ac64e5da712919c0e7a2cf9fbf97cdb9f25b195a11e152022883c057`.
The final change from the measured geometry snapshot labels the zero-benefit
chicane easy rather than medium; no point, curvature or physics changed.
Validation ran on UoA Apple M5 Max, arm64, 36 GiB, Node 24.22.2. No handling values
or input controls changed. The exact production continuous-practice driver
advances at 120 Hz; stop at the first completed lap, with a 123-second wall-clock
simulation cap including countdown. Its finish tick exactly matches the shared
production search/replay in all fixed and paired comparisons.

Production gate was declared before the final 30-seed campaign:

- At most 3 deterministic candidates, no unvalidated reserve or silent fallback.
- Existing structural clearance/intersection, seam and curvature-smoothness gates.
- Fast lap 20–60 seconds, at least 0.75 seconds faster than full hold.
- 2–8 meaningful releases (at least 12 ticks), no fast hard recovery, at most 15% grass.
- Each scored control is checked through the production replay validator.

The expanded duration limit is explicit: v2 compositions are substantially longer
than v1's ~30-second courses, not a like-for-like speed improvement. A failure
returns `quality.valid=false` with all rejection codes; callers must not accept it.

## Fixed motif bank

All seconds below measured, not inferred from geometric curvature. "Fast" is
bounded coordinate-search input, not a proof of global optimum. Early/late are
separate conservative speed-envelope controllers, not a controlled causal claim
that shifting one human brake press produces the whole difference.

| Fixed course            | Full hold |   Fast |  Gain | Fast releases | Fast grass | Early envelope | Late envelope |
| ----------------------- | --------: | -----: | ----: | ------------: | ---------: | -------------: | ------------: |
| Long straight / hairpin |    44.800 | 43.925 | 0.875 |             1 |      9.14% |         47.792 |        44.392 |
| Tightening corner       |    24.350 | 21.583 | 2.767 |             4 |      3.28% |         26.550 |        22.642 |
| Flowing S               |    37.200 | 37.200 |     0 |             0 |         0% |         37.200 |        37.200 |
| Chicane                 |    37.308 | 37.308 |     0 |             0 |      2.99% |         41.133 |        38.675 |
| Double hairpin          |    60.233 | 58.642 | 1.592 |             2 |     14.76% |         66.042 |        59.442 |
| Gentle sweeper          |    30.925 | 30.925 |     0 |             0 |         0% |         30.925 |        30.925 |
| Switchback              |    40.625 | 39.433 | 1.192 |             3 |      2.87% |         43.442 |        40.617 |

All full-hold and early runs finished with 0 hard recoveries. Hard motifs cause
recoverable speed loss rather than a sudden stop: full-hold minimum speed after
initial acceleration was 9.26–11.28 m/s on hairpin/double/tightening/switchback.
Early envelope laps were slower but had 0 hard recoveries and 0 grass ticks.
Gentle S and sweeper genuinely tolerate flat-out control with 0 grass ticks.
**Negative result:** the chicane still offers no measured brake benefit; it is
flow variety, not advertised as a timing challenge. A single-hairpin fixed test
has only one decision by design, so it is diagnostic, not a production course
passing the whole-lap 2-release gate.

## Braking room

At 30 m/s, the unchanged 13.5 m/s² braking needs about 22–28 m to approach the tight
corner traction speed, ignoring rolling drag (a conservative flat-ground
estimate). The generated approach straights are 75–100 m. Measured search release
leads range ~14–38 m for the immediately following hard corner; the fastest
search sometimes deliberately trades residual sliding for time. It does not
prove perfect road adherence. Saved `brakingLeads` report actual release speed,
distance to each sampled peak and the conservative stopping estimate; a reused
release preceding several nearby peaks is diagnostic, not a new input decision.

## Accepted paired word courses

| Word   | v1 hold / fast | v2 hold / fast | v2 accepted attempt | v2 fast grass |
| ------ | -------------: | -------------: | ------------------: | ------------: |
| banana | 34.542 /30.567 | 51.217 /49.817 |                   2 |         5.65% |
| apple  | 32.250 /29.525 | 54.133 /52.758 |                   2 |         5.42% |
| orange | 31.183 /29.525 | 54.967 /53.075 |                   2 |         9.08% |

Both versions reward braking. These measurements do **not** establish that v2
has a larger braking benefit than v1: v2 gains1.375–1.892seconds here, versus
v1's1.658–3.975seconds. Its intended difference is explicit route structure and
contrasting easy/hard sections, which still needs human playtesting.

##30-seed bounded production campaign

Seeds `word-v2:evaluation-0` through`-29`:30/30accepted,23on attempt1,6on attempt 2,
1 on attempt 3. Accepted gains 0.925–3.000 seconds, all fast grass ≤15%, all fast hard
recoveries 0. Measured p95generator wall time 699 ms, worst 897 ms. This desktop
measurement had a separate fixed-test process running during the early samples;
it is not mobile hardware throughput or a guarantee for every unseen seed.
No rejection was discarded: per-attempt codes remain in the generated report.

## Preserved development failures

1. An initial numerical angle-integration error failed closure; fixed by exact
   angle normalization, not by loosening geometric tolerance.
2. Initial raw-seed banana/apple/orange candidates had 17.5–20.5% fast grass,
   exceeding the 15% gate; they were not treated as acceptable.
3. Widening every closure produced some 1.6 km /64–68second fast courses and
   19–22%grass; these first candidates failed. Composition was simplified.
4. Before the one bounded technical-angle adjustment, switchback had 0 benefit;
   it now has 1.192 seconds. Chicane remains negative and is labelled easy.
5. Final word-v2 banana/orange first candidates gained only 0.608/0.542 seconds;
   apple first candidate was 60.017 seconds. Gate rejected those, accepted attempt 2.

## Reproduction

```
node --import tsx scripts/fixed-motif-report.ts
node --import tsx scripts/motif-braking-report.ts banana apple orange
node --import tsx scripts/braking-gate-report.ts 30
node --import tsx --test tests/unit/braking-validation.test.ts
```

Reports write small JSON files to `/tmp/racer-braking-validation/`. No videos,
large binary arrays or alternative approximate car dynamics are involved.
