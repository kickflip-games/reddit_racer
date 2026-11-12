# One-button driving

Press the explicit Start action, then hold the circuit or Space to accelerate. Release to brake gradually. Steering is automatic, and there are no additional driving controls. All racers use the same versioned handling in `src/shared/simulation.ts`; source changes affecting results require a handling/simulation version change and updated replay fixtures.

The screen-wide canvas captures the primary pointer. Dragging outside it does not lose the hold. Pointer up, cancellation or capture loss releases the pointer input. Space and a pointer are alternative sources of the same Boolean input: releasing one while the other remains held keeps accelerating. Secondary touches never take ownership. Capture is explicitly released on cleanup before an attempt can restart.

Blur, hidden pages, long frame gaps and work limits abandon the attempt visibly and offer Retry. A touch cancellation or capture loss returns to safe braking while the race clock continues; it never pauses time. The shared lifecycle/checkpoint rules are documented in `docs/race-rules.md`; [ranked verification](ranked-verification.md) covers session ownership and eligibility. Start/retry taps do not also accelerate. Active-race context menus and touch callouts are suppressed on the canvas; expanded-page overscroll and selection are disabled. These styles do not modify the Reddit feed itself.

Feedback always shows whether the accelerator is held or released, alongside sliding, off-road or recovery status. Brake lights and lateral car motion consume the authoritative state. Slowing before a tight corner reduces traction demand; off-road drag and stationary recovery cost time while allowing a finish.

## Verification boundaries

The frozen numerical controls in `docs/simulation.md` establish gradual controls and a measurable lift benefit. The browser suite uses actual Chromium touch events in an emulated phone viewport, including a complete lap and retry, cancellation, pointer capture, secondary touches, Space/touch interaction, no local scrolling/zoom/selection and focus cleanup. It also retains desktop keyboard and cross-runtime replay checks.

These are scripted tests, not physical-phone or newcomer observations. Issue #4 remains open until real users can explain and complete the mechanic, and an actual phone is checked inside Reddit for input response and accidental feed scrolling. Broader five-person playtesting and device performance remain #25 and #24 respectively.
