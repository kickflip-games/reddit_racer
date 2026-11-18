# Countdown tyre spin

Holding the normal accelerator during the countdown spins the rear tyres and emits a small smoke cloud. Releasing stops new spin and smoke; existing smoke fades. Held input continues into the race through the existing input controller.

This is presentation-only. Countdown simulation remains stationary, at tick zero; no speed or stored acceleration during countdown. The rear-wheel visual offset is carried into rolling motion to avoid a visible snap, and resets with a new attempt. Reduced-motion mode suppresses the decorative spin and smoke.

Regression coverage checks keyboard and real mobile touch, stationary countdown position/timing, launch continuity, release/cancel/restart/focus interruption, and reduced motion. Particle allocation and emission stay bounded.

## Timed start bonus

New linked-circuits-v3 tracks use frozen fixed-step-v8 / timed-start-v1 handling. Pressing accelerate for the first time in scored ticks 1–36 (the first 300 ms after GO) awards a one-time 4 m/s nudge. Holding early or pressing late gets ordinary acceleration without any penalty. A brief GO cue and Perfect start! confirmation explain success. This is independent of drift.

The bonus is derived only from scored inputs, reproduced by the server from the existing replay tape. Historical track/runtime pairs remain unchanged, and new track identity isolates leaderboard and local best comparisons. Reduced motion still shows the static timing cue without decorative burnout animation.
