# Stronger countryside toon shading

The car and scenery now share an explicit three-step lighting ramp (45, 130,
255), sampled with nearest filtering. Imported palette textures and alpha are
preserved. Procedural fallback models use exactly the same ramp. Hemisphere
fill is reduced from 2.1 to 1.05 so shaded faces remain distinguishable; the warm
2.4 directional light is unchanged. The environment gallery uses the same
lighting as the production race.

The ramp is one shared, immutable three-byte texture retained for the page
lifetime. Disposing individual scene materials does not dispose that shared
texture. No extra lights, geometry, shadow maps, outline passes or post-processing
were introduced. This is a stronger toon contrast setting, not a higher-cost
render quality setting.

## Verification

`tests/unit/toon-material.test.ts` checks shared ramp ownership, step values,
nearest filtering and disabled mipmaps. Existing palette/alpha and shadow tests
remain unchanged. `tests/browser/toon-shading.spec.ts` captures the real
production race after assets load on desktop and emulated mobile Chromium, and
checks for browser script errors. November 14 before/after screenshots were
visually inspected at 960×720 and 412×839: car paint, faceted trees and rocks have
stronger light/shade separation while the dark road, cream markings, flowers,
clock and restart remain readable. No physical-phone GPU benchmark was run.
