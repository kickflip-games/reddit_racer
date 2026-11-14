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

## Follow-up: default one-lap results (November 14)

The original regression covered continuous **Practice tracks**, not the default
one-lap daily/reference flow. In that flow `driver.active` becomes false at the
finish and the results card opens. Consequently the previous active-only inset
lock did not apply. The card immediately reclaimed the left side of the desktop
camera or the bottom of the mobile camera.

On main `cb1f269`, a real rendered default-country-course run reproduced a roughly
200 px horizontal scene displacement at 960×720. At the mobile viewport the bottom
camera inset changed from 28 px to 235.1875 px. Neither was a physics teleport.

Finished races now retain the chase-layout insets too; the results card overlays
the world without making the camera move aside. Abandoned/pre-race screens still
have their existing framing, and genuine viewport size changes still adapt. This
does not convert scored one-lap races into continuous practice or alter scoring.

`finish-camera.spec.ts` exercises the real default one-lap start, input, finish,
results and retry flow. It observes the production renderer's projected car
position as well as the insets, rather than only testing a compact continuous
practice fixture. Screenshots are captured before/after on desktop and mobile.
