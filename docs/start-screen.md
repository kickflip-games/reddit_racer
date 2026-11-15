# Racing start screen

The expanded entry keeps the actual course and car visible behind a compact racing placard. Forest-green italic typography, cream paper, a small chequered stripe and the orange Start button match the grassy arcade world without adding another 3D scene or assets. The one-button controls are explicit: hold to accelerate, release to brake (touch, mouse or Space).

The feed entry uses the same typography/palette and inexpensive CSS circuit art. The old CSS substitute car has been removed. It still opens the existing expanded Reddit entrypoint; no navigation, race physics, audio or loading logic is changed.

Start styling is scoped to the visible Start button; result, abandoned/retry and settings flows retain their existing behavior. Car-load status and retry controls remain visible, and longer failure/ranked content can scroll. The new decoration has no animation, so reduced-motion users receive the same static composition. The live scene continues to obey its existing reduced-motion behavior.

## Verification

On UoA, Chromium with the actual local Three.js game: four viewport tests passed (960×720, 390×600, 320×480 and 640×360), checking card bounds/no initial scroll, control visibility and a real transition to racing. Screenshots inspected at desktop, portrait mobile and landscape. Feed poster inspected at 720×400 and 320×320. TypeScript, ESLint and production build pass (existing chunk-size warning remains).

Screenshots are local test artifacts, not committed generated files. This is local Chromium validation, not a claim of physical-phone or hosted Reddit testing. Full integration with simultaneous car-loading, world and audio changes should be checked before deployment.
