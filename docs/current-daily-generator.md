# One current course generator for new daily races

New server-side daily creation and free driving use the braking-course generator.
The daily storage adapter calls the same bounded 32-candidate, 12-quality-assessment gate.
If primary generation fails, the service uses a fixed seed
(`current-course-reserve`) through **that same generator and the same gates**.
There is no older elevated-generator fallback or unsafe final-candidate bypass.
If both fail, the daily remains unavailable rather than publishing unapproved
geometry.

Existing daily records are immutable. Reads deserialize their saved geometry,
simulation identity and quality provenance; they never regenerate a course.
The logical daily key and race-storage namespace are unchanged. A deployment
therefore cannot replace a current day's route or invalidate its leaderboard.
New future days receive the current generator. Historical format readers are
data compatibility, not alternate selectable generation modes.

The storage adapter declares the current geometry bounds (7 m width,
540–900 m length, 10 m minimum radius, 2 m clearance, 0.8 m shoulder,
32 candidates and 12 quality assessments). It rejects modified audit settings. Record creation reruns
quality assessment against copied geometry using the exact saved thresholds,
including 0.75 s minimum braking gain and at most 15% fast-policy off-road time.
Audit work counters include actual accumulated candidate assessments and the
record-creation revalidation. No invented controller counts or stale metrics
are substituted. On reserve use the existing generatorFallback flag is set;
audit counters describe the reserve generation and revalidation, not a failed
primary call whose exception returned no diagnostic object.

## Verified locally

- Already-stored daily remained byte-identical, with zero generator calls.
- The next day's route used the current generator and strict quality thresholds.
- An injected primary failure used the same current generator's validated reserve.
- Forged audit radius was rejected.
- Existing concurrency, immutable binding, corruption and unavailable tests passed.

Timing probe on UoA Mac: a three-attempt primary seed took 1.089 s
(198 controller runs, 1,316,636 simulation ticks, 9 replay checks).
The fixed reserve took 0.299 s (66 controller runs, 385,863 ticks, 3 checks).
The primary in this probe **passed**; the sum is a deliberately measured
primary-plus-reserve cost scenario, not a claim of an observed fallback.
Record creation additionally performs an independent quality revalidation.
These are local measurements, not Reddit server latency guarantees.

The current candidate uses four course families, taller terrain and selected real
gap jumps. See [Daily course families](daily-course-variety.md) for the versioned
acceptance changes, loopback scope and reproduction commands.
