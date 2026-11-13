# Canonical track geometry

The racing road is plain, versioned JSON shared by Node and the browser. Three.js meshes are consumers of this data; meshes never define race physics. `src/shared/track.ts` has no DOM, renderer, Devvit, random-number or clock dependency.

## Schema version 1

A `Track` stores `schemaVersion: 1`, `generatorVersion`, `seed`, `totalLength`, `startS: 0`, `samples` and ordered intermediate `checkpoints`. Distances, positions and widths are metres. Each sample contains:

| Field       | Meaning                                       |
| ----------- | --------------------------------------------- |
| `x`, `z`    | Horizontal centreline position                |
| `s`         | Cumulative closed-polyline arc distance       |
| `tx`, `tz`  | Unit forward tangent                          |
| `curvature` | Signed turning angle per metre                |
| `width`     | Full width of the drivable road cross-section |

The first sample is at `s = 0`; it is **not** repeated at the end of the array. `totalLength` includes the last-to-first segment. Checkpoints have a stable string `id` and interior distance `s`, strictly increasing between zero and `totalLength`. The start/finish is distinct from intermediate checkpoints.

In the `(x, z)` plane the canonical normal is `(-tz, tx)`. Positive curvature turns toward this normal. The reference oval has negative curvature with its chosen direction. Outward overspeed motion therefore has the opposite sign to curvature. Cosmetic heading can be calculated with `atan2(tx, tz)`; authoritative sampling does not calculate angles.

## Authoring and precision

`src/shared/track-authoring.ts` resamples a supplied dense, smooth closed polyline, quantizes its vertices and then recomputes cumulative chord distances. It derives tangents and curvature from adjacent segments. Positions, arc distances and widths are quantized to `0.0001` metres; tangents and curvature to `0.000001`. The stored samples, rather than a future generator implementation or renderer spline, are the complete authoritative course.

`createOvalTrack()` provides the deterministic reference course used before the daily generator. It uses trigonometry only during authoring, outside the simulation. It is a test/development fixture, not a replacement for procedural daily circuits. `createTrackFromPoints()` accepts other dense closed curves and resamples them at approximately one-metre intervals by default. Do not include a duplicate closing point in its input.

`validateTrack()` rejects nonfinite fields, unsupported versions, duplicate/zero-length segments, invalid tangents, inconsistent distances or closing length, invalid widths, excessively wide tight corners and malformed checkpoints. The local radius guard is `abs(curvature) * width / 2 < 0.9`. Global self-intersections, road clearance and simulated playability are separate generator quality gates in issue #7; structural validation alone does not establish those properties.

## Sampling and exact road agreement

`sampleTrack(track, distance)` binary-searches **stored arc distances**, including the closing segment. Negative and multi-lap distances wrap. A one-nanometre seam tolerance removes floating-point remainder residue at exact lap multiples. Position and curvature interpolate between the bracketing samples.

Road strips place each endpoint at `sample.position + normal * lateralOffset`. Between samples, their actual cross-section is the linear blend of endpoint normal vectors multiplied by each endpoint half-width. `sampleTrack()` returns this effective cross-section as unit `nx`, `nz` and `halfWidth`; its returned `width` is twice that effective half-width. This captures the tiny narrowing between curved cross-sections and ensures the shared off-road boundary agrees with the triangle strip. `roadPointAt(track, s, lateral)` takes lateral metres in that frame. At `lateral = ±sampleTrack(track, s).halfWidth`, it returns the exact drivable mesh edges.

A renderer closes its strip by duplicating the first cross-section in the GPU vertex buffer only. A shoulder or kerb can extend beyond the road width, but does not change the authoritative boundary. No frame or input event needs a server request.

## Persistence and hashing

`serializeTrack()` validates and enumerates fields in a fixed order, giving the same JSON regardless of original object property order. `parseTrack(unknown)` validates untrusted decoded JSON and returns fresh canonical data. `hashTrack()` computes SHA-256 over UTF-8 canonical JSON. Store both accepted JSON and its hash for future daily challenges; a seed alone is insufficient.

Hashing uses Web Crypto, available in Node and secure browser contexts such as localhost/HTTPS. An insecure phone LAN page may lack Web Crypto. Rendering and sampling do not need it, so local phone practice must not depend on hashing. Challenge creation/storage will hash on the server.

Schema changes require a new schema version and parser. Changes to authored geometry require a generator version change. Existing persisted challenges must continue to consume their stored samples and compatible simulation/handling version.

## Verification

