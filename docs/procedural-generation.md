# Procedural circuits

`src/shared/circuit-generator.ts` exports `generateCircuit(seed, config?) → { track, diagnostics }`. Its output is the same canonical serialized track consumed by the mesh, driving model and replay verifier. Daily persistence is a separate step: store the complete accepted track and its hash, rather than regenerating an active challenge from a seed after a deployment.

## Constructive closed geometry

The generator builds one periodic cubic B-spline from a seeded ring of six to eight driving-motif control groups. Indices wrap through the complete control ring, so position, tangent and curvature close continuously. There is no special final segment joining arbitrary endpoints.

Each candidate includes continuously varied motif dimensions and a shuffled order:

- A deep infield U with descending/ascending legs, a bottom return and broad mouth transitions. It reserves approximately 77–86 degrees of the outer layout for space. The U locally leaves angular control-point ordering; corridor validation remains authoritative.
- Dip/bump S controls that introduce opposite-sign turning sections.
- Asymmetric angular/radial controls that concentrate curvature toward the exit of a decreasing-radius section.
- Broad sweeper controls.
- Collinear straight and recovery controls. Their protected interiors preserve a genuine straight through smoothing.

Two bounded control-point fairing passes smooth the whole ring; two additional passes treat the U and its joins. Straight interiors remain fixed. Motif amplitude scales with angular span squared, preventing a narrow sector from becoming disproportionately sharp. Rotation, aspect ratio, direction and length also vary, but they are secondary to the changed control geometry and sequence.

The source curve is sampled at 2,048 parameter positions, scaled to the seeded target length, then resampled into approximately one-metre canonical arc-distance samples. Its start is moved into the longest observed low-curvature recovery section, leaving at least 15 metres ahead before meaningful curvature. Quantized canonical tangents, widths and curvature define the accepted road.

Motif names in diagnostics describe construction intent; they are not a claim that every labelled group survives smoothing as an isolated corner with exactly that shape. `curvatureProfile`, the rendered road and actual shared-simulation replays are the evidence for the final driving sequence. The showcased tests additionally require an observed opposing turn of at least 140 degrees, so a shallow radial bump cannot pass merely by being labelled a hairpin.

## Determinism and bounds

The compatibility identifier is `motif-loop-v1`. A bounded UTF-16 seed (1–96 characters), generator version, fixed-order geometry configuration and attempt number initialize an integer FNV-derived/LCG random stream. All random decisions use that stream; generation has no `Math.random`, clock or network input. Retry budget does not alter the geometry of an individual candidate.

| Default                         | Value                |
| ------------------------------- | -------------------- |
| Road width                      | 7 m                  |
| Target length                   | 350–500 m            |
| Minimum centreline radius       | 10 m                 |
| Extra nonlocal corridor gap     | 2 m                  |
| Shoulder on each side           | 0.8 m                |
| Requested-seed candidate budget | 12                   |
| Reserve candidate budget        | One pinned candidate |

Configuration overrides have explicit finite bounds and reject unknown keys. Authoring is bounded by eight sectors, fixed dense sampling, roughly 600 maximum canonical samples under supported configuration, twelve requested attempts and one reserve attempt. Pairwise geometry work is bounded; a browser gallery yields between generated cards so a large batch remains usable. These are work limits, not a promise of identical elapsed milliseconds on every phone.

The canonical serializer and SHA-256 have pinned regression expectations. Authoring uses native trigonometric operations; ranked gameplay must consume accepted stored samples, rather than depend on a client independently rerunning authoring math. The shared driving model itself remains independent of generator trigonometry.

## Structural acceptance

`src/shared/circuit-validation.ts` exports reusable `assessTrackStructure()`, segment distance/intersection helpers and straight-section measurement. Structural checks fail closed for invalid thresholds and include:

1. Canonical schema, finite fields, distances, closure, unit tangents and widths.
2. Tangent/curvature agreement with the actual neighbouring geometry, so a falsified low-curvature field cannot hide a sharp vertex.
3. Minimum physical turn radius and a local road-plus-shoulder offset-fold guard.
4. Every nonadjacent centreline-segment intersection, including the closing seam.
5. Nonlocal **segment-to-segment** clearance after subtracting both road half-widths and shoulders; centreline separation alone is insufficient.
6. A genuine start straight, supported length and sign-changing corner variety before generator acceptance.

