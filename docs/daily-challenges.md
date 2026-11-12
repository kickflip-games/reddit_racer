# Immutable UTC daily challenges

`src/server/core/daily-challenges.ts` owns challenge persistence and permanent post binding. Redis, Reddit post lookup, clock and course factories are injected; the core imports no Devvit platform module. `src/shared/daily-challenge.ts` defines validated storage/public schemas, hashes, UTC helpers and the ranked-session timing policy.

## Stored record and public view

A stored record contains the complete accepted canonical road, its SHA-256, a challenge hash, UTC day/window, installation/subreddit identity, generator and quality provenance, simulation/handling versions, tick rate and exact stationary initial conditions. It also retains immutable generator configuration, quality thresholds, creation time, requested seed and a compact internal audit of acceptance metrics/rejection codes/work counts. It does not store authentication credentials.

The public `DailyChallengeView` contains:

- `challenge`: full playable track, track/challenge hashes, UTC identity/window, provenance/runtime versions and initial conditions.
- `serverNowMs`, `currentDay`, `nextResetAtMs`: server-derived UTC display context.
- `isCurrent`, `rankedWindowOpen`: whether this post's challenge belongs to the current UTC window.

`rankedWindowOpen` is temporal eligibility only. [Authenticated sessions and replay verification](ranked-verification.md) check it against the server clock; this field alone does not grant ranking or create a score. Old challenges remain available as clearly labelled practice.

`toPublicDailyChallenge()` explicitly enumerates public fields. Internal configuration, audit, solver transitions and controller search tapes are absent from the DTO. `parseDailyChallengeView()` validates both immutable challenge data and the view's UTC flags, preventing a mismatched date/reset indicator from being accepted as authoritative.

The track hash covers fixed-order canonical track JSON. The challenge hash covers public immutable race conditions plus that track hash: identity/window, versions, tick rate and initial conditions. Parsing recomputes the actual track hash and then the challenge hash. Private audit/configuration do not determine a submitted score and are excluded from the public scored hash; they remain immutable through the storage protocol.

## Creation and atomic winner

Logical Redis keys are stable across deployments:

```text
racer:daily:<subredditId>:<YYYY-MM-DD>  hash field: record
racer:posts:<subredditId>              hash field: postId
```

Code/schema/generator versions belong in record payloads. Changing a key prefix with a deployment could otherwise fork today's challenge and is prohibited without an explicit migration design.

For `getOrCreate({ subredditId, day })`, the service:

1. Reads and validates any existing record. Existing malformed or unsupported data is an error, never permission to regenerate.
2. If absent, asks the bounded validated generator for the day seed and copies its canonical track.
3. Reassesses that exact copied road under the supplied resolved configuration and current quality policy. This binds approval to geometry rather than trusting stale or mismatched caller metadata.
4. Constructs hashes and the full immutable record.
5. Writes using Redis `hSetNX(key, 'record', serializedRecord)`.
6. **Always rereads and validates the persisted winner**, including after a successful numeric write response.

Concurrent cold requests may each perform bounded generation. Exactly one accepted value is persisted, and every successful caller receives that value, including a losing writer whose locally generated road differed. The implementation does not claim only one generator invocation across cold processes. It avoids an expiring-claim protocol that could leave a day permanently locked after a crash.

Creation-time reassessment adds at most one further bounded quality assessment for each proposed record, up to 66 controller trajectories and three replay checks (993,600 authoritative ticks). It never runs on stored reads or every race frame. If normal generation/approval fails, one separately quality-approved reserve may be used and is marked in internal audit. If both factories fail, storage is not written. Storage/read-back failures do not trigger an unconfirmed local replacement.

No TTL is set on challenge records or post bindings by this service. Historic geometry remains available for old posts. Retention/archival changes must preserve post identity, recorded courses and historical score interpretation rather than silently replacing them.

## Original post binding

`bindPost({ subredditId, postId })` first checks the permanent binding. For an unbound post, it fetches trusted Reddit metadata and verifies the post ID and subreddit against the server context. Its day is derived only from `Post.createdAt` converted to a UTC timestamp. Client dates, URL parameters, local timezone and first-load current day cannot select it.

Binding also uses `hSetNX` followed by read-back. A stored binding must agree with its own trusted creation timestamp and logical post/scope key. Existing bindings remain authoritative without a fresh Reddit lookup, even after a deployment or when an old post is opened months later.

If a post predates this feature and has no record/binding, first access may initialize a course for its original creation day using the current accepted generator. The result is fixed thereafter and is archive practice, not a claim that this exact course existed before initialization. It never silently becomes today's challenge. If trusted metadata is unavailable, the service fails instead of guessing a day.

A generation request crossing UTC midnight retains its originating post day. The response recomputes current eligibility from server time after loading, so a newly loaded previous-day challenge can immediately show archive practice without changing its road.

## Version compatibility and deployments

Stored reads validate the record/track schema, hashes and supported scored runtime. Generator/quality identifiers are provenance: an already stored canonical track does not require rerunning its historical generator or quality controller.

The currently retained scored tuple is `fixed-step-v2 / arcade-v1 / 120 Hz`, with stationary zero-progress initial conditions. The parser checks both the stored tuple **and the active runtime exports** against that retained tuple. Changing a constant alone therefore fails closed instead of allowing a v2 challenge to run under different active rules. Existing golden physics fixtures additionally detect accidental same-version outcome changes.

When handling is tuned in issue #25, retain the old version-specific simulation/race/replay implementation and add explicit runtime dispatch before enabling another tuple. A compatibility label pointing to mutable current functions is insufficient. Unknown schema, unsupported runtime, invalid initial conditions, malformed geometry or hash mismatch must not overwrite the original record. Public API mapping treats integrity/runtime failures as a precondition failure, separate from temporary service outages.

## Midnight and ranked sessions

All windows use server UTC calendar days, independent of player timezone or daylight saving. The shared policy helper `rankedSessionExpiresAt(challenge, startedAtMs)` permits starts only within `[startsAtMs, endsAtMs)` and returns:

```text
min(startedAtMs + 5 minutes, endsAtMs + 3 minutes)
```

Sessions pin the challenge ID/hash, runtime versions and authenticated account at start. A pre-midnight session may finish against its original challenge until that bounded expiry. Starting after midnight on an old post is practice. [Ranked verification](ranked-verification.md) implements persistence and authoritative replay; [leaderboard storage](leaderboard.md) commits personal bests and retains results for 90 days while course geometry remains available.

The client can display reset time using `serverNowMs` plus monotonic elapsed time. That display never determines the authoritative day, track or lap time.

## Validation

The platform-free unit store performs its `hSetNX` check-and-set in one synchronous critical section. It does not place an asynchronous yield between checking and setting, which would create an inaccurate fake. Controlled concurrent generation proves that a losing writer returns a different persisted winner.

Tests cover persisted JSON/hash normal form, private-field exclusion, concurrent writes/read-back, generator deployment immunity, original-day post binding, metadata outages and wrong scope, midnight during generation, timezone offsets/leap dates, session grace, approved reserve/failure, stale track approval, corrupt/unsupported record preservation and missing write confirmation. Historical generator/quality provenance remains readable under the supported scored runtime.

Separate API/browser tests exercise the actual Hono/tRPC adapter, post-context-only selection, integrity failures, daily/archive display and the loaded immutable road. Hosted Reddit identity, private test-post ranking and physical phone observations remain separately recorded integration evidence; local mocks do not establish those results.
