# Stable stopped-car facing

The visual car previously switched from its velocity heading to the road tangent
as speed fell below 0.1 m/s. After a slide, those directions differ substantially:
a native-input practice run on `country-1` snapped 35.0° at its final stop. The
simulation position then stayed still; this was a presentation snap, not
ongoing physics drift.

At negligible velocity the renderer now retains the preceding displayed
heading. Initial load and explicit Retry still initialize from the road tangent.
Moving-car direction, speed, braking, traction, simulation, replay and camera
code are unchanged.

`tests/browser/stopped-car.spec.ts` observes the production renderer during a
real hold→release→slide→stop, followed by acceleration and Retry. On desktop and
mobile Chromium, measured stopping yaw changed from 35.0° to 0.019° between the
last moving 100 ms sample and first stopped sample. During the final settled
samples, root position, heading and body rotation were identical; camera
position change was 0. Projection smoothing remained below 1e-5 matrix units.
The test also confirms stationary initial pose, acceleration after stopping,
and exact initial facing/position after Retry. Screenshots, not recordings,
are captured. Physical-phone testing was not performed.

## Restart smoothing

The retained stopped pose exposed a second transition: resuming after a slide
snapped back toward the new velocity direction. A mobile Chromium regression
measured a 31.43° jump in a single 16 ms sample. Visual facing now follows the
shortest angle with an 80 ms response and a 4 rad/s rate limit. Explicit Retry
still resets immediately. Authoritative position, speed, inputs and replay
versions remain unchanged. The regression now samples restart frames too.
