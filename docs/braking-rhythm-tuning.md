# Braking rhythm tuning

The V7 generator reduces repeated long intervals without useful braking while retaining five layout families, local overpasses, elevation and jump days. This is a local setup pass on `feature/braking-rhythm-tuning`, based on **c155dce88db80e011b2c102c4f55fd086661f6b8** (fetched `origin/main`). Existing checkouts were left untouched.

The comparison uses the next 30 days after the request's November 23 date: **November 24–December 23, 2026**, with the real daily seed format `daily:t5_kyc33w:YYYY-MM-DD`. These are offline reconstructions, not reads or replacements of stored daily challenges.

| Metric                                                 | Baseline V6 |              Tuned V7 |
| ------------------------------------------------------ | ----------: | --------------------: |
| Median longest interval without validated brake demand |       9.48s |                 7.09s |
| 90th percentile longest interval                       |      12.04s |                 8.54s |
| Worst longest interval                                 |      13.32s |                 9.52s |
| Repeated excess beyond 5s, summed over 30 laps         |      51.83s | 22.58s (**56% less**) |
| All excess beyond 5s, summed over 30 laps              |     177.83s | 83.72s (**53% less**) |
| Median grounded brake duty                             |      14.45% |                17.79% |
| Maximum grounded brake duty                            |      20.70% |                20.70% |
| Median reference lap                                   |      28.48s |                26.54s |
| Completed reference laps / all checkpoints             |     30 / 30 |               30 / 30 |
| Reference off-road / recovery ticks                    |       0 / 0 |                 0 / 0 |

“All excess” is `Σ max(0, interval − 5s)`. “Repeated excess” subtracts the largest such contribution per lap, allowing one deliberate breather. Both definitions are reported so this allowance cannot hide the longest run. There are 34 intervals of 3–5 seconds after tuning, versus 22 before; laps with two or more intervals longer than 5s decrease from 17 to 15. All excess as a fraction of total reference lap time falls from 20.68% to 9.96%, so the result is more than a consequence of shorter laps.

Targets were chosen after the baseline: median longest interval below 7s, at least 50% less all excess over 5s, and brake duty under 25%. The median narrowly misses its target. The other targets pass. This is an aggregate improvement: the longest interval improves on 18 days, is unchanged within 0.025s on 11, and worsens by 0.45s on December 6. Repeated excess worsens on four days; the paired figure exposes these regressions.

## Figures and evidence

- [Portable report](evidence/braking-rhythm/braking-rhythm-report.html), with embedded figures and methodology.
- [Brake demand against elapsed lap time](evidence/braking-rhythm/braking-over-lap-time.png): first occurrence of each family, chosen independently of improvement.
- [Paired 30-day comparison](evidence/braking-rhythm/comparison-30-days.png).
- [Layout and elevation comparison](evidence/braking-rhythm/layout-comparison.png).
- [CSV](evidence/braking-rhythm/comparison.csv), [baseline trajectories and counterfactuals](evidence/braking-rhythm/baseline.json), [tuned evidence](evidence/braking-rhythm/tuned.json), and [100 additional seeds](evidence/braking-rhythm/coverage.json).

The JSON includes source provenance, track hashes, accepted candidates, reference settings, sampled trajectories, every brake approach and its hold-through result. Tick-level evaluation precedes plot downsampling to 0.1 seconds. Every one of the 171 baseline and 195 tuned approaches has physical evidence. Of those, 154 and 172 respectively lose at least 0.05s when held through; the remaining 17 and 23 demonstrate worse road stability even if their lap is faster or similarly timed. All counterfactual runs finish; none relies on an artificial stall in a spatial brake window.

## Method and limits

`scripts/lib/brake-demand.ts` evaluates actual `stepRace` / `stepSimulation` physics at 120Hz, including grade, drag, lateral motion, deck height, flight, recovery, ordered checkpoints and the grounded road finish. Curvature only proposes a 1m backward speed envelope. Twenty grip/preview settings and a spatial version of the existing searched input tape are compared. A clean completed lap takes priority, then elapsed time; small road excursions within 12 ticks have equal cleanliness cost. The reported references have no excursions.

