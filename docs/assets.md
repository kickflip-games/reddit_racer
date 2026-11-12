# Kenney asset inventory

The supplied `assets/3d_models.zip` was inspected before selecting game art. It is approximately 27 MiB compressed and 73 MiB uncompressed, and contains six kits with 595 GLB models plus duplicate FBX/OBJ formats and previews. The archive is source material, not a browser asset bundle.

## Road approach

Use a procedural road mesh derived from the authoritative centreline, with generated kerbs and markings. Use selected Kenney cars, trees, barriers and race furniture for presentation. This preserves smooth, varied corner radii and deterministic reconstruction without making visual meshes part of the physics.

The included road kits offer modular straights, corners, ramps and intersections. They are useful references and decoration sources, but their fixed corner radii would constrain hairpins, sweepers and decreasing-radius corners. City roads include road signs, cones, barriers and street furniture. The separately investigated 3D Road Tiles pack adds 300 tiles but does not remove that geometric constraint.

## Useful archive paths

All paths below are relative to the ZIP root.

| Asset                   | Archive path                                                                                                              | Size and notes                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Recommended initial car | `3d_models/kenney_racing-kit/Models/GLTF format/raceCarRed.glb`                                                           | 106,064 bytes; 1,430 triangles; body and four named wheel nodes; no external textures. Other colour variants are available. |
| Toy racer alternative   | `3d_models/kenney_toy-car-kit/Models/GLB format/vehicle-racer.glb`                                                        | 104,328 bytes; 1,076 triangles; separate wheels; external palette texture.                                                  |
| Low toy racer           | `3d_models/kenney_toy-car-kit/Models/GLB format/vehicle-racer-low.glb`                                                    | 103,808 bytes; 1,072 triangles; separate wheels; external palette texture.                                                  |
| Modern race car         | `3d_models/kenney_car-kit/Models/GLB format/race.glb`                                                                     | 167,272 bytes; 1,952 triangles; separate wheels; external palette texture.                                                  |
| Race barriers           | `3d_models/kenney_racing-kit/Models/GLTF format/barrierRed.glb`, `barrierWhite.glb` in the same directory                 | Approximately 3.2 KB and 28 triangles each.                                                                                 |
| Race trees              | `3d_models/kenney_racing-kit/Models/GLTF format/treeSmall.glb`, `treeLarge.glb` in the same directory                     | Approximately 7 KB each.                                                                                                    |
| Toy trees               | `3d_models/kenney_toy-car-kit/Models/GLB format/tree.glb`, `tree-pine.glb` in the same directory                          | 11,032 / 12,640 bytes; 98 / 114 triangles; external palette texture.                                                        |
| Race furniture          | `3d_models/kenney_racing-kit/Models/GLTF format/`                                                                         | Includes `roadStart.glb`, `pylon.glb`, `flagCheckers.glb`, `grandStand.glb`, gates and pit structures.                      |
| City road decorations   | `3d_models/kenney_city-kit-roads/Models/GLB format/`                                                                      | Includes `construction-cone.glb`, `construction-barrier.glb`, signs and lights.                                             |
| Buildings and trees     | `3d_models/kenney_city-kit-suburban_20/Models/GLB format/`, `3d_models/kenney_city-kit-commercial_2.1/Models/GLB format/` | Prefer a small deliberate selection; detailed commercial buildings reach hundreds of KB each.                               |

## Loading requirements

- Selectively extract chosen GLBs and their dependencies into a frontend asset directory. Exclude archive previews, alternate formats, `.DS_Store` and `__MACOSX` metadata.
- Most newer-kit GLBs refer to `Textures/colormap.png` relative to their model URL and use `KHR_texture_transform`. Preserve that path or explicitly remap it. Toy Car, City Roads and Car Kit palettes are different files: 8,706, 11,428 and 12,371 bytes respectively. Do not overwrite one kit's palette with another.
- Racing Kit models inspected use `KHR_materials_unlit`. Their materials will not respond to scene lighting unless deliberately converted. Preserve colours and evaluate the result visually before enabling shadows.
- Load Three.js and GLTF assets only in the expanded game entry. Keep the inline splash lightweight. Reuse loaded geometries/materials and instance repeated scenery; cap prop counts and shadows for phones.
- Normalize model scale, orientation and origin in the visual layer. Derive the car position and effects from shared simulation state; never derive racing collision or checkpoints from art meshes.

## Provenance and licence

The ZIP contains no licence or README files. Kenney's official support page states that assets on its asset pages use Creative Commons CC0 and attribution is optional. Include a CC0 notice and the relevant source links when assets are extracted. Do not use the Kenney logo.

- [Kenney licensing and attribution](https://kenney.nl/support)
- [Racing Kit](https://kenney.nl/assets/racing-kit)
- [Toy Car Kit](https://kenney.nl/assets/toy-car-kit)
- [Car Kit](https://kenney.nl/assets/car-kit)
- [City Kit Roads](https://kenney.nl/assets/city-kit-roads) — official listing describes CC0, road signs and traffic lights.
- [3D Road Tiles](https://kenney.nl/assets/3d-road-tiles) — official listing describes 300 CC0 tiles.

No assets have been extracted or added to the browser build by this inventory.
