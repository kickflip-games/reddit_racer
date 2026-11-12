# Validated driving quality

`src/shared/circuit-quality.ts` exports:

- `assessTrackQuality(track, options?)`: inspect one canonical track and return its verdict, reason codes, thresholds, controller metrics, winning input replay and work counts.
- `generateValidatedCircuit(seed, options?)`: choose a bounded, structurally and dynamically accepted candidate, or the single validated reserve. Returns `{ track, diagnostics, quality }`.

Use `generateValidatedCircuit()` for future immutable daily records and the development drive-this-seed path. Structural previews from `generateCircuit()` remain useful in the workshop, but do not claim driving-quality acceptance.

## Versioned acceptance

`QUALITY_VERSION = quality-v1` identifies the controller/search policy and its default acceptance thresholds. This is separate from generator `motif-loop-v1`, simulator `fixed-step-v2` and handling `arcade-v1`. The physics and existing golden replays are unchanged. Persist all relevant versions, accepted canonical geometry/hash, quality thresholds and diagnostics with a daily challenge; do not silently regenerate it after an upgrade.

| Default gate                  | Requirement                                                                |
| ----------------------------- | -------------------------------------------------------------------------- |
| Geometry                      | Canonical structure, radius, road/shoulder clearance and consistent frames |
| Start                         | At least 15 m of observed low curvature                                    |
| Significant direction changes | At least 2                                                                 |
| Curvature change              | At most 0.05 per metre between canonical samples                           |
| Closing tangent angle         | At most 0.02 radians                                                       |
| Closing curvature change      | At most 0.005 per metre                                                    |
| Cautious control              | Completes within the shared 14,400-tick limit                              |
| Hold-only control             | Completes within the same limit                                            |
| Bounded fast control          | Completes in 20–40 seconds                                                 |
| Braking benefit               | At least 60 ticks (0.5 s) faster than hold-only                            |
| Meaningful lifts              | 3–8 release intervals lasting at least 12 ticks (0.1 s)                    |
| Fast recovery                 | No automatic recovery                                                      |
| Fast off-road exposure        | At most 15% of scored ticks                                                |
| Replay integrity              | Hold, cautious and winning tapes reproduce their calculated scores         |

A one-tick tap counts in raw input transitions but does not create a meaningful braking opportunity. Both raw and meaningful counts are reported. A release lasting until the finish is measured through its final scored tick. Configurable thresholds reject nonfinite values, unknown fields and unsupported ranges; increasing them cannot increase the fixed simulation/search work budget. Ranked callers should use the declared default policy or persist an explicit versioned alternative.

Structural or smoothness failures stop before expensive controller runs. Bad closure, nonfinite fields, inconsistent curvature/tangents and crossing/overlapping corridors cannot proceed to the bots. The malformed fixtures include a valid centreline with overlapping road corridors, an unsafe start seam, a high-frequency curvature oscillation and a course too long to finish under the duration bound.

## Actual shared simulation

`src/shared/driving-bots.ts` generates Boolean inputs only. Every trajectory calls the same `createRacingState()` and `stepRace()` used by the player driver and verifier. There is no separate approximate motion model.

The hold baseline presses continuously. The cautious policy looks ahead along canonical curvature, releases conservatively and uses a small speed hysteresis. Its square-root grip estimate chooses input; it does not calculate vehicle evolution. A cautious policy may be slower than hold-only and still serve its intended completion/recoverability control.

The improving search selects up to eight high-curvature peaks, separated by at least 28 metres. It begins with the hold baseline, then performs two fixed coordinate-search passes over release-window widths of 6, 10, 14 and 18 metres before each peak. A window releases until the actual simulation speed reaches its conservative corner target. Only a strictly faster completed trajectory replaces the current best.

This is a bounded improving search, not a global optimum or proof of human difficulty. It can reject a track for which a different good strategy exists. That conservative limitation is preferable to accepting a day without demonstrated useful braking decisions. Future balance work can improve controller coverage and introduce further layout families without changing an active challenge.

