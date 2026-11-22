# Daily course families, candidate V6

Draft implementation from main `a363dc90ccc83e8e6200ac9840b0861446c09c1d`.
No merge, branch publication, or deployment is part of this change.

The seed selects one of four spatial recipes before candidate attempts. Attempts
retain that family. The recipes use separate control polygons: broad sweeping
lobes, an elongated out-and-back with switchbacks, compact multiple inlets, and
two large loopback bowls around a ridge. Each has seeded aspect, corner and
length variation and a continuous periodic cubic spline. This replaces the
single shuffled motif ring. Orientation alone does not select a family.

Loops delivered are **plan-view loopbacks only**. There are no crossings,
grade-separated figure-eights, or vertical stunt loops. The normal 7 m road,
2 m separate-road clearance, 0.8 m shoulders and 10 m minimum radius remain.
The renderer, camera, hold/release controls and V9 timed start are reused.
No records or storage namespaces are deleted or migrated.

## Deliberate policy changes

The new family length envelope is 540–900 m, versus 540–600 m. V6 permits
230 m straights and 12 s uninterrupted throttle, versus 65 m and 8 s. These
changes permit the requested long runs; they do not waive the demonstrated
0.75 s braking gain, 3–8 meaningful lifts, zero fast recoveries, 15% maximum
fast off-road fraction, safe landings or replay consistency requirements.
Minimum peak elevation increases from 1 m to 8 m.

Road height is allowed up to **18 m for V6 only** (the previous schema-2 limit
was 8 m). Grade and derivative-consistency bounds remain. Jump takeoff height
remains at most 6 m. Generated ordinary hills peak at 9–13 m; ridge courses
have a 17–18 m summit, a separate 7 m return hill and about 20% maximum grade.
Their C2 crest curvature remains below contact loss at 30 m/s. The standing
start and finish retain at least 20 m of flat road.

Only some long-run days have a deliberate gap. They reuse the previous 4 m,
48 m C2 ramp profile and a 10 m gap, with straight runway and landing runout.
Aggregate airborne ticks are insufficient for acceptance. The new quality
policy additionally checks **each gap** in both fast and cautious driving:
launch, speed, flight duration, positive separation, ballistic clearance at the
exact landing lip before collision snapping, completed landing and no recovery.
This catches a shallow candidate that flew below its imaginary landing deck.
The bounded bot search now prefers clean laps before time improvements on V6,
and distributes its finite peak search over longer sweeps. Vehicle physics and
saved V4/V5 solver results remain unchanged.

## Reproduction and evidence

```sh
npm ci --cache /tmp/daily-lap-npm-cache
npx tsx scripts/daily-variety-check.ts /tmp/daily-variety 200
python3 scripts/render-daily-variety.py /tmp/daily-variety/forecast.json /tmp/daily-variety/contact.png
```

The check calls the production daily service with an in-memory implementation of
its atomic storage interface. It uses exactly
`daily:t5_kyc33w:YYYY-MM-DD`, Nov 23–Dec 22, 2026 inclusive; persists and reloads
each record; independently revalidates its copied geometry at record creation;
then compares ranked replay and the actual practice driver. It also reconstructs
the prior V5 result for each same seed. The extra campaign uses 100 development
word seeds and 100 consecutive public daily seeds beginning Jan 1, 2027. There
is no reserve substitution inside that campaign: a failure is recorded and makes
the command fail.

The contact sheet is derived entirely from the accepted canonical samples and
winning input tapes. It labels every date/family, start/direction, distance,
climb, jump count, gap length, peak and elevation profile. All profiles use a
common 0–18 m axis. Both map and elevation road strokes stop at actual gaps;
orange sections of the timing strip show releases. It is one column for reading
on a phone and is marked **DRAFT / NOT DEPLOYED**.

The browser test serves real daily records through the normal transport and
uses native key input to complete one lap from every family. Cloud software
rasterisation exceeded the original 4 minute limit during the first default
cadence lap; the repeat controls only requestAnimationFrame to 20 rendered fps.
It retains the real renderer, camera, inputs and every 120 Hz physics update.
This is browser consistency evidence, not a physical-phone FPS measurement.

## Verified candidate results

- All 30 requested public UTC dates accepted through production record creation;
  30 unique hashes, zero reserve calls, exact ranked/practice finish-tick parity.
- Family mix: 11 sweeping, 6 technical, 8 ridge, 5 long-run days. Five gap days;
  all other 25 days have zero fast/cautious airborne ticks. Six/seven-lift days
  drop from 23/30 in V5 to 14/30. The new distribution is seven 4-lift, nine
  5-lift, ten 6-lift and four 7-lift courses.
- Peak elevations: 9.039–17.973 m, versus 1.479–6.5 m for the same V5 dates.
  Ridge summit grades reach 20.6% and the second hill gives downhill variation.
- Every public gap launches at about 24.583 m/s; flight lasts 170 ticks
  (1.417 s), peak clearance is 2.883–2.885 m, lip clearance 1.333 m, and touchdown
  occurs at 73.167 m within the straight runout, with zero recoveries.
  A deliberate slow miss recovers at the landing and can continue.
- Actual asphalt meshes for all five gap days have no triangle over the gap,
  road on both lips, and leave canonical data unchanged.
- The separate 200-seed campaign accepts 200/200 with 200 unique hashes,
  zero failures and zero reserve substitution.
- Full unit suite: 520 passed, zero failed. Type checking, lint, build and
  formatting passed. The retained motif regression check also accepts 200/200
  (its pre-existing three reserve uses belong to the legacy motif generator).

Per-date audit and replay evidence is in `evidence/daily-variety/public-routes.json`;
long-run results and gap mesh checks are beside it. Full sample geometry is in the
review delivery archive's `forecast.json`. The paired comparison image shows
old/new silhouettes for the first four public dates, covering all four families.
