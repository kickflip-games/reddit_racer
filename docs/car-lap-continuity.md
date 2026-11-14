# Car identity and lap-boundary continuity

Two presentation defects were separate from the continuous practice physics:

- The procedural orange fallback was visible while the Kenney GLB loaded. Late
  assets were installed whenever the driver became inactive, including after an
  interruption or completed race, making the car appear to change models.
- Revealing Last/Best lap text changed the HUD height. Its ResizeObserver updated
  the orthographic camera inset at the finish line. A baseline Chromium run
  measured the top inset changing from 57px to 98.1875px, abruptly reframing the
  world even though practice distance, speed and interpolation remained continuous.

The loading car is now hidden until the asset resolves or the player starts.
Starting early selects the fallback for the lifetime of that scene, including
retries; late completion cannot replace it. A new course may select the now-cached
Kenney model before its first start. Failed loading still enables the fallback.

The active run keeps a stable top camera inset when lap HUD text changes. A real
canvas size change recalculates it, and a new attempt captures a new inset. No
movement, replay or scoring rules changed.

Regression coverage: delayed asset delivery followed by interruption/retry, and
actual two-lap rendering with stable camera inset, retained held input, speed,
track identity, lap time and no countdown/stop. Tests run in desktop and mobile
Chromium projects; this is not a physical-phone or hosted Reddit verification.
