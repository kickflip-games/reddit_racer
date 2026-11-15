# Course-wide countryside landmarks

`green-composition-v4` keeps the existing grassy meadow/woodland/rocky-pasture
profiles, rolling ground, elevated roads, jumps and bends. It reserves four
scenic pockets around each lap before random filler can exhaust the plant
budget: alternating boulder gardens and blossom groves, with asymmetric smaller
rocks, shrubs, flowers and grass. Existing red/white Kenney barriers and pylons
also form three short route-side clusters. These are decorative landmarks, not
new collisions or checkpoints.

Each pocket searches at most 24 deterministic candidates within its quarter of
the course. Placement always obeys the existing full-road clearance, recovery
envelope, terrain bounds, jump visibility and occupancy checks. An impossible
placement is skipped rather than forced through the road. Density-zero debug
settings remain respected. Light quality preserves landmark pockets instead of
thinning them into disconnected dots. All counts remain inside existing caps;
there are no new assets, materials, per-object update loops or render passes.

## Validation

- 100 consecutive `landmarks-0` through `landmarks-99` elevated course seeds,
  without seed filtering: each had all four pockets with at least four members.
- Solid landmark clearance, existing candidate/plant/prop limits, and unchanged
  canonical track hashes checked on every one of those seeds.
- Light/full quality placement agreement checked separately.
- Existing scenery-composition and environment tests pass.
- Six browser load/control checks cover three representative seeds on desktop
  and mobile Chromium; screenshots were inspected on desktop and phone-sized
  viewports. No physical-phone performance benchmark was run.

The historical scored track and replay/simulation contract are unchanged. This
is a bounded scenery-composition improvement, not a guarantee that every
possible pathological custom track has room for all pockets or a rewrite of
route geometry.

### Visibility follow-up

Anchor search now starts 17 m beyond the road edge rather than 24 m, still
respecting the existing footprint/recovery clearance. Its nearest road section
must belong to the intended quarter, so crossing roads cannot steal another
section’s landmark. The 100-seed regression checks this association explicitly.
Actual desktop/mobile gameplay-camera captures at 30% of `landmarks-1` show the
blossom pocket beside the bend; these are observed simulation positions, not
substitute overview cameras. Rock scale bounds remain 4.2 maximum (anchor 3.6),
while non-rock plants retain their existing ≤2 bound.

## Natural surroundings (v5)

Removed decorative cone/barrier clusters and isolated fence strips from grass.
Natural scenic pockets remain intact. Decorative start/finish flags have also been removed; the existing checker
stripe on the asphalt identifies the line without distant props.
Road markings, ramp guidance, track geometry and driving physics are unchanged.
Regression checks cover 100 seeds with no pylons/barriers/fence fragments and
preserve existing scenic pockets, budgets and canonical track hashes.
