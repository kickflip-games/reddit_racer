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
