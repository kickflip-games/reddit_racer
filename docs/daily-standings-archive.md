# Daily standings archive

The archive is a read-only view of the installed community's existing verified
competition records. It does not generate historical courses, accept scores,
change ranked admission, or merge scores across handling namespaces.

## Scope and retention

- The default is yesterday **UTC**, not the player's local calendar day.
- Existing daily results expire 90 days after their UTC day ends. This is not a
  permanent hall of fame. Missing days and expired records are not fabricated.
- Standings belong to the request's trusted subreddit, not a client-supplied
  community. Other tracks and local best laps are not included.
- Each bounded request returns at most 20 racers. Equal verified times have equal
  competition ranks, even when a tie spans pages. The first page is not the whole
  winner group when more tied racers remain.
- Yesterday is explicitly provisional during the existing three-minute rollover
  grace. Later views still read current retained records, rather than promising
  an immutable final snapshot: previously verified submissions can be reconciled.
- Optional links point to the original registered daily race post. Missing or
  deleted posts must not invalidate otherwise verified standings.

## Integrity and cost

The server reads stored challenge identity, ordered results, matching retained
personal-best receipts and board revision. Cross-challenge hashes, untrusted
scores or inconsistent snapshots fail closed. Archive browsing never registers
posts or recreates a missing challenge. Pages and date selection are bounded;
there is no scan of all 90 days or continuous polling.

## Validation

Integration results are recorded after the client and server are combined.
Browser fixture results validate presentation and input isolation, not the
existence of real historical racers in the private installation. Live historical
Redis records are not assumed to exist. This feature is prepared locally and is
not deployed until explicitly authorized.
