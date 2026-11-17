# Seed track sharing

The visible UI calls named courses **seeds**. The internal `word-v2:` namespace,
normalization rules and old `?practice=1&word=...` links are unchanged.
`?practice=1&courseSeed=...` is also supported. Plain seeds select the current
generator, not historical geometry.

In Other tracks, open Choose a seed and select Share track. The official Devvit
`showShareSheet` receives a compact JSON descriptor: type, schema version,
current generator version, normalized seed and canonical SHA-256 track hash.
No identity, score or ranked authorization is shared. The host owns the share URL
and destination. Resolving the effect does not prove anyone copied or sent it;
the UI only says to choose where to share. Copy seed separately confirms a
successful clipboard write, or displays the seed for manual copying.

Incoming `getShareData()` always takes precedence over daily/query selection.
It is treated as untrusted, limited to 1024 characters, strictly parsed and
regenerated as **practice only**. Unsupported versions, invalid seeds, missing
hashing capability and geometry mismatches block Start before scene creation.
They do not silently substitute a reference, reserve or daily course. Deterministic
reserve geometry is acceptable only if it matches the descriptor's exact hash.

Splash reads the native payload on expansion and stores a short-lived,
post-scoped sessionStorage bridge. Expanded mode prefers native data and consumes
the bridge once if needed. Storage is optional; supported hosts pass their share
data directly. Invalid native payloads are rejected at both entry points.

A copied plain seed is intentionally a fallback, not an immutable/versioned
share link; the UI states that the recipient should use the same game version.
Legacy developer-only raw seed fixtures do not offer share controls, since they
aren't reproducible by the player-facing seed generator.

SDK reference: https://developers.reddit.com/docs/guides/logged-out-users

Tests cover official effect payload shape, exact-course roundtrip, splash handoff,
malformed/version/hash failures, no ranked calls, clipboard success/denial and
unavailable Web Crypto. Browser tests simulate host effects, not a real Reddit
native share destination or off-platform link delivery.
