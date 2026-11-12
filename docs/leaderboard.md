# Daily competition and atomic personal bests

Issue #11 records one verified personal best per Reddit account and immutable daily challenge. The public `VerifiedRunResponse` and private verification receipt keep their issue #10 schema. A separate competition outcome records whether that accepted attempt improved the player's previous best.

`src/server/core/competition.ts` has no Devvit dependency. It receives trusted account/post context, the immutable daily service, clock, username lookup and a narrow compare-and-swap store. `src/server/competition-store.ts` implements the store with the installed Redis SDK. The production ranked verifier injects `commitVerified` from the competition service after actual shared replay verification. The competition boundary does not accept a browser score or independently prove physics; only the verifier calls it with an authoritative receipt proposal.

## Post-bound reads and public response

`getLeaderboard({ sessionId? })` accepts no day, track, account, subreddit or score. It loads the originating post's permanent daily binding, including on archived posts. Public top results can be read while signed out. Supplying `sessionId` requires the authenticated owner and the same originating post, installation and immutable challenge as the private receipt.

The strict `LeaderboardView` contains the immutable challenge ID/hash/day, 120 Hz display conversion, server time, result-retention deadline, `status`, `viewer`, top twenty rows, the player's row, up to seven nearby racers and an optional attempt outcome. Signed-out responses contain no player row, nearby window or outcome. A signed-in player without a recorded best has `me: null`. Expired results use `status: 'expired'` and empty standings, independently of authentication.

Rows expose a trusted Reddit username, authoritative integer `finishTicks`, competition `rank` and `isSelf`. User IDs, replay tapes and private receipt data are absent from the public response. Missing or malformed stored usernames fail closed; there are no invented racers or fallback names.

The outcome contains `sessionId`, `previousBestTicks`, `personalBestTicks`, `isPersonalBest` and `improvementTicks`. The first record has a null previous best and null improvement. A strictly faster attempt reports the exact positive tick difference; equal and slower attempts report no new record and zero improvement. The outcome is the immutable snapshot for that attempt. Another device can subsequently improve the current `me` row without changing the earlier outcome. Rank is read from current standings and is never frozen into a verification receipt.

## Atomic write and concurrency contract

Stable keys are scoped by subreddit installation:

```text
racer:leaderboard:<subredditId>:<UTC day>
racer:pb:<subredditId>:<UTC day>:<userId>
racer:board-revision:<subredditId>:<UTC day>
racer:receipt:<subredditId>:<sessionId>
racer:outcome:<subredditId>:<sessionId>
```

The sorted-set member is the authenticated user ID and its score is integer simulation ticks. Each personal-best record carries its trusted username and the complete verified receipt proving that minimum. A competition outcome carries the original receipt and the personal-best proof for its snapshot. Neither record trusts a separately submitted lap time.

`CompetitionStore.compareAndSwap` receives exact expected raw values for the player's PB, the session receipt and outcome. The Redis adapter watches those three keys, compares their ordinary reads after `WATCH`, checks key types, the current own sorted-set score and revision-counter validity, and queues one transaction. It writes PB proof before the receipt/outcome, updates the sorted-set member when needed, and increments the board revision for a score/proof change. It does not watch the entire board, so unrelated racers do not invalidate each other's transactions.

The service retries at most five comparisons. A faster/slower completion race rereads the winning PB before retrying; only the minimum proven time can be written. Equal times do not replace a PB. Same-session duplicates keep the original receipt bytes and verification timestamp; a different replay fingerprint for that session conflicts. There is no separate consumed-session flag and no receipt-first/PB-later success path.

The adapter confirms only complete successful reply shapes and persisted read-back of records, score, counters and deadlines. An empty, short, malformed or lost transaction reply is unconfirmed. Redis transactions do not roll back command runtime errors, so the core rereads the PB, score, receipt and outcome after an unconfirmed write. Receipt/outcome presence alone is insufficient to acknowledge competition storage.

