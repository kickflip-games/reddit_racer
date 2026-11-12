# Private Redis transaction diagnostic

This diagnostic verifies the installed Devvit Redis client's actual hosted transaction behavior. Local revision-based fakes test application logic; the official SDK mock does not enforce WATCH conflicts. Neither proves the hosted backend's conflict response.

`runPrivateRedisSmoke()` is a server-only lifecycle handler helper. It runs only when the trusted request context exactly matches all four values:

- App slug: `full-throttle-dev`
- App version: `0.0.5`
- Subreddit ID: `t5_kv7foq`
- Subreddit name: `full_throttle_dev_dev`

Context version is compared verbatim. The installed SDK does not normalize that header. There is no caller-selected version, key, account, challenge or leaderboard. The upgrade payload and its optional installer do not authorize the probe.

The registered `onAppUpgrade` route calls `runPrivateRedisSmoke()` without arguments. A different installed version is required to trigger an upgrade; uploading alone and reinstalling the same version do not trigger it. Versions `0.0.2`, `0.0.3` and `0.0.4` have already been privately uploaded and installed. The corrected diagnostic build is the explicit, owner-only version `0.0.5`. Never run `devvit publish` for this test.

## Bounded work and isolation

The probe uses one fixed per-build marker and five uniquely named data keys, all under `racer:diagnostic:redis-smoke:`. It never calls the race submission service or writes competition accounts, personal bests, sessions or real leaderboard keys.

The pending marker and data keys have 120-second expirations. An NX marker excludes concurrent or duplicate lifecycle deliveries. After completion, the marker holds a bounded safe summary for 24 hours. The controls use seven transaction blocks in total, with at most two watched transactions concurrently:

1. An unchanged WATCH commits SET and INCR and checks their replies and stored value.
2. An ordinary write modifies a watched key before EXEC; its queued sentinel must remain unchanged. The actual EXEC array or error encoding is recorded. Only an empty reply or an explicit Redis transaction-failed/ABORTED response counts as the abort control; an unrelated transport failure leaves the diagnostic failed.
3. Two transactions watch the same initial value; after the first commits, the second must leave the winner intact.
4. A diagnostic sorted set checks bounded rank reads, an exact-score tie query, rank lookup and positional MGET.
5. Expiration checks confirm temporary string and sorted-set keys have TTLs.
6. After resetting the same five data keys, the actual `createCompetitionStore(redis).compareAndSwap` adapter commits three diagnostic records, a diagnostic sorted-set member and a revision increment. A second mutation checks the existing records and score, improves that same member from 200 to 150 and increments the revision to 2. Both complete reply, expiry and readback checks must return true; this also verifies the hosted sorted-set type preflight. This is separate from the raw transaction controls and does not write competition data.

Every Redis command is awaited. No retry loop or sleep is used, and new transaction controls stop after a 15-second work budget. SDK/platform timeouts still govern individual calls. Every outstanding transaction is discarded on exit. A `finally` block deletes the five owned data keys and confirms every key has type `none`; MGET alone would incorrectly treat an existing sorted set as nil. TTLs provide cleanup if the runtime is interrupted.

The report has `status: 'passed' | 'failed' | 'skipped'`, check booleans and bounded EXEC observations. It records only known reply literals, numbers, value types and safe error names/codes. Arbitrary RPC text, request metadata, credentials, session tokens and replay data are excluded. A `redis: transaction failed` discriminator is recorded as a Boolean rather than logging the raw message. Before the TTL assertion, the report records the four fixed expiry labels with their raw numeric result, runtime type and safe-integer flag, plus current milliseconds/seconds and the original expected deadline in milliseconds. Nonfinite numbers are represented by a fixed `NaN`/`Infinity` label and numeric null so JSON does not hide their meaning. No key names or nonce enter these observations.

## Observed private 0.0.3 behavior

The private `0.0.3` build from commit `481ea0c` ran on the guarded test installation at `2026-11-12T06:01:19.214Z`. The unchanged transaction succeeded. Both changed-key and competing-WATCH controls aborted with an `Error` carrying numeric code `2` and the safe `redisTransactionFailed: true` discriminator. All five temporary data keys were confirmed deleted. No real leaderboard or account was written.

The sorted-set transaction returned `[3, null]`: the known queued EXPIRE position uses a nil acknowledgement on this hosted SDK. The adapter now permits nil only in those EXPIRE positions and still requires complete write results, record/score/counter readback and explicit expiration-time checks. A nil SET acknowledgement remains invalid, and nil EXPIRE without a stored TTL cannot confirm a commit.

The `0.0.3` diagnostic failed before the remaining controls completed because sorted-row equality compared JSON property insertion order. The installed protobuf builds rows as `{ score, member }`; the corrected probe compares the member and score fields directly. The sorted-read control was subsequently verified by `0.0.4`; TTL and adapter controls remain unverified until a later private run passes. The old version's bounded marker is left to expire normally.

The private `0.0.4` build from commit `55da31f` ran at `2026-11-12T06:12:14.975Z`. Unchanged transactions, both WATCH-abort controls and sorted reads passed; expiry validation failed before the adapter controls. Cleanup again confirmed all five data keys absent. The raw expiry values were not included in that report, so their units and whether TTL assignment failed remain unknown. Version `0.0.5` adds only the labelled observations before that same fail-closed check. The adapter's TTL conditions remain unchanged; no guessed unit conversion or acknowledgement-only success is used.

## Private execution and evidence

After local tests and build checks pass, the authorized private workflow is:

```sh
npx devvit upload --version 0.0.5
npx devvit install full_throttle_dev_dev full-throttle-dev@0.0.5
npx devvit logs full_throttle_dev_dev full-throttle-dev --since 30m
```

Confirm the exact installed version and inspect the structured `Private Redis smoke` result. A skipped, missing or failed report is not successful hosted verification. Keep the original report with the implementation evidence. If credentials or services fail, record the precise blocker; do not infer Redis behavior from the fake tests.

This backend diagnostic does not verify browser-supplied requests, authenticated player identity, post expansion, gameplay, mobile behavior or physical-device performance. Those checks remain part of #20 and the related playtesting issues.

References: [Devvit trigger catalog](https://developers.reddit.com/docs/capabilities/server/trigger-events), [CLI reference](https://developers.reddit.com/docs/guides/tools/devvit_cli), [Redis capability](https://developers.reddit.com/docs/capabilities/server/redis).
