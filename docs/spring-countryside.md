# Spring countryside

Environment overhaul for #57, with context from the screenshots in #52 / #53 and camera work in #56. One spring theme ships: muted grass, pink and cream crowns, dark conifers, small flower patches, shrubs, rocks and wooden fences. The art references were the clustered roadside silhouettes in [Bloody Rally Simulator](https://store.steampowered.com/app/926860/Bloody_Rally_Simulator/) and the restrained palette and vegetation in [Art of Rally](https://www.artofrally.com/). No reference-game artwork is included.

## Placement and ground

`scenery-layout.ts` replaces the old regular tree triplets. Its seed is `track.seed | spring-countryside-v1 | scenerySeed`; it uses a local integer PRNG, independently of canonical road generation. Jittered road locations establish elongated, rotated grove, woodland, meadow, grassland, hedgerow and clearing regions. Angular/world-space noise warps their falloff. Three to six subcentres per region receive bounded Gaussian-like samples, thinned by region weight, density and a spatial occupancy grid. Canopies may overlap within groves; trunks and shrubs keep space. Unequal short roadside strips fill selected shoulders without a continuous flower border.

Curvature influences region type: hairpins attract grove/meadow landmarks, selected sweepers keep open outside views, and steep grades become clearings. All candidate silhouettes are checked against **every closed centreline segment**, including neighbouring return roads. Low cover stays at least 1.15 m plus its radius beyond the asphalt. Solid scenery stays beyond the existing 8 m recovery corridor plus a 2.3 m car footprint, its radius and 0.35 m margin. Tall objects near ramp approaches/landings or steep grades require a larger 23 m setback. These conservative clearances deliberately leave some open space.

A shared, at most 64 × 64-cell decorative surface supplies both the actual terrain mesh and exact triangle-interpolated root heights. Region fields also influence grass tint, with broad low-frequency variation and selected soil shoulders. The banked prototype floor stays below bank transitions; its off-deck car presentation follows that visual floor. Authoritative road height, collision, handling, replay state and off-road physics are unchanged.

Work is capped at 40 regions, 18,000 placement candidates, 5,200 plants, 260 trees and 64 borrowed props. Default review captures contain about 3,100–3,400 plants over an entire circuit, not thousands of individually allocated scene meshes. Maximum-density controls can hit the global cap; they are a diagnostic setting, not an unbounded production mode.

## Assets, lighting and motion

Selected existing Kenney trees and race flags are reused through the existing cache/instancing and material ownership. Asset files and licences are unchanged. Lightweight procedural faceted crowns, conifers, grass blades, three-head flowers, shrubs, rocks and fences share reusable geometry and materials. Instances are batched by kind in 48 m spatial chunks for frustum culling. Matrices, colours and phase buffers are static.

A dedicated foliage vertex shader bends flexible vertices using two smooth waves, world position and per-instance phase. Stems/trunks stay anchored; canopy movement is smaller. One shared time/focus uniform replaces CPU plant updates. Wind fades out between 32 and 56 m, stops for reduced motion, and pauses outside active driving/countdown to preserve idle rendering. It never enters simulation state. Imported Kenney materials and their shadows are not patched.

Warm sun and hemisphere fill remain consistent with the existing car/track materials. Static terrain lighting is baked into vertex colours, retaining inexpensive ground rendering. Foliage uses soft diffuse vertex lighting; the workshop also offers a selective two-band toon comparison. Soft lighting was retained after comparing the rendered images below: it blends more gently with imported assets. Instanced feathered contact shadows add grounding without shadow maps, bloom or post-processing.

| Soft diffuse (shipped)                                       | Two-band foliage comparison                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| ![Soft](evidence/spring-countryside/workshop/soft-light.png) | ![Toon](evidence/spring-countryside/workshop/toon-light.png) |

The portrait camera shows more roadside context while retaining the tested minimum car size and upcoming-corner visibility. The car, road, braking cues and jump approaches remain the visual priority.

## Development review tool

Run `npm run dev:local`, then open <http://127.0.0.1:5173/environment-gallery.html>. Controls cover canonical track seed/type, separate scenery seed/version, region/tree/ground-cover density, detail, wind, foliage lighting, region and approximate clearance overlays, and road progress. The red clearance guide is approximate; actual candidate checks include each silhouette's radius.

The twelve thumbnails render twelve distinct canonical seeds sequentially through one renderer and dispose each preview. These are actual Three.js previews with a static review pose, distinct from native-input gameplay captures. This HTML entry is absent from `devvit.json` and the production build. Production ignores workshop query parameters.

![Twelve distinct circuit/environment compositions](evidence/spring-countryside/workshop/twelve-seeds.png)

[Full workshop](evidence/spring-countryside/workshop/workshop.png) · [Region overlay](evidence/spring-countryside/workshop/regions.png) · [Clearance overlay](evidence/spring-countryside/workshop/clearance.png)

## Actual before / after captures

Before is clean main `27922a1477301fd99ae87c88aa210aa32c5fb656`, served from a separate archive and Vite cache. Both versions receive the same native Space input and virtual-clock schedule through the normal UI, with no pose, simulation or renderer overrides. Manifests record exact query, viewport, elapsed virtual time, observed progress and runtime errors. The portrait framing intentionally changes. The straight capture is on the back straight approaching the wet chicane. Elevated jump capture waits for actual airborne state. These scripted captures are not human playtesting.

