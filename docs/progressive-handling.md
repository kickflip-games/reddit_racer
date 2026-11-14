# Progressive handling (local candidate)

The previous centreline runtime removed all sideways movement. After only 12 ticks
(0.1 seconds) above 108% corner grip it cut speed by 40% and disabled acceleration
for 72 ticks (0.6 seconds). This explains the sudden loss of control/momentum.

New courses use progressive-slip-v1 / fixed-step-v5. Grip excess pushes the car
outwards continuously; releasing still brakes, allowing the driver to tighten the
line before running wide. Grass drag blends across the first metre outside the
road and then applies 1.25 times speed in deceleration. Holding remains possible;
there is no speed-cut threshold or throttle lockout. Only extreme departures,
more than 8 m beyond the edge, invoke the existing bounded recovery. This is a
skid/run-wide model, not a newly added rotational spin physics model.

The fixed chase camera, one-button input, canonical jump flight and missed-gap
rescue remain. Existing v1 countryside courses dispatch to an unchanged copy of
the centreline simulator. The old frozen replay fixture is not regenerated.
New course identities, local best keys and a new server storage prefix prevent
mixing times across handling models; old server data is not deleted. This follows
the project's existing pre-release namespace-reset policy. No upload performed.

Geometry's RNG namespace is retained, but quality selection now evaluates the new
handling. Thus the accepted attempt for a seed can change. The overpass regression
seed moves from country-0 to country-4, which passes the unchanged geometry and
quality gates. The unit test continues to check both deck heights and clearance.

## Measured deterministic controls

Same accepted geometry, hold throttle versus timely release controller:

| Seed      | Old hold lap | New hold lap | New brake-aware lap | New hold grass | New fast grass |
| --------- | -----------: | -----------: | ------------------: | -------------: | -------------: |
| country-0 |     31.108 s |     28.092 s |            26.217 s |        4.775 s |        0.817 s |
| country-1 |     29.617 s |     27.475 s |            25.250 s |        6.425 s |        1.358 s |

All four new runs complete without recovery. Both controls still complete their
jump and land; braking earns 1.875 s and 2.225 s. The fast controller sometimes
clips the grass; this is allowed by the existing quality gate and is not evidence
of a perfect racing line. These numbers are simulation measurements, not a claim
of human-tested feel.

Focused tests cover mild overspeed without sudden speed loss, useful manual
lifting, gradual grass slowdown, stationary stability and extreme recovery.
Physical mobile feel still needs playtesting. Review off-road rendering around
raised decks in particular before publishing; this change does not implement a
free 3D vehicle rigid-body solver.

## Verification on UoA Mac (Node 24.22.2)

- 359 unit tests passed, including the unchanged historical replay fixture.
- TypeScript, ESLint and production Vite build passed. Build reports an existing
  large-chunk advisory.
- Both Chromium production-route browser smokes passed with native hold/release
  input: gap jump and both overpass levels (41.1 seconds). Screenshots captured.
- No physical-phone test, webkit test, remote CI, commit, upload or deployment.