Before acceptance, `runReplay()` independently reconstructs the hold, cautious and winning tapes from fresh race state. It must reproduce their authoritative finish ticks. Unfinished controls have nullable finish time and no accepted winning replay. Bot or assisted inputs are not proof of human play; the replay threat-model limitation remains unchanged.

## Explicit work budgets and fallback

Each assessment has hard limits:

| Work                                             | Maximum |
| ------------------------------------------------ | ------- |
| Curvature peaks                                  | 8       |
| Search passes                                    | 2       |
| Widths per peak                                  | 4       |
| Controller trajectories, including hold/cautious | 66      |
| Final replay verification trajectories           | 3       |
| Ticks per trajectory                             | 14,400  |
| Total authoritative tick budget                  | 993,600 |

Input recordings retain the replay schema's 2,400-transition cap. The work report counts controller trajectories, requested replay checks and their bounded tick budget, including a verification budget even when verification rejects a tape.

Validated generation examines at most twelve structural candidates of the **same requested seed**, applying quality to at most four structurally accepted candidates. It then assesses the one fixed reserve. It does not nest calls that each hide another twelve generation attempts. There are at most thirteen candidate constructions and five quality assessments, including the reserve.

`diagnostics.attempts` counts requested structural candidates. `qualityAttempts` counts requested quality assessments. `validationWork.qualityAssessments` includes the reserve, while `reserveAssessments` identifies it separately. Structural rejection codes and `quality:`-prefixed failures remain in the attempt log; `qualityRejections` retains the quality-specific codes and candidate seed. The full returned quality record describes the accepted candidate.

The existing generated reserve `reserve-motif-v1`, candidate 1, passes the same default quality function. Its pinned search finds 2,848 ticks (23.733 s), compared with hold-only 3,318 ticks (27.650 s), with three meaningful lifts and no recovery. There is no reserve bypass. Strict incompatible configuration fails explicitly if neither requested candidates nor reserve meet it.

As in structural generation, `diagnostics.requestedSeed` preserves the original request while a fallback track's own seed identifies the reserve. The accepted full track must be stored for a daily challenge; a recipe seed alone is insufficient.

## Repeatable fixed suite

The default `npm run tracks:check` report evaluates 200 fixed `regression-N` seeds with full quality validation. It records geometry hashes, accepted/rejected attempts, thresholds, controller times, braking gain, input/replay diagnostics, work counts, fallback frequency and duration distributions. Structural-only inspection remains labelled separately in the local gallery and via `--structural`. A per-seed exception is retained in the complete report while the remaining seeds continue; any failure makes the command exit nonzero. Requested and total quality assessments are reported separately so reserve work is visible. CI saves the full report alongside browser evidence in its validation-results artifact.

The observed default report on this version is:

| Measurement                          | Result                                       |
| ------------------------------------ | -------------------------------------------- |
| Requests / accepted results          | 200 / 200                                    |
| Reserve uses                         | 3 (1.5%)                                     |
| Mean requested structural candidates | 3.425                                        |
| Quality rejections                   | 1, insufficient meaningful braking intervals |
| Fast duration                        | 22.550–30.208 s; mean 26.597 s               |
| Hold duration                        | 27.650–38.017 s; mean 32.765 s               |
| Cautious duration                    | 32.000–40.167 s; mean 36.728 s               |
| Meaningful lifts                     | 3–6                                          |
| Fast improvement over hold           | 3.775–8.433 s                                |

The standalone Node probe took approximately 14.4 seconds for the complete set; the full test harness took approximately 27 seconds in the observed development run. These are machine-specific measurements, not phone or Devvit latency claims. Validation is performed when preparing a challenge or explicitly inspecting a development seed, never during a driving frame or every accelerator press.

Unit tests enforce trajectory/work bounds, pinned reserve results, meaningful-interval boundaries, retry/reserve validation, malformed/smoothness failures, unfinished-control rejection and all 200 approved daily requests. They also reverify each winning replay. Browser checks cover the selected-seed quality display and driving path separately. Actual Reddit identity/storage observations are recorded in [hosted playtest evidence](hosted-playtest.md). Remaining hosted negative conditions and physical-phone comfort require separate observations; local controls do not establish them.