Nearby cross-sections intentionally form a single road. The corridor-distance test excludes their local arc neighbourhood, bounded by both corridor width and `0.8 × π × minimumRadius`. The independent radius/fold and intersection checks cover local malformed turns. True return legs around a 180-degree hairpin remain outside that neighbourhood and are checked. AABB pruning only skips pairs that cannot improve the known minimum gap.

`minClearance` reports edge-to-edge free space **after** road widths and shoulders, in metres. `curvatureProfile` contains 64 signed, start-relative samples. The diagnostics also include accepted length, minimum radius, longest/start straight lengths, significant direction changes, control points, intended motifs, rejected-attempt codes and the accepted candidate seed.

These structural gates do not establish fun, fair difficulty or a useful optimal strategy. Full authoritative simulation controls, braking-pattern gates and accepted-seed reports are now described in `docs/track-quality.md`. The initial ten-course hold/replay smoke only establishes compatibility and recoverability; it is not a substitute for that study or human playtesting.

## Reserve behaviour

If all requested attempts fail, the generator uses the single generated reserve `reserve-motif-v1`, candidate 1. It is reconstructed under the versioned recipe, structurally validated and pinned by a canonical SHA-256 test:

`d956fc9612a3bc90fe5bae3c08d592217d50787d496a1855148e80c6efaf8c56`

The default reserve also completes under the authoritative race rules. It is not a collection of handmade tracks. A non-default configuration must still validate its reserve; incompatible strict settings fail explicitly instead of silently returning a road that violates the requested bounds.

Fallback is visible: `diagnostics.fallbackUsed` is true, `diagnostics.requestedSeed` retains the failed request, and `track.seed`/the accepted candidate identify the reserve. Preserve this distinction in any daily record. Never report the failed requested seed as if it directly produced the reserve geometry.

## Local inspection and reproducible checks

Run `npm run dev:local`, then open `/track-gallery.html`. Enter one seed to reproduce it, or a prefix/count to generate up to 300 SVG previews with signed curvature profiles and diagnostics. Single seeds are limited to 96 characters and batch prefixes to 88. Select a gallery card to inspect that exact generated seed. The gallery can check selected driving quality and open `/game.html?seed=...` in local development. That path uses the fully validated candidate and keeps it fixed across retries. Normal no-query practice retains the reference oval; generated production challenges come from the server's [immutable daily record](daily-challenges.md). Production ignores the local seed query.

The command-line structural report is reproducible:

```sh
npm run tracks:check -- --structural
npm run tracks:check -- --structural --count 200 --prefix regression --report /tmp/circuit-report.json
```

For the fixed `regression-0` through `regression-199` set on this version, the observed structural-only report is:

| Measurement                                    | Result            |
| ---------------------------------------------- | ----------------- |
| Structurally valid requests                    | 200               |
| Reserve uses                                   | 3 / 200 (1.5%)    |
| Mean requested attempts                        | 3.405             |
| Distinct canonical hashes / curvature profiles | 198 / 198         |
| Accepted lengths                               | 350.054–499.404 m |
| Rejected candidate radius failures             | 484               |
| Rejected shoulder-fold failures                | 6                 |

The repeated reserve accounts for the reduced uniqueness; it is not hidden. Unit thresholds prevent a reserve rate above 5% or fewer than 190 distinct profiles on this fixed set. They do not claim the measured fallback rate for every possible prefix.

Ten showcased examples are `regression-0` through `regression-9`, exported by `fixtures/showcase-circuits.ts`. Their dimensionless signed curvature sequences differ, their intended motif orders vary, and their observed infield returns turn approximately 148–155 degrees after smoothing. Their initial hold-only smoke laps finish in approximately 31.6–36.9 seconds. Bounded optimized-input probes and genuine human observations are separate evidence; no artificial times or leaderboard records are presented to players.

An independent bounded release-window probe on `showcase-0` through `showcase-9` executed the authoritative shared race rules and reverified each resulting tape with `runReplay`. Tested release strategies finished in 24.233–28.225 seconds, beating hold-only by 4.267–8.050 seconds with 3–5 lifts. These are bounded numerical controls, not globally optimal lap times or human playtests. The generalized shipped controller gates are documented in `docs/track-quality.md`.
