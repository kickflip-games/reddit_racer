# Car identity and lap-boundary continuity

Two presentation defects were separate from the continuous practice physics:

- The procedural orange fallback was visible while the Kenney GLB loaded. Late
  assets were installed whenever the driver became inactive, including after an
  interruption or completed race, making the car appear to change models.
- Revealing Last/Best lap text changed the HUD height. Its ResizeObserver updated
  the orthographic camera inset at the finish line. A baseline Chromium run
  measured the top inset changing from 57px to 98.1875px, abruptly reframing the
  world even though practice distance, speed and interpolation remained continuous.

The initial fix locked the first chosen car model. This has now been superseded
by the owner's explicit Kenney-only requirement: the procedural placeholder is
never shown or playable. Start and Restart remain disabled while the actual model
loads. A network/palette failure or ten-second deadline shows a clear message and
**Retry car load** action. Retry makes a fresh asset request; successful loading
restores Start without automatically starting an attempt. No ranked session or
countdown is created before the real model is installed.

The active run keeps a stable top camera inset when lap HUD text changes. A real
canvas size change recalculates it, and a new attempt captures a new inset. No
movement, replay or scoring rules changed.

Regression coverage: delayed asset delivery, network/palette/deadline failures and explicit load retry, and
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