Reconciliation preserves the lowest observed score and uses an actual verified receipt as proof. It can repair a missing PB, score, receipt or outcome from matching retained proofs, and confirms a fresh revision transaction after an ambiguous reply. A stored lower score with no matching verified proof is preserved and returns unavailable instead of being overwritten with a slower candidate or being given fabricated metadata. Wrong key types and corrupt records also fail closed. Within one retrying call, an identifiable partial write preserves that call's original improvement snapshot. These repairs recover the explicit supported partial-write cases; they do not claim to repair arbitrary external database corruption or prove hosted transaction semantics.

## Consistent standings and ties

Scores sort ascending. Equal scores use Redis's deterministic lexical user-ID ordering for row order and competition ranks such as `1, 1, 3`. Top ranks derive from their raw indices. The nearby window centres on the player's raw index where possible and remains up to seven rows near either end. If its first row is in the middle of a tie, one first-at-score lookup and global index recover that tie's true rank; later groups derive ranks from known raw indices.

Every read takes a revision before and after the score/profile reads. A changed revision retries the entire snapshot, at most three times. A stable score/profile mismatch returns unavailable instead of mixing rows from different versions. At most twenty top rows plus thirteen surrounding candidates are read; the final nearby window has seven. Distinct PB profile reads are batched in groups of at most eight. No polling or unbounded scan is required.

## Retention and deployment compatibility

PB records, sorted sets and revision counters expire at the challenge's UTC end plus ninety days. The response reports that exact absolute deadline and switches to explicit expired standings at the boundary, including a read that crosses it. Full immutable tracks and permanent post bindings are retained separately, so an old post can still provide practice after results expire.

Receipts and per-session outcomes retain issue #10's ten-minute deadline from the original `verifiedAtMs`. Adoption, retries and queries never extend a retained receipt or outcome. Session admission/expiry and midnight grace remain the issue #10 policy. Board reads always use the post's original day; a session finishing after midnight within its grace period still competes on its pinned challenge.

For an owned retained issue #10 receipt without a competition outcome, only `getLeaderboard({ sessionId })` adopts it through the same atomic committer. It reuses the already verified immutable receipt, performs no replay or verification allowance work, and leaves the original receipt unchanged. Failure makes the standings temporarily unavailable; the original verified result remains valid. The issue #10 receipt-first retry path is unchanged. After the receipt window, an outcome cannot be recovered from a client-supplied score.

Future runtime changes must keep the stored receipt/session parser and challenge compatibility policies alongside the retained replay runtime. Unsupported or inconsistent stored data fails closed; deployment does not regenerate tracks or rewrite historical scores.

## Validation and hosted limits

Platform-free service tests use revision-aware CAS snapshots and expiring storage. They force both faster/slower transaction orders, concurrent identical/different replays, equal times, immutable prior outcomes after another device improves, partial proof/receipt/score/revision writes, unknown lower scores, retained legacy adoption, tied ranks, nearby boundary ties, read revision churn, write retry exhaustion, missing trusted names, wrong storage types and the exact ninety-day boundary. Synthetic verified-boundary fixtures are labelled as competition-arithmetic tests, rather than replay-validation evidence.

An additional service test uses the actual Redis adapter over `RevisionRedis` and repairs an injected omitted PB write after unconfirmed read-back. HTTP integration exercises the actual Hono/tRPC path, authoritative shared replay verifier, competition core and Redis adapter over that same revision model. SDK tests cover queue shapes, expected-value and own-score checks, TTL/read-back handling, watch conflicts and ambiguous replies. Browser tests cover explicit results refresh, server-ranked ties, current-versus-prior outcomes, signed-out/expired states and preserving verification after a standings outage.

These models do not prove the hosted SDK's WATCH-abort representation or real Reddit authenticated identity. The guarded private test diagnostic and issue #20 record that platform evidence separately. No public publication or invented production result is part of this implementation.
