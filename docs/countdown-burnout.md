# Countdown tyre spin

Holding the normal accelerator during the countdown spins the rear tyres and emits a small smoke cloud. Releasing stops new spin and smoke; existing smoke fades. Held input continues into the race through the existing input controller.

This is presentation-only. Countdown simulation remains stationary, at tick zero; no speed, stored acceleration, boost, replay input format, or scoring rule changes. The rear-wheel visual offset is carried into rolling motion to avoid a visible snap, and resets with a new attempt. Reduced-motion mode suppresses the decorative spin and smoke.

Regression coverage checks keyboard and real mobile touch, stationary countdown position/timing, launch continuity, release/cancel/restart/focus interruption, and reduced motion. Particle allocation and emission stay bounded.
