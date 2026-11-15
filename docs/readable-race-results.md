# Readable timing and results

The result overlay previously relied on a world gradient sharing `#race::after` with speed feedback. Results could consequently lose their surface and place dark numbers directly over grass and asphalt.

Timing now has its own small dark-green surface with cream tabular monospace digits. The finish panel has an opaque cream surface, dark-green digits, no negative number spacing, and a bounded responsive size. Its layout remains an overlay and does not change the finish camera.

Validated in actual desktop/mobile finishes, restart and four start-screen sizes (12 browser cases). Result screenshots confirm clear contrast independently of scenery. No movement or scoring changes.

## Continuous practice feedback

Practice already uses a continuous driver; it now shows a short non-blocking lap receipt beneath the timer. First lap establishes the benchmark, an ordinary lap gets a simple chime, and beating a previously recorded course-specific best gets a warmer badge and distinct audio lift. Lower elapsed time is better; this is a **personal course best**, never a claim of global leaderboard rank. The ranked daily attempt still submits one authoritative run.

The receipt is absolutely positioned so it cannot resize the camera's HUD exclusion region. It clears on restart/interruption, never changes input/velocity, and its small entrance animation respects OS reduced motion. Muted/background audio remains silent.
