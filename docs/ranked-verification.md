# Authenticated replay verification

Issue #10 adds bounded authenticated race sessions and authoritative input verification. The shared simulator and immutable daily records determine finishing time. A browser cannot choose a user, course, starting state, runtime version or submitted score.

The core is `src/server/core/ranked-races.ts`; platform storage, clock, account/post context, secure ID generation, request allowances and final commit are injected. `src/shared/ranked-race.ts` defines strict public request/response parsing and canonical replay fingerprints. Neither module contains an identity bypass for local development.

## Public protocol

`startRankedRace()` accepts no input. The server obtains the Reddit user, installation/subreddit and originating post from trusted request context, consumes a start allowance, loads the post-bound immutable daily challenge, then captures the admission time and checks its UTC window again. A request that crosses midnight while loading cannot start a new ranked session on yesterday's course.

The response contains `sessionId`, `challengeId`, `challengeHash`, `trackHash`, `simulationVersion`, `handlingVersion`, `expiresAtMs` and `serverNowMs`. The client must compare the response with the already loaded immutable challenge before beginning its countdown. Every retry requests a fresh session.

`submitRun()` accepts exactly:

```text
{ sessionId, replay }
```

Replay is the bounded Boolean input-transition schema. A supplied lap time, user, track, date, position or other extra field is rejected. Session IDs are secure UUID v4 values. A verified response contains `sessionId`, `challengeId`, `challengeHash`, `finishTicks`, `simulationHz: 120`, derived `finishTimeMs` and `verifiedAtMs`. It does not claim a leaderboard rank or personal best; those come from the separate [atomic competition storage and results query](leaderboard.md).

The replay limits remain 14,400 ticks (120 seconds) and 2,400 ordered, nonredundant Boolean transitions. Raw request size and per-account request allowances are additional transport/platform controls, not substitutes for these schema/work bounds. Logged-out users may explicitly practise without invoking an insecure ranked identity.

The Hono adapter caps request bodies at 128 KiB, rejects tRPC batching, and permits mutations only through POST. Per authenticated account/subreddit, starts and expensive verifications each have a separate allowance of 12 per server minute. Atomic Redis increments enforce concurrent requests; NX initialization installs an absolute expiration before incrementing, one extra minute beyond the active bucket. These limits leave normal 20–40-second races unrestricted. Already accepted identical receipts do not repeat simulation or consume another verification allowance. Storage/allowance failures fail closed for verification while practice remains available.

## Session identity and expiry

A private session stores its authenticated user, subreddit and originating post; immutable challenge day/ID/hashes; simulation/handling versions and tick rate; and admitted start/expiry timestamps. A guessed or borrowed session does not authorize another account or post.

Expiry is the daily policy from issue #9:

```text
min(admitted start + 5 minutes, challenge UTC end + 3 minutes)
```

Starts are permitted only inside the challenge's UTC day. A pre-midnight session may finish during its bounded grace period and remains bound to its original challenge. Submission loads that original day from storage, never the current day's course. New starts on an archived post remain practice.

The service checks expiry before expensive verification, after allowance processing, after replay execution and immediately before proposing a commit. The committed winning receipt must show verification strictly before session expiry. If persistence latency crosses the deadline after a valid proposal, the already accepted atomic receipt remains accepted; no score/receipt rollback is attempted.

Session metadata is retained until `expiresAtMs + 10 minutes`. This retention is not additional playing time. Expired sessions without an accepted receipt cannot submit again.

## Verification and immutable rules

Before simulation, the server revalidates the stored challenge's schema, geometry/hash and supported runtime. Session ID/hash/track hash/runtime must agree exactly with that stored challenge. It replays inputs through `runReplay()` and the production shared race rules, including checkpoints, legal progress and recovery. Incomplete, invalid or mismatched runs cannot create a receipt.

Authoritative integer ticks determine the result. `finishTimeMs = finishTicks × 1000 / 120` is a derived display value. No direct browser timing or score is used. Verification demonstrates a game-rule-compliant input tape; it does not prove human play, prevent assisted/bot input or require a tape to have been generated in real time.

The retained `fixed-step-v2 / arcade-v1` runtime and its golden fixtures are unchanged. Future version dispatch must retain compatible physics, race rules **and submission parsing/fingerprint normalization**. The current parser accepts the current replay version; a future deployment must not drop an old supported parser while its sessions/receipts remain live. Unknown rules fail closed instead of being reinterpreted under new handling.

## Idempotent receipts

A replay fingerprint is SHA-256 over fixed-order validated replay fields and transitions. Object insertion order or transport formatting does not change it; sampled input changes do.

Submission checks for an existing private receipt before loading session metadata or consuming another verification allowance. Its owner/subreddit/post must match. The same fingerprint returns the original authoritative response unchanged; a different fingerprint for that consumed session conflicts, even if it would produce the same time.

A receipt embeds the private immutable session snapshot, fingerprint and public response. It remains owner-checkable if standalone session metadata is missing. Receipts are retained until `verifiedAtMs + 10 minutes`. Within that window a same-payload retry can recover an accepted result after session expiry without replaying or spending another expensive verification allowance. After receipt deletion, the expired session cannot produce a second commit, even while its longer-lived metadata remains.

The stable keys are:

```text
racer:session:<subredditId>:<sessionId>
racer:receipt:<subredditId>:<sessionId>
```

`RankedStore.setNX(key, value, expiresAtMs)` must atomically reserve an expiring value. The default `createNxReceiptCommitter()` writes only if absent, then always reads/parses the stored winner. It never returns an unconfirmed local result. Concurrent identical submissions receive one stored receipt; concurrent different valid tapes leave one winner and a conflict for the loser. Failed verification or an unconfirmed persistence operation does not introduce a separate consumed-session flag.

## Atomic competition commitment

`commitVerified({ session, replayFingerprint, response })` is a required injected boundary. It returns the persisted private receipt, which the core checks against its immutable session, fingerprint and calculated time.

Production injects the [competition service](leaderboard.md) at this boundary. It commits the receipt, personal best, sorted score and original improvement outcome together using the supported Redis concurrency primitives. The original NX-only committer remains for isolated verification controls. Never consume a receipt and then separately update a leaderboard: a failure between those writes could accept a run without recording its best score. The receipt itself defines consumption; there is no earlier mutable consumed flag. Retained pre-leaderboard receipts can be adopted by an owner-checked results query without changing their verified response or extending retention.

## Validation and integration status

Platform-free tests use a faithful atomic expiring store and actual shared replay execution. They cover account/post/scope ownership, strict forged/oversized inputs, canonical fingerprints, session/receipt retention, same/different-payload concurrency, failed commit/read-back retry, expiry at verification/commit boundaries, midnight loading, old-challenge pinning, rule/hash mismatch, request allowance hooks and bounded UUID collision handling.

API tests exercise the real Hono/tRPC path with injected service dependencies. Browser tests verify session preparation, immutable challenge matching, finish submission, errors and retry separately. These mocks do not prove the hosted Reddit authenticated identity path. On 2026-11-12, the owner-only `0.0.6` build completed real authenticated Reddit runs, a full post reload and slower-retry PB preservation; [hosted playtest evidence](hosted-playtest.md) records the account, exact source, post, observations and screenshots. #10 closed after the competition integration merged. #20 still tracks remaining hosted conditions and final UI; public publishing remains unauthorized.
