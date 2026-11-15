# Historical daily standings

`dailyStandings({ day?, offset? })` is a read-only tRPC query. Missing day defaults to yesterday UTC; future/current dates are rejected. Responses expose the server UTC date bounds for the previous 90 days. Older valid dates return `expired` without storage reads. Missing challenges are never generated.

The trusted installed subreddit selects all storage keys. The browser cannot select an account/subreddit/post. Pages contain at most 20 rows; `nextOffset` advances by 20, up to offset 100,000. `hasMore` remains true at that bound if additional racers exist, so UI must not claim the archive is exhaustive. Pagination uses Redis order and the first member at the page-leading score to preserve competition ranks, including more than 20 tied winners. Each page checks retained personal-best receipts against account, challenge hash, and sorted score, plus the board revision before/after (three bounded attempts). It never exposes user IDs or receipts.

The archive is a live view, not a finalized winners snapshot. `provisional` is true until three minutes after the requested UTC day ends, covering in-flight race admission. Later reconciliation of already verified receipts can still update retained results: do not label the post-grace board immutable. Concurrent changes across separate page requests can change pagination; each individual page is revision-consistent, not an all-pages transaction.

States distinguish `available`, `empty` (no rows in selected window), `missing` (no saved challenge), `expired`, and `unavailable` (integrity/storage/read failure). Optional original post links are server-verified existing registry entries; link failures do not suppress valid standings. No historical course creation, post registration, score writes, or scheduled winner publication occurs.

Existing result retention is 90 days after day end, scoped to the current handling namespace. No old incompatible score migration or global/Other-tracks leaderboard is implied.

Validation: six focused archive tests cover 23 tied winners across the page boundary, ranks, own-row highlighting, midnight grace, date/account/subreddit rejection, missing/empty/expiry, receipt inconsistency, revision retry limit, link failure, and malformed responses. Existing competition tests also pass. Types and lint pass.

## Integration and deployment status

Browser fixtures validate presentation and input isolation, not the existence of
real historical racers in the private installation. Live historical Redis records
are not assumed to exist. This feature is prepared locally and is not deployed
until explicitly authorized.
