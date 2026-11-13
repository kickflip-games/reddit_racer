# Automatic daily races

The server prepares the current UTC race on private installation/upgrade and checks it every five minutes. A healthy current post is reused. The moderator's **Create today's race** action uses the same coordinator, so opening an existing day's race does not submit another post.

The [Devvit scheduler](https://developers.reddit.com/docs/capabilities/server/scheduler) maps one configuration-managed task, `ensure-daily-race`, to `/internal/scheduler/ensure-daily-race`. Configuration-managed jobs are replaced on installation/upgrade; this app does not also register recurring runtime jobs. The interval includes midnight, but platform delivery is not an exact midnight guarantee. UTC comes from server time, independent of player timezone and task data.

Automatic posting is currently limited to the registered `full-throttle-dev` app and existing private `r/full_throttle_dev_dev` installation (`t5_kv7foq`). Every write path checks SDK context plus a real private-community lookup. The task name is envelope validation, not an authentication credential. The route is internal only; no browser API accepts a date, account, target subreddit or arbitrary post creation request. This feature neither publishes the app nor changes community privacy.

## Durable coordination

One permanent string journal uses `racer:daily-publication:<subredditId>`. Its schema records operation identity, intended day, prepared challenge hash, submission time and phase. Exact WATCH/MULTI compare-and-swap plus ordinary Redis readback establishes ownership. An acknowledgement alone is insufficient, and a lost acknowledgement can be confirmed only by the exact persisted value.

Only the invocation that generated and confirmed a fresh claim can call Reddit submission. A later invocation seeing the same claim cannot submit. During the first 60 seconds, observers leave an in-flight claim untouched; this prevents them from disrupting the owner's claim confirmation. After that observation grace they may reconcile, but the grace never grants permission to submit again.

The journal moves from submitting/uncertain to a known created post and then terminal settlement. Terminal settlement records the actual creation day and availability separately from whether today's link is ready. A known removed/missing post can settle as unavailable, blocking recreation that day while permitting a later day. A new operation requires a day later than both the previous intended and actual creation day, protecting midnight overlap and clock skew.

Reddit's installed submission API has no idempotency key. A request that may have created a post must therefore stay guarded. Unknown results never expire into a blind retry. A bounded scan of at most 20 recent community posts can positively recover the operation using its app author, scope, creation window and `racerPublicationId` post-data marker. Zero matches is not proof that no post was accepted; conflicting positive post IDs fail closed.

The marker is public, nonsecret provenance, never identity or admission authority. [Post data is sent to clients](https://developers.reddit.com/docs/capabilities/server/post-data). Metadata repair preserves the marker, uses trusted Reddit creation time, binds the existing immutable daily record and confirms the registered pointer. It never regenerates or replaces a saved historical challenge. A known post ID remains usable as the menu fallback if later repair/storage is unavailable only after a trusted read confirms that the post is available, in the same community and created on the current UTC day. Removed, missing and stale IDs do not become a misleading menu link; no second submission follows.

If uncertainty persists without a positive matching post, automatic publication remains blocked for operator investigation. Do not treat a negative listing, elapsed time or a failed response as permission to erase the guard. The server logs fixed status messages without credentials or raw SDK errors. Deliberately removed daily winners are not automatically recreated against moderation intent.

## Daily courses and standings

The accepted full track and handling/version conditions still live in the existing per-UTC-day record. Post bindings retain their trusted original day. Leaderboards retain their existing challenge/account keys and authoritative replay verification; scheduling does not reset or seed them.

An old post keeps its circuit and standings. Its existing current-race action discovers the newly registered post. `readRegisteredPost` is an internal server method that distinguishes an absent pointer from an unavailable registered winner; its historical read validates the saved binding/hash and performs no generation or writes. The public today-post API still accepts no caller-selected day.

Install, upgrade, moderator and scheduled paths share the coordinator. Upgrade calls the same private-scope-checked coordinator directly. The earlier one-off, version-specific Redis diagnostic is retained as diagnostic code and is not a prerequisite for normal upgrades. An uncertain/busy outcome is reported honestly. Logging failures cannot reverse a completed side effect.

## Checks and observation limits

Unit coverage includes exact concurrent claims, lost commit replies, an observer between claim commit and owner confirmation, unknown submission results, positive/negative reconciliation, known-ID repair, removal before settlement, conflicting IDs, UTC crossings, clock skew and bounded work. Redis adapter checks model real WATCH conflicts and exact readback; mounted scheduler/upgrade routes validate the declared endpoint and safe failures. The private scope guard and historical pointer reads are separately tested.

Actual private bootstrap, genuine scheduled callback, new-day ranked run, preserved old standings and current-post navigation must be recorded in [hosted evidence](hosted-playtest.md) for each installed source/version. Unit clocks do not establish a real midnight event, and owner Mobile preview does not establish physical-phone or anonymous-access behavior.
