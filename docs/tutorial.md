# First-drive controls lesson

The home placard includes **New? Learn to play**, changing to **How to play**
after completion on that browser. The lesson is optional and can be replayed.
It never starts an attempt or changes the selected track, ghost, settings, or
leaderboard state.

This is a control rehearsal, not a simulated lap. Hold the practice pad with a
mouse/touch, or focus it and hold Space, for 600 ms. The second prompt then waits
for release before confirming braking. Enter also operates the focused practice
pad for keyboard accessibility; the real racing control remains Space or touch.
Brief taps, lost focus, and cancelled touch gestures do not complete the lesson.
Skip and Escape return focus to the home control without marking completion.

The modal uses native focus containment, live step announcements and system
reduced-motion preferences. If browser storage is unavailable, the lesson still
works, but the completion label will not persist.

Verification: `tests/browser/tutorial.spec.ts` covers desktop keyboard, skip,
early release, interruption, replay, persisted completion, actual mobile touch,
compact layout, and isolation from daily ranked-attempt requests.
