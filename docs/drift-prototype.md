# Two-finger drift prototype

Available in **Other tracks** (unranked practice) only. Hold one finger to
accelerate; add a second finger to drift. Lift either finger to end the drift
without braking; lift all fingers to brake. Desktop: Space + Shift. Focus loss,
pointer cancellation, retries and course changes release controls.

This uses actual fixed-step lateral physics, not a cosmetic yaw animation. The
first 0.65 seconds offers 45% more corner grip, with modest extra drag; sustained
holding progressively reduces grip to 55% and increases drag. Slip drives the
existing visual/audio feedback. No benefit on straights; no airborne drift.
Tuning is experimental and should be play-tested on phones.

Daily ranked races deliberately retain their immutable one-bit replay contract
and existing physics. Supporting ranked drift later requires new versioned
handling, replay inputs and server verification, not silently changing existing
daily records. Practice drift best laps and ghosts use a separate drift-v1 key.

Practice selects the same frozen physics identity as its course: linked-circuits-v2
uses fixed-step-v7, including road-only finishes and grass resistance even during
drift. Historic linked-circuits-v1 retains v6. New daily courses may select v7,
but their inputs remain the existing throttle-only ranked contract.
