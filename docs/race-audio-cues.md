# Countdown and lap audio

The production scene sends countdown values to the existing lazy Web Audio owner. It plays one short 440 Hz beep for each of 3, 2 and 1, then a longer 880 Hz GO beep. Repeated presentation frames do not repeat cues. A fresh attempt resets the sequence.

Continuous practice laps use a short 660/880 Hz chime without stopping engine audio or pausing driving. Ranked finishes use the same chime, retaining the existing finish suspension. The same fixed 12-node synthesis graph is reused: no downloaded assets, extra contexts, timers for lap cues, or dependencies.

Sound-off, background/abandon, stale attempt and browser gesture rules still apply. Muted lap/countdown events are not queued for unmute. This change does not modify physics, race timing, minimap progress or the existing last-lap display.

Validation on UoA Mac: TypeScript and ESLint passed; 17 driving-audio unit tests passed; six desktop/mobile Chromium audio lifecycle/offline synthesis tests passed. These verify activation, bounded signal, distinct cue pitch and silent tails, not physical phone speaker audibility or subjective loudness. No hosted build was uploaded.
