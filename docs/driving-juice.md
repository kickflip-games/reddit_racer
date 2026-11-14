# Restrained driving feedback

This pass extends the existing driving feedback rather than adding parallel particle/audio systems.

Already present and retained: visually leaning car body, slip-triggered tyre squeal/smoke/road-contained skid marks, pooled grass dust and off-road rumble, landing dust, lap chime and Best/Last times.

New presentation-only additions:

- A landing compresses the body by up to 9 cm, rebounds once, and settles within 0.45 seconds. Wheels and authoritative vehicle position are untouched.
- A landing nudges the orthographic projection by at most 1.5 CSS pixels. The camera world position, follow anchor, orientation, framing and physics never receive this impulse; it cannot accumulate into camera drift.
- Four very faint peripheral speed strokes fade in above 24 m/s, capped at 18% opacity. They are static CSS gradients, not a particle emitter or additional animation loop.

`createLandingFeedback` consumes the simulation's normalized impact and monotonically increasing landing count. Repeated renders cannot retrigger it; new attempts, recovery, inactive phases and reduced-motion preferences clear it. Rest is exactly zero. OS reduced-motion also hides the peripheral layer in CSS. No movement constants, replay rules, input or lap reset logic changed.

Tuning: suspension distance and decay in `landing-feedback.ts`; the camera separately clamps its displacement in `race-camera.ts`; speed threshold/opacity in `game-scene.ts`. Keep the impulse tiny: the user explicitly disliked camera jumps at lap boundaries.

Validation is recorded in the implementation report. Physical phone feel is still a human playtest, not established by desktop mobile emulation. No gameplay recordings are generated.
