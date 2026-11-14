# Countdown and lap audio

The production scene sends countdown values to the existing lazy Web Audio owner. It plays one short 440 Hz beep for each of 3, 2 and 1, then a longer 880 Hz GO beep. Repeated presentation frames do not repeat cues. A fresh attempt resets the sequence.

Continuous practice laps use a short 660/880 Hz chime without stopping engine audio or pausing driving. Ranked finishes use the same chime, retaining the existing finish suspension. The same fixed 12-node synthesis graph is reused: no downloaded assets, extra contexts, timers for lap cues, or dependencies.

Sound-off, background/abandon, stale attempt and browser gesture rules still apply. Muted lap/countdown events are not queued for unmute. This change does not modify physics, race timing, minimap progress or the existing last-lap display.

Validation on UoA Mac: TypeScript and ESLint passed; 17 driving-audio unit tests passed; six desktop/mobile Chromium audio lifecycle/offline synthesis tests passed. These verify activation, bounded signal, distinct cue pitch and silent tails, not physical phone speaker audibility or subjective loudness. No hosted build was uploaded.

## Countdown audibility follow-up

The installed-source default/practice flows were instrumented at the real Web Audio oscillator: native desktop click and emulated-mobile tap scheduled 440/440/440/880 Hz cues and reached `running`; saved mute emitted none. The report of missing sound on the owner's physical device was **not reproduced**, and its cause is not established. Original sine beep output peaked at only 0.028 (about -31 dBFS), so this patch raises only countdown/GO gain by 7 dB and uses a gentle triangle wave for phone-speaker harmonics. Engine, lap, recovery and mute levels/behavior stay unchanged. Offline synthesis tests require bounded cue output and silence afterward.

Production-flow regression coverage now exercises both the default local entry and generated practice entry, saved sound-on/off, and native click/tap. The race clock is controlled after assets load: an earlier real-time desktop run abandoned due to the existing frame-stall guard, not an audio assertion. This is functional regression evidence, not device performance or a hosted playback test. Hosted Reddit iframe permissions, actual handset output and the owner's saved setting still need observation to identify their original failure conclusively.
