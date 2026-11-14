# Countryside circuits, jumps and bridges

Main daily and practice maps now use the same seeded generator, consistent road material/grip and predictable centreline driving. Some courses feature open gap jumps; others include a grade-separated overpass. The camera follows without rotating. See [the current design, rendered evidence and runtime rules](predictable-routes.md).

Choose **Practice** to drive continuous laps, then **New track** in Settings for another generated circuit. The local default and `?seed=...` selector use the main generator; `?practice=1&seed=country-1` reproduces an opening gap and `?practice=1&seed=country-0` reproduces an overpass. Developer selectors never replace a Reddit post's authoritative course.

```sh
npm run dev:local
npm run tracks:check -- --elevated --prefix elevated-regression --report /tmp/countryside-quality.json
```

Generation remains bounded to 32 structural candidates and eight requested quality searches, then one validated procedural reserve. Every accepted course must have useful braking opportunities and a replay-verified fast route. The 200-course gate rejects excessive reserve reuse and insufficient shape variety. The [current report](evidence/predictable-routes/quality.json) includes the actual feature mix.

The earlier `flow-loop-v2` release and private `0.0.14`/`0.0.15` observations are historical: [original report](https://github.com/kickflip-games/reddit_racer/blob/190797ef4ab3d8bb85797f8f4d70714800623ba8/docs/elevated-circuits.md), [saved evidence](evidence/elevated-circuits/validation.json). Those measurements describe the former rotating-camera, lateral-drift rules and do not establish the current build's behaviour.
