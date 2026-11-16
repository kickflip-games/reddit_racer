# Other tracks v2: authored brake-rhythm geometry

The geometry API is `generateBrakeRhythmCandidate(seed, attempt, overrides)`.
It returns a schema-2 flat track, measured structural assessment, exact motif
intervals, endpoint tangents, difficulty labels and configuration. It is a
**candidate**, not a quality-approved course. The separate real-physics wrapper
must accept it before public use. Daily, legacy seeds and word-v1 are untouched.

A bounded, deterministic family composes a long approach, a memorable single
or double hairpin, recovery, flowing S bends, technical switchbacks or tightening
corners, and fast gentle sweepers. Not every course packs in every motif:
double-hairpin courses omit the other technical detours; paired tightening
corners replace the chicane/switchback. The current layout family is a rounded
rectangular loop with outward detours, not unlimited arbitrary circuit topology.

All local pieces have declared endpoint tangents. Numerically integrated
curvature ramps are normalized to the exact intended turning angle, avoiding
cumulative closure drift. Opposite straight lengths and opposing corner pieces
close the route without a spline that could erase the authored motif. Existing
road-width, radius, clearance, intersection and canonical-data checks still run.
No physics, input, camera, replay or existing generator behavior is modified.

## Controls and configuration

`createBrakeMotif(kind, overrides)` supports the seven named corner motifs plus
straight/recovery. Radius, approach/recovery lengths and curvature-transition
length are configurable and bounded. `generateFixedBrakeMotifCourse(kind)`
creates a deterministic isolated test course with neutral straight/gentle-sweeper
closure. Tightening-corner tests repeat that corner to close the loop. These are
diagnostic controls, not automatically approved production courses.

The final gentle sweeper radius is 90–100 m and flowing S turns are 12 degrees.
Hairpins use 14–18 m radius, entry bends 28–36 m, tightening bends 24–30 m,
and chicane/switchback bends 18–23 m. Nominal radius is not claimed identical to
resampled minimum radius; tests inspect actual canonical geometry.

## Evidence and limitations

One hundred consecutive `word-v2:evaluation-N` seeds pass structural tests.
Seven isolated motifs pass structural checks. Tests assert smooth tangents,
finite bounded increments, endpoint closure, schema-2 semantics, deterministic
generation and frozen banana/tui/river candidate geometry hashes. The existing
v1 golden tests also pass unchanged.

Real-physics validation is recorded by the companion braking report/wrapper.
The fixed chicane produced **zero measured brake-timing gain** in the tested
search; it is labelled easy flow variation, not sold as a braking challenge.
The final longer switchback did produce a timing benefit. Flowing S bends and
gentle sweepers are intentionally flat-out controls, not compulsory braking.

Rejected development iterations matter: putting all motifs and tight closing
corners on every lap exceeded the off-road quality target. Widening every curve
then created some overly long laps. The final family reduces the number of
difficult decisions instead of relaxing quality thresholds. A raw candidate can
still fail the real-physics wrapper. Geometry-only passes do not establish
playability, optimal braking, or human enjoyment.
