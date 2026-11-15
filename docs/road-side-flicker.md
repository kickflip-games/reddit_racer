# Ramp side flicker

The elevated (schema 2) renderer drew two different meshes on the same outside
road plane: brown ground-to-deck jump walls and gray elevated-road fascia.
The jump wall also used only the ramp endpoints, while the deck/fascia followed
the intermediate elevation samples. Small camera changes exposed competing
brown/gray fragments and wedge-shaped patches. This was a geometry ownership
error, not a reason to weaken depth testing or increase depth bias globally.

Schema 2 now builds each side segment once from the same canonical road samples.
Ramp segments extend to ground with the existing brown color; ordinary raised
sections retain shallow gray fascia. The actual airborne gap remains open.
Legacy schema 1 retains its wall path. End-cap boxes are inset 0.02 m on each
side, avoiding another coincident face at the ramp lip. Road samples, physical
surface, jumps, collision and timing are unchanged.

Validation includes unique side-triangle checks, no second brown wall owner,
inset caps, existing open-gap checks and canonical-track immutability tests.
A local Chromium renderer fixture captured three nearby camera poses at desktop
and mobile viewport sizes before/after: the old gray/brown patches visibly
resolve to a single clean brown side. These are rendered stills, not recordings
or a claim of testing on the reporter's exact Android GPU.
