# Countdown launch and quieter race UI

New `linked-circuits-v4` courses use `fixed-step-v9` / `countdown-start-v1`.
The course geometry recipe and ordinary v7 handling are unchanged. A fresh
accelerator press in the last 144 of the 360 countdown ticks (1.2 seconds before
GO: the end of 2 and all of 1), held through the first scored update, adds one
4 m/s launch impulse. Releasing before that update cancels eligibility. Releasing
and pressing again inside the window can qualify; repeated held inputs cannot.
Early holds, missed windows, and presses at/after GO accelerate normally with no
penalty. Nothing moves before green; held revs, rotating tyres and smoke remain.
Practice drift retains its drag/grip behavior and never grants a release boost.

Replay schema 2 records the same sampled Boolean accelerator input during
countdown at ticks -360 through -1, followed by scored ticks starting at 0.
The browser, practice driver and shared verifier use the same countdown rule.
The server derives eligibility from that bounded tape; no client boost flag,
wall-clock timestamp or claimed start speed is accepted. Countdown stays outside
the lap time. Replays remain limited to 2,400 input transitions and 14,400 scored
ticks. Bots use schema 2 with no countdown press, so quality checks still measure
ordinary starts. All runtime/schema pairs are checked explicitly.

Saved v8 (`linked-circuits-v3`) and earlier courses/runs keep their exact rules and
schema-1 tapes. Existing stored daily challenges are not rewritten or mixed with
new handling/leaderboards. Newly generated daily and practice courses select v9;
an already-created daily remains on its stored runtime until a new challenge is
created. Saved v3 seed shares still reproduce their original geometry and hash.

The race shows only 3, 2, 1, GO during the launch. Driving technique and surface
callouts, the on-course tutorial reminder, countdown boost tips and the perfect
start text are removed. Timing, lap progress, restart/settings and screen-reader
control descriptions remain. The game title now uses straight system heading
type, matching nearby headings. There is no literal “Daily Winner” heading in
current main; no new heading or winning-state feature was added.

Coverage includes window boundaries, early/timed/late starts, release/repress,
held-input repeats, cancellation at green, stationary countdown, full ranked
replay/HTTP verification, retained v8 runs, flying laps, and v3 share compatibility.