The selected trajectory becomes spatial release windows with a speed floor. A counterfactual that arrives slowly downstream can accelerate rather than remain trapped in a release window. Two pruning passes remove approaches that do not help. Each retained approach is ablated separately by forcing full throttle through it, then resuming the other spatial controls. It counts if holding loses at least 0.05s, adds more than 12 off-road ticks, or adds recovery. This validates usefulness for the reference trajectory; it does **not** prove a globally mandatory brake or a globally optimal lap. A human can choose different approaches or tolerate more slide.

The model ignores releases shorter than 0.2 seconds and ineffective airborne input. Releases at most 0.75 seconds apart are grouped into one approach. Initial acceleration from GO and the terminal run to the finish are included separately. Ranked laps start stationary after a legal countdown launch press and finish once; their terminal/start intervals must not be joined into a rolling lap. Preview distances are clamped at the terminal finish, avoiding fictitious braking for the next lap. The countdown itself is excluded. Jump launch and run-out retain full throttle. Continuous practice rolling-lap rhythm is not measured.

The 30 days informed tuning; this is not an independent statistical holdout. The 100 additional seeds check bounded acceptance and route/jump safety, not the same detailed demand analysis or perceived fun. No physical-device or human rhythm test is claimed. Four days' repeated excess regress; the unchanged crossover family deliberately retains some longer runs. The new runtime has the same physics, but routes become shorter in three families.

## Generator change and compatibility

The deterministic `linked-circuits-v7` recipe changes existing control points and target lengths:

- Sweeping: stronger first corner, 620–690m rather than 640–710m.
- Switchbacks: tighter broad return lobe, 640–710m rather than 760–830m.
- Ridge: tighter upper lobe, 650–720m rather than 740–810m.
- Technical and crossover: original recipe. The bridge remains a local grade-separated fold.

No control, traction, acceleration, braking, drift, launch or flight parameter changes. The existing height, grade and jump formulas stay in place. The measured set retains all five jump days and all six crossover days, with minimum crossing headroom **11.44m**. Existing structural, jump-flight, clean-replay and generation-budget gates are unchanged. Earlier prototypes that failed these gates were discarded.

Version routing explicitly retains V6's old generator, acceptance limits, countdown rules, storage normalization and share format. Four golden V6 daily courses assert exact hashes, candidate attempts and replay ticks across technical, jump, crossover and ridge routes. Old V6 shares still reconstruct their original track; new V7 shares have distinct identities. Existing V3/V4 compatibility tests also pass.

The [release run](https://github.com/kickflip-games/reddit_racer/actions/runs/45144117112) records `the-daily-lap@0.0.20261123` at **e2af8a205695a09ced4ea9e13cba4058b8fdb3ae**. Compared with that source, this pass's baseline changes only `package.json`, `package-lock.json`, the minimap browser check and release CLI check. `src/shared` and `src/server` have no differences. This establishes source provenance, not current installation state.

## Local verification and reproduction

On UoA Work Machine, Node **24.22.2**:

- 38 focused generator, saved-share, replay, race-progress, overpass, elevation and measurement tests pass.
- All 100 additional seeds (50 named courses and 50 daily seeds) pass the original bounded acceptance gates.
- ESLint, TypeScript, production build and formatting pass. Build emits the existing bundle-size/dynamic-import notices.
- All three figures were opened and visually inspected. The self-contained report loaded all three embedded images in headless Chrome without desktop or 390px mobile overflow.

```sh
npm ci --ignore-scripts
npx tsx scripts/brake-demand-report.ts baseline
npx tsx scripts/brake-demand-report.ts tuned
npx tsx scripts/brake-demand-coverage.ts
python3 -m pip install matplotlib
python3 scripts/plot-brake-demand.py
npx tsx --test tests/unit/brake-demand.test.ts tests/unit/linked-courses.test.ts tests/unit/daily-variety.test.ts tests/unit/steeper-elevation.test.ts tests/unit/word-seed.test.ts tests/unit/crossover.test.ts src/shared/race-rules.test.ts src/shared/replay.test.ts
npm run type-check
npm run lint
npm run build
npm run format:check
```

Generated evidence is excluded from formatting to preserve the report and compact raw data. The source and measured code digest are recorded in the JSON; `workingTreeDirty` honestly records the pre-commit campaign. There were no GitHub Actions dispatches, remote pushes, merges, app creations, hosted test environments or production releases. Today's live race was untouched.
