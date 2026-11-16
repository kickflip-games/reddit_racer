# Responsive driving feedback

Speed ribbons now use travelled distance rather than a fixed timer. Their flow
slows naturally when the driver lifts; length and opacity ease in above 18 m/s,
with a small extra stretch under acceleration. Tapered tails and a bounded
CSS-pixel width keep them visible on mobile without covering the car or track.
The same eight ribbons remain one draw call with reused geometry buffers.

A decisive accelerator release produces two small rear-tyre puffs only once,
while grounded, on-road, moving, and not already slipping. It reuses the existing
smoke pool and never draws skid marks for ordinary braking. Restart, recovery and
reduced motion reset the effect. Device reduced motion disables all these effects.
No simulation, replay, scoring, controls, camera or settings behavior changes.

Validation: 439 unit tests; TypeScript, lint and production build; desktop and
mobile Chromium VFX rendering plus acceleration/lift/live-reduced-motion/restart
checks. The VFX fixture asserts a single additional draw call for ribbons.
Screenshots were visually inspected at desktop and mobile sizes. This is not a
physical-phone performance measurement or hosted Reddit verification.

Known baseline test issue: `hills-feedback.spec.ts` assumes the generated `banana`
course takes off in the first 8.5 seconds. Its `flew` assertion fails on the clean
`5d7f541` course baseline too, before these changes. The rendered VFX
fixture and flight/lifecycle unit checks pass; the entire browser suite is not claimed
passing. No private upload, push, merge or deployment was performed.
