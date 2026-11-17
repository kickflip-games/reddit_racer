# Road-only finish / grass resistance v7

New `linked-circuits-v2` courses use `fixed-step-v7` / `road-finish-v1`
and quality policy `linked-quality-v2`. Existing stored daily challenges keep
their canonical track, hash, simulation and accepted results. In particular,
`linked-circuits-v1` remains on v6 and `linked-quality-v1`; v2/v4/v5 runtimes
are untouched. Do not reset or relabel the active daily leaderboard on upgrade.

The regression reproduces a v6 off-road finish directly through the shared
simulation: distance alone used to complete a lap. v7 requires the car centre
inside the road cross-section and on the surface. An off-road crossing remains
just before the line until the car rejoins, so it is never permanently missed.
Brief earlier excursions do not invalidate a lap or add a fixed penalty.

Grass drag rises smoothly over the first metre beyond the road edge (coefficient
3 rather than 1.25); throttle remains available to recover. Grounded longitudinal
gravity uses the authored grade even off the deck: grass cannot avoid an uphill
resistance term while retaining the same centreline progress. This is an arcade
fairness convention rather than a full free-driving terrain model.

The regression establishes the finish defect, not that every possible grass
line on every historical circuit was faster. Existing frozen daily challenges
still obey their old rules. Newly generated practice courses and newly created
daily records get the fix; future records already frozen before upgrade also
remain unchanged. Stored records and scores are not deleted.

The practice-only drift hook is supported in v7. Integration must route
PracticeDriver to this function for linked-circuits-v2, not the retained v6
function, or drifting would bypass the finish gate.
