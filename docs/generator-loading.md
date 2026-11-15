# Other tracks module loading

A hosted client reported a failed fetch of `other-tracks-generator.js` after
selecting Other tracks. The deployed file subsequently returned HTTP 200 and the
hosted word course worked when checked again. This does not establish the
original network/CDN/client root cause or prove that the file was missing.

The production build previously emitted a tiny dynamically imported wrapper.
Selecting Other tracks required another module request after the game was
already ready. A failed dynamic module load can continue failing in the same
page. The word generator is now a static dependency of the game entry graph,
so a ready game no longer needs that click-time network request. Generated
courses, version codes, legacy seeds and ranked data are unchanged. This is
not a general offline guarantee; initial game/assets/backend requests still
need the network.

Measured on this revision: game.js increased from 801,505 to 829,423 raw bytes
(+27,918). The separate other-tracks/elevated generator chunks are absent after
build; shared generator code is included once rather than fetched on demand.

Run `npm run test:production` for the built-asset smoke, separate from Vite dev
browser tests. It serves dist/client on loopback only, makes the former module
URL unavailable, starts the normal fallback race then clicks Other tracks,
checks word generation/reproducibility and invalid-code recovery on desktop
and mobile. The same regression failed against the previous production build
at the Other tracks click, then passed after this change. A mocked unavailable
Reddit backend lets this local production test run without an installation or
any external submissions.
