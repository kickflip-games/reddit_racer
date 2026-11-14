# One countryside, different course compositions

This extends the merged #60 spring scenery generator, rather than replacing it
with a second system or introducing biomes. The canonical course seed selects
one of three green compositions:

- Open meadow: more grassy clearings, fewer trees, gentler distant contours.
- Woodland clearings: more clustered groves, broken by meadow and hedge sections.
- Rocky pasture: elongated boulder ridges with smaller stones and bushes and more pronounced rolling ground.

The existing Kenney conifer and racing landmarks remain in use. Only six selected
GLBs are tracked in this checkout; this change does not invent or download a new
asset pack. Rocks, bushes, flowers and fences reuse the existing batched primitives.

`src/client/scenery-profile.ts` holds the small composition table. Tree density,
outcrop count and hill amplitude are deliberately bounded. Profile selection uses
the canonical seed, not date/time, viewport or device. Light detail retains the
same outcrops, props, regions and ground while thinning incidental cover. Generation
still enforces the existing 5,200-plant, 260-tree, 64-prop and 18,000-candidate caps.
All decorative slopes start outside the 21-metre road-edge envelope. Track geometry,
collisions, handling, replay hashes, daily persistence and controls are unchanged.

The version `green-composition-v3` identifies the changed decorative layout.
Previously stored daily tracks retain their canonical driving data, but their
scenery is re-rendered using this new version, identically for all clients.

## Local validation

UoA Mac, Node 24.22.2. TypeScript, ESLint, production build and all 361 unit tests
passed. The 200-course geometry/driving check passed. Two native-driving scenery
browser tests passed in desktop and mobile-sized Chromium, including reduced motion
and detail switching. Local screenshots at 960x720 and 390x700 rendered without
page errors; no gameplay recordings were made. These are not physical-phone or
hosted Reddit tests, nor a full browser-suite run.

Example deterministic counts (all within existing budgets):

| Seed    | Composition        | Plants | Trees | Outcrop rocks | Imported props |
| ------- | ------------------ | -----: | ----: | ------------: | -------------: |
| green-0 | Woodland clearings |   3828 |    62 |            16 |             36 |
| green-1 | Rocky pasture      |   3681 |    27 |            38 |             31 |
| green-2 | Woodland clearings |   4332 |    60 |            22 |             36 |
| green-3 | Open meadow        |   3621 |    25 |            18 |             18 |

There are no additional asset downloads, materials or per-frame placement loops.
No new performance claim is made beyond bounded generation and the existing
instanced render path. Human playtesting should judge how distinguishable the
compositions feel at racing speed; these intentionally remain one visual family.

## More visible rocky terrain

Version 3 gives each outcrop up to three broad, low boulder anchors at 3.2–4.2
times the existing rock size, with smaller stones and bushes at their feet. Ridges
follow the nearby road direction loosely, but sit farther out in the countryside.
Full scaled footprints participate in placement and road clearance tests. There
are no additional rock meshes, asset downloads, physics colliders or draw batches.
The same anchors remain present at light detail. Exact placement is still rejected
when another road segment or vegetation would obstruct it.

The updated safety suite explicitly checks the larger rock footprint. Desktop and
mobile-sized native-driving scenery regression tests were rerun, with additional
driving stills and no recordings. The 200-course check above was run for version 2;
version 3 only changes decorative rocks, not the previously validated terrain or
canonical course generator.
