# Sound and motion settings

The expanded scene owns one `createFeedbackPreferences()` and one lazy `createDrivingAudio(...)`. The feed teaser imports neither. Sound and Motion live in a native, initially collapsed Settings disclosure; starting or retrying closes it. They are utility settings; holding the canvas or Space remains the only driving input. Space on a focused setting keeps its native action and never holds the accelerator. Safe key release still clears driving input.

## Activation and lifecycle

Start, Retry and an explicit unmute call `unlockFromGesture()` synchronously before authentication or other asynchronous work. Driving never waits for audio. A saved mute preference avoids creating an AudioContext. A suspended, rejected, unavailable or interrupted audio device remains silent and does not change ranked eligibility or prevent practice.

One reusable graph has 12 nodes, four started sources and one locally generated one-second noise buffer. Two engine oscillators follow bounded speed/acceleration; filtered noise follows authoritative slip and off-road movement. A recovery-count edge can play one restrained cue. The neutral finish cue means local lap completion, not server verification, a record or a win. There is no invented barrier-collision event, camera shake, microphone access or sound download.

Continuous parameter writes are coalesced to at most 30 Hz of the audio clock. Mute/background/reset gates bypass that delay. A bounded activation deadline, attempt generation and actual context state protect late resume replies. Background/blur/pagehide silence immediately; returning to the page does not restore sound without another gesture. The finish cue uses the existing graph and suspends after 300 ms; Retry cancels that old timer. True scene teardown removes listeners/timers, stops and disconnects sources, and closes the context once.

`data-audio-state` mirrors actual controller activation state separately from the Sound preference. The accessible status reports unavailable sound honestly. A running context establishes browser processing, not speaker audibility. Page-clock acceleration does not advance the hardware audio clock.

## Motion and storage

Motion defaults to the device's reduced-motion setting. Explicit Reduced and Full overrides remain independent of Sound. Reduced motion immediately clears/suppresses smoke, dust and skid marks and neutralizes body pitch/roll, while preserving essential fixed-north camera fitting, car movement, wheel direction and brake lamps. See [pooled effects](driving-effects.md) for fixed limits and continuity gates.

Preferences use a small validated, versioned local value. Malformed, unavailable or blocked storage falls back in memory without preventing play. Only actual preference changes are written. One media-query listener and one scene subscription are reused through retries and removed on teardown. Settings never mutate a simulation state, replay, immutable challenge or score.

The result card and camera use measured HUD/footer insets. Settings opens a bounded, scrollable overlay above its small disclosure target, so opening it does not zoom the road or displace the race layout. Settings have 44px minimum targets, keyboard focus and accessible names.

## Verification boundaries

Node tests cover bounded targets, 20-attempt reuse, activation rejection/pending/late replies, foreground/mute gates, closed-device replacement, finish/update ordering, retry timer cancellation, recovery deduplication, preference/storage/system changes, listener disposal and unchanged authoritative replay outcomes. The same production graph is rendered through OfflineAudioContext to check a nonzero bounded signal, higher engine pitch at higher speed and an exactly silent muted tail. Native trusted button gestures exercise the public production audio owner in Chromium, emulated mobile Chromium and a narrow WebKit project under ordinary autoplay policy.

The audio and VFX browser fixtures are explicitly labelled synthetic presentation inputs. They do not create a race, score, fake authentication or invented competitors. Separate real-game cases cover setting/input isolation, unavailable audio with actual short driving and small-screen access; the existing complete generated-lap/replay regression remains in place. Physical Android/iOS audibility, silent-mode/output routing, interruptions, latency and comfort remain unproved until a real device is observed. Local API state, offline samples and Reddit owner preview cannot supply those observations.
