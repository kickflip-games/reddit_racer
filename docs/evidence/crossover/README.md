# Localized overpass candidate

DRAFT / NOT DEPLOYED. Local feature work on V6, based on
`e049da7854a141c536f5b027c50a69db93e5650d`. No Reddit data or release settings change.

One small overlapping loop occupies about a fifth of an asymmetric mixed lap.
An independent deterministic seed hash selects this recipe about one day in six.
The requested forecast has six bridge days, nine sweeping, five switchbacks,
four technical and six ridge days. All five original gap-jump days remain.
This is a road overpass, not a vertical stunt loop or a symmetric figure eight.
The reference [Hit the Brakes](https://dr-d-king.itch.io/hit-the-brakes) informed
the mixed-course direction; its assets and layouts are not copied.

The upper deck reaches 12 m. The full-width swept-corridor check includes both
0.8 m shoulders and the 0.55 m fascia, and requires at least 10 m of headroom.
The forecast's minimum is recorded in `render-audit.json`. No jump is allowed
within 60 m of either crossing traversal. The ordinary ridge and real gap ramps
retain V6's existing height and flight physics. Acceptance limits are unchanged.

Racing, ground support, recovery, checkpoints and replay use arc distance to
identify the road. No XZ nearest-road query chooses a gameplay deck. The tests
reject a forged teleport to the other traversal and a snap up from below.
Decoration and piers leave a 32 m clear radius around the crossing. The camera
angle and framing stay unchanged; only the upper crossing span fades while the
lower traversal is in view, including the home preview. A solid, cased upper
stroke shows bridge order on the minimap; its underpass marker turns cyan.

The phone images are actual local Chromium captures at 393 × 568, on the Nov 27
and Dec 4 production daily seeds. Both complete laps match ranked replay ticks,
show no airborne state on either deck, and report no browser errors. Rendering
was clocked at 20 fps on cloud software graphics; race physics ran at 120 Hz.
This is functional evidence, not a device performance benchmark.

`render-audit.json` checks 468 car positions over both decks of all six public
crossovers with the real camera and rendered geometry, from 60 m before to
60 m after each pass. There are no opaque
road/pier obstructions on those sightlines. It also checks every scenery
footprint against the crossing exclusion zone.

Reproduce the complete actual-generation forecast and acceptance sweep:

```sh
npx tsx scripts/daily-variety-check.ts /tmp/overpass-review 200
npx tsx scripts/crossover-determinism-check.ts /tmp/overpass-review
npx tsx scripts/crossover-render-check.ts /tmp/overpass-review/forecast.json /tmp/overpass-review/render-audit.json
python3 scripts/render-daily-variety.py /tmp/overpass-review/forecast.json /tmp/overpass-review/forecast.png
npm run check
npm run courses:check
npx playwright test tests/browser/crossover.spec.ts --project=mobile-chromium --workers=1
```

The contact sheet uses `createDailyChallengeService.getOrCreate`, independent
record revalidation and storage reload for Nov 23–Dec 22, 2026, public scope
`t5_kyc33w`, with seeds `daily:t5_kyc33w:YYYY-MM-DD`. All 30 have distinct accepted
tracks, zero reserve calls and matching ranked/practice ticks. Maps break at
actual gaps, case the actual upper traversal, and share a 0–18 m profile scale.
The companion comparison includes the same first five public seeds under V5.

The extra sweep accepts 200/200 distinct requested seeds without a reserve,
including 37 more overpasses. Those 37 have at least 11.409494 m full-width
headroom, zero fast airborne ticks and zero fast recoveries. All 230 public and
extra hashes are unique. The representative deterministic reconstruction checks
all 30 public dates, all 37 extra overpasses and a spread of ordinary courses
against their original accepted hash and ranked ticks (85 cases total).

The public braking rhythms are six four-lift, nine five-lift, six six-lift,
three seven-lift and six eight-lift days. The overpass days are the busiest at
eight lifts; the old baseline had 23 six- or seven-lift days and this candidate
has nine. This adds a technical option without changing the ordinary recipes.