`npm run test:unit` covers deterministic construction, nonuniform-distance lookup, signed curvature, seam wraparound, physical/visual edge agreement, width changes, malformed data and canonical SHA-256 roundtrips. Browser fixtures compare the same serialized geometry, samples and hash across supported runtimes. The local `?debug=track` renderer overlays centreline, normals, checkpoints and curvature to inspect road alignment.

## Authored stunt practice

The **Stunt circuit** button loads an unranked course assembled from reusable local-coordinate straight and circular-turn sections in `src/shared/stunt-course.ts`. Its layout includes a hairpin, a looping horizontal sweeper, a chicane and a ten-metre gap between raised ramps. New track alternates the original and mirrored layouts. The development shortcut is `/game.html?stunt=1`.

The canonical horizontal road retains schema version 1. The authored course separately supplies gap/ramp descriptors to the practice driver and renderer; those descriptors are not persisted as ranked geometry or advertised as replay-compatible stunts. `stunt-simulation.ts` extends practice with ballistic vertical motion and constant forward speed during flight. A missed landing rescues the car to the landing ramp and applies a stationary recovery penalty. The renderer removes road, shoulders and kerbs across the exact gap boundaries and raises the ramps and car. Existing daily generation, hashes and ranked simulation remain unchanged. Vertical loops are not implemented.

Tests check clearance and closure for both mirrored layouts, successful and missed jumps, complete held laps, missing gap triangles and ramp heights. Browser tests exercise selection and actual airborne driving on desktop and mobile Chromium.

## Dynamic slot grip practice

Choose **Slot-car practice**, or use `/game.html?grip=1&seed=regression-0` locally, to drive the `dynamic-grip-v1` model. The stunt circuit also uses this handling, with a banked hairpin and a blue wet chicane. Existing daily challenges, ranked replay versions and Classic practice retain their original simulation. This prototype has no ranked replay registration.

`src/shared/slot-grip.ts` uses the same canonical left/right road boundaries and metre-valued `(s, d)` coordinates. Low-demand driving biases the lateral controller toward the inside curb. Lookahead reads signed curvature over `max(4, speed × 0.7)` metres; it suppresses the inside bias when an approaching bend exceeds the available grip. There is no baked racing-line spline. The inside target is a force-limited bias, so lateral inertia and excess centrifugal demand can still carry the car outside it.

A simplified traction circle allocates lateral acceleration as `sqrt(totalGrip² − longitudinalDemand²)`. Held acceleration consumes 6.8 m/s²; release braking consumes 4.2 m/s², so lifting restores more turning authority without granting free braking. Drag and scrub remain separate losses. A damped lateral controller requests tire force, clamps it to the remaining budget and integrates the resulting lateral acceleration at 120 Hz. Slip begins warning at 72% demand; visible yaw, existing tire squeal and the grip-limit prompt precede a large departure from the road. Crossing the curb creates runoff drag; leaving a further two metres triggers stationary recovery.

The inside offset follows a shorter arc: forward centreline progress is `sqrt(speed² − lateralVelocity²) / (1 − curvature × d)`. The denominator has a bounded guard outside the road. Lateral travel consumes planar speed, and a parked car gets no free lateral or forward motion. Continuous laps retain overshoot using this same metric.

Practice-only, validated `GripZone` descriptors specify dry/wet/dust friction and signed bank in radians. Banking adds a gravity component toward the low edge and reduces normal grip by its cosine; wet and dusty surfaces reduce the budget. Four-metre eased transitions avoid abrupt invisible changes. The renderer uses those same descriptors for banked road cross-sections, grounded car roll and wet/dust asphalt colour; skid heights follow wheel contacts. Three amber bars at each braking approach are computed from corner radius, available braking grip and maximum approach speed. They are conservative learning cues, not a promise that a single braking point is optimal for every current speed and offset.

This is an arcade controller with a friction-circle constraint, not a full tire, chassis or free-world derailment simulation. A classic outside/apex/outside line is possible through the evolving lateral state rather than imposed as a required route. The combined-slip motivation is described in the [MathWorks tire model](https://www.mathworks.com/help/vdynblks/ref/combinedslipwheel2dof.html).

Verification covers inside/lift/overspeed controls, shared grip allocation, offset path lengths, early scrub, stationary recovery, camber sign, surface transitions, twenty generated circuits with held and cautious controls, mirrored stunt flight, and continuous laps at 30/60/120 Hz. These are automated controls, not human comfort or optimal-lap measurements.
