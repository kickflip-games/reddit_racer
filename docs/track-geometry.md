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
