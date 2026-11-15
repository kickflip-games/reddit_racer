# Readable timing and results

The result overlay previously relied on a world gradient sharing `#race::after` with speed feedback. Results could consequently lose their surface and place dark numbers directly over grass and asphalt.

Timing now has its own small dark-green surface with cream tabular monospace digits. The finish panel has an opaque cream surface, dark-green digits, no negative number spacing, and a bounded responsive size. Its layout remains an overlay and does not change the finish camera.

Validated in actual desktop/mobile finishes, restart and four start-screen sizes (12 browser cases). Result screenshots confirm clear contrast independently of scenery. No movement or scoring changes.

## Continuous practice feedback

Practice already uses a continuous driver; it now shows a short non-blocking lap receipt beneath the timer. First lap establishes the benchmark, an ordinary lap gets a simple chime, and beating a previously recorded course-specific best gets a warmer badge and distinct audio lift. Lower elapsed time is better; this is a **personal course best**, never a claim of global leaderboard rank. The ranked daily attempt still submits one authoritative run.

The receipt is absolutely positioned so it cannot resize the camera's HUD exclusion region. It clears on restart/interruption, never changes input/velocity, and its small entrance animation respects OS reduced motion. Muted/background audio remains silent.

## Verified daily leaders

Ranked results now show a gold `Daily leader!` badge (`Joint daily leader!`
for ties) only after the validated server standings associate this exact
verified run/session with a personal best and current rank one. Older records,
a better run from another device, unverified practice and unavailable standings
cannot trigger this celebration. This is a snapshot of the daily board, not an
all-time-record claim. Refreshing standings does not replay the reward. The
short personal-best chime is bounded and respects mute/background/retry; reduced
motion removes the badge's small bloom. No rank is inferred from local timing.

### Best-lap ghost

Continuous practice has a default-on **Best lap ghost** setting. A small cyan
marker and one-second trail follow your fastest recorded lap in lap-relative
simulation time; the trace does not affect collisions, physics or ranking.
The ghost disappears after its finish rather than wrapping early while your
current lap is still running. Each new player lap restarts the ghost clock.

A maximum of eight course/handling-specific traces are retained locally, with
4096 samples per trace and at least 12 simulation ticks between samples.
Overlong/incomplete laps are not stored; storage denial falls back to this
session. Track fingerprints and simulation/handling versions reuse the same
identity as local bests. Old best times from before this feature contain no
trajectory: beat or match that time to record its ghost. The setting persists
across courses; turning it off hides the marker, but recording continues.
The effect has no pulse, camera movement, lights or particles and uses two
small draw calls, with fixed geometry reused per frame. It supports the same
mobile settings dialog. Ranked daily races do not show a local practice ghost.
