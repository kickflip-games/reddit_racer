# Restrained toon art and projected shadows

Car and scenery use Three.js MeshToonMaterial instead of PBR materials. The
imported palettes, opacity, emissive details and sidedness are retained; cached
asset materials/textures are never modified or disposed by the visual consumer.
No outline, bloom, render target or extra lighting pass is added. Vegetation
retains its existing inexpensive vertex-lighting/wind shader.

Environment shadows are static, soft **approximate projections**, not baked
lightmaps or full geometry shadow maps. Tree, barrier and up to 256 additional
vegetation-tree projections share one static instanced draw. Their direction
matches the existing sun. The bounded cap protects phones from unbounded alpha
overdraw; distant small plants intentionally have no individual shadows.

The car gets a soft rounded rectangular silhouette instead of a hard ellipse.
Its world-space projection follows the supporting surface, not body bank/pitch.
It offsets away from the sun, grows and fades with jump height. Elevated road
height is respected. This does not simulate shadow reception on other cars,
self-shadowing or precise curved-terrain conforming: a geometry shadow map would
be a separate quality/performance tradeoff, not claimed by this implementation.

Tune the fallback paint in car-visual.ts, imported prop colours in scenery.ts,
shadow opacity/edge softness in toon-material.ts and the static cap/footprint in
environment.ts. Driving physics and replay data are untouched.

## Vibrant cel-world follow-up

The initial toon change affected small props/car only. Most visible pixels still
used olive baked terrain, Lambert road and the soft vegetation default; strong
hemisphere fill flattened the remaining bands. This follow-up addresses those
large areas rather than adding a postprocessing filter:

- One opaque terrain shader uses three diffuse bands and broad, smooth-edged
  world-space colour patches with fresh green highlights and teal shadows.
- Navy asphalt, coral/ivory kerbs and sandy shoulders keep the road distinct.
- Vegetation now defaults to its existing cel shader in production as well as
  local development, with a brighter coherent green palette.
- Cooler, lower ambient fill preserves the shape of existing toon cars/props.
- No physics, layout generation, car loader, input or replay changes.

No added draw passes, textures, objects or postprocessing. In a bounded local
headless Chromium test at 960×720 on the UoA Mac, the same elevated seed used 54
draw calls before and after. Over 150 measured frames after 30 warmup frames,
median RAF interval was 16.7 ms and p95 33.4 ms for both. These are browser-frame
intervals, not isolated GPU timings, and are not a physical-phone guarantee.
Desktop and 390×844 mobile-size renders were inspected for colour/readability.
The existing soft projected-shadow limitations above still apply.