| View              | Before                                                | After                                                |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Generated circuit | ![](evidence/spring-countryside/before/generated.png) | ![](evidence/spring-countryside/after/generated.png) |
| Hairpin           | ![](evidence/spring-countryside/before/hairpin.png)   | ![](evidence/spring-countryside/after/hairpin.png)   |
| Back straight     | ![](evidence/spring-countryside/before/straight.png)  | ![](evidence/spring-countryside/after/straight.png)  |
| Sweeper           | ![](evidence/spring-countryside/before/sweeper.png)   | ![](evidence/spring-countryside/after/sweeper.png)   |
| Elevated jump     | ![](evidence/spring-countryside/before/jump.png)      | ![](evidence/spring-countryside/after/jump.png)      |
| Portrait          | ![](evidence/spring-countryside/before/portrait.png)  | ![](evidence/spring-countryside/after/portrait.png)  |
| Desktop           | ![](evidence/spring-countryside/before/desktop.png)   | ![](evidence/spring-countryside/after/desktop.png)   |

Motion evidence uses actual real-time native Space input: [portrait](evidence/spring-countryside/workshop/portrait-motion.webm) and [desktop](evidence/spring-countryside/workshop/desktop-motion.webm). The browser wind test additionally checks that pixels move with wind enabled and settle when it is disabled, without changing instance transforms.

Reproduce with `scripts/capture-countryside.mjs NEW_DIRECTORY` (`CAPTURE_URL` selects the before server), `scripts/capture-countryside-workshop.mjs NEW_DIRECTORY`, and `scripts/profile-countryside.mjs NEW_DIRECTORY`. Output directories must be new.

## Performance and limits

| Condition            | Ready load (ms) | Mean / p95 / max frame (ms) | Draw calls |     Triangles |
| -------------------- | --------------: | --------------------------: | ---------: | ------------: |
| Before portrait      |             879 |          16.8 / 16.8 / 50.1 |      24–30 | 21,390–22,118 |
| After portrait Full  |             883 |          22.7 / 33.4 / 66.8 |      37–53 | 33,734–44,710 |
| After desktop Full   |             815 |          20.8 / 33.4 / 66.7 |      33–47 | 29,846–44,726 |
| Before desktop       |             676 |          16.8 / 16.8 / 50.0 |      24–30 | 21,390–22,118 |
| After portrait Light |             832 |         17.2 / 16.8 / 233.3 |      37–47 | 25,908–29,830 |

These are local development-server measurements on **Mac headless Chromium using SwiftShader**, with native input and 12 real seconds of racing per view. They are not physical-phone measurements or hosted Reddit loading measurements. Both versions use the same read-only instrumentation. Loading is one sample per condition, with caching/noise; frame times include browser scheduling and software rendering. Raw frames, draw samples, renderer identity, errors, heap and five actual track regenerations are committed in [performance.json](evidence/spring-countryside/performance/performance.json).

Full detail costs more rendering work. Settings → Scenery offers Auto / Full / Light and applies during a race without restarting it. Auto chooses Light for devices reporting four or fewer logical cores. Light retains tree silhouettes and roughly 35% of low cover, with wind disabled. That heuristic cannot identify every weak GPU; the manual setting remains available. Full instance buffers are retained for instant switching, so Light reduces rendering work rather than allocation size.

On an Apple M5 Max (18 logical cores), the five-regeneration portrait sample retained **8 live GL textures** after each new track; baseline retained **12, 16, 20, 24, 28**. Full-detail shader programs stayed at 15. GL buffer counts varied with which chunks were visible (195–224 after regeneration), rather than growing by a fixed renderer allocation. Collected JS heap grew from 17.1 MB initially to 19.6 MB after five regenerations (baseline 15.5 → 17.9 MB). This includes warm-up and profiling data; it is not a flat-heap result.

Light averaged 17.2 ms with a 16.8 ms p95, but had a 233.3 ms worst frame in this short run. Full portrait averaged 22.7 ms with a 33.4 ms p95. Those outliers and Full's increased cost need real-device follow-up; this evidence does not establish stable 60 fps on phones.

The renderer now survives ordinary track changes on the same canvas, fixing the previous accumulation of four internal fallback textures per remount. Scene-owned meshes, instance buffers, materials and geometry are still released; borrowed asset templates have their existing ownership. No claim is made of perfectly flat JS heap or full leak freedom from a five-regeneration sample.

Remaining limits: no physical iPhone/Android performance or human comfort test, no hosted Reddit playtest in this task, no distant streaming/LOD mesh system, and only one theme. Coarse decorative terrain and contact shadows favour speed over physically accurate shadowing. Wind is deliberately subtle and is frozen on entry/results screens.

## Validation

- 343 unit tests, including exact seed reconstruction, twelve distinct seeds, independent road/recovery clearance, finite transforms, actual triangle grounding, bounded work, Light subsets, wind/static transforms, reduced motion, and owned-resource disposal.
- Type checking, lint, formatting and production build.
- 200 classic and 200 elevated circuits, including authoritative jump replay checks.
- Browser coverage includes native driving, replay/Node agreement, Reddit score/session/leaderboard flows, portrait layouts, idle rendering, in-race detail changes, twelve-seed rendering, wind on/off and five real game remounts with measured texture lifetimes.

The final application source was captured/profiled at `f6a795920fe5db87bf48d04333d118c1bf4a0612`. `npm run check` and the separate 200-course elevated check pass. [PR #60](https://github.com/kickflip-games/reddit_racer/pull/60) carries the final browser and CI results before merge.

`src/shared` and `src/server` are unchanged. Existing procedural roads, one-button handling, scored replay authority, personal bests and leaderboard integration remain in place.
