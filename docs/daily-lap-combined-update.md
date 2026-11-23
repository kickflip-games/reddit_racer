# Combined braking and recovery update

This branch combines V7 tuning `b7d0f862250675bc707cf382f34862056df3fab8` and independently implemented reset feedback `953f49219c73b41a857a6aef43f3721138b02e16`. Both are cherry-picked with source provenance onto the installed release baseline **e2af8a205695a09ced4ea9e13cba4058b8fdb3ae**, rather than including the unrelated dependency/check updates on main. The separate original worktrees remain intact. No reset-only PR or submission was in flight when this branch was prepared.

The generator retains stored V6 geometry and replay rules. Existing immutable daily challenges and scores are not migrated or replaced. The automatic recovery presentation uses the actual player recovery lifecycle; its sound, 1.5Hz flash and reduced-motion halo do not change recovery timing or scoring. See [tuning measurements](braking-rhythm-tuning.md) and [recovery checks](recovery-feedback.md) for implementation and limits.

The broader 205-seed integration sweep found `daily:t5_rhythm:2027-02-14` rejected the first 12 jump approaches; candidate 13 passes the unchanged safety gates. Only V7's quality-assessment budget increases to the existing 32-candidate limit. Earlier recipes still stop at 12 assessments. A regression checks the exhausted 12-candidate result and clean accepted thirteenth candidate. No physics or acceptance threshold was relaxed.

## Thirty-day paired course gallery

The A5 portrait PDF contains three dates per page, ten pages and 60 visible maps, covering **November 24 through December 23, 2026 UTC**. Seeds use the production namespace `daily:t5_kyc33w:YYYY-MM-DD` and production UTC helpers. These are offline previews, not claims about already stored or installed races.

`scripts/daily-course-gallery.ts` exports every canonical sampled point, checkpoints, jumps, overpass crossings, elevations and track hashes. It asserts all 60 hashes against the original tuning campaign. Eleven pairs have unchanged geometry and are labelled explicitly. Within each pair the same scale and coordinate frame are used, with GO rotated to face right; translation and rotation preserve handedness. Jump gaps and upper overpass decks are marked.

`scripts/daily-course-gallery.py` renders the PDF and all ten PNG pages. Its audit checks 30 distinct consecutive dates, 30 OLD V6 and 30 NEW V7 panel labels, eleven unchanged labels and actual vector drawings on every page. All rendered pages were opened for visual inspection. The separate verification JSON records each pair's shared scale and source hashes. The final export was repeated after the V7 budget extension and all original hashes still match.

Reproduce from this checkout (Python 3.12 or newer):

```sh
npm ci --ignore-scripts
npx tsx scripts/daily-course-gallery.ts /tmp/daily-lap-course-gallery.json
python3.12 -m venv /tmp/daily-lap-gallery-venv
/tmp/daily-lap-gallery-venv/bin/pip install reportlab pypdf pymupdf
/tmp/daily-lap-gallery-venv/bin/python scripts/daily-course-gallery.py /tmp/daily-lap-course-gallery.json /tmp/daily-lap-gallery/output/pdf/daily-lap-v6-v7-30-days.pdf
```

The delivered file is `/Users/avaj040/Documents/Codex/2026-11-24/task/output/pdf/daily-lap-v6-v7-30-days.pdf`. Its confirmed Library ID is `libfile_fde3_f-8e998e9699788191a7ec5bb02bdce25d_ed83fc63163c8191b9a12a806b551e04`.

## Combined local verification

On UoA Work Machine, Node 24.22.2: the complete original combined unit suite passed 533 tests and 45 release-contract tests; the subsequent focused generator/regression suite passed 13 tests, including frozen V6 hashes and replay outcomes. All 205 linked course seeds and the 200-track structural/simulation sweep passed. TypeScript, ESLint, formatting and production build passed. Existing Vite bundle and dynamic-import notices remain.

Four headless installed-Chrome checks passed against this combined worktree's local Vite server: repeated real player resets with exactly one sound per reset and interruption restoration; actual car asset flash/reduced-motion/restored snapshots; native audio activation/mute/background lifecycle; and offline production cue signals. Both visual screenshots were inspected. Physical phone speaker audibility and subjective driving feel were not checked. No hosted test environment or private app was created.

Release authorization permits one required protected-branch PR CI workflow and one protected release submission. Reddit review and installation are separate stages; successful upload alone must not be reported as live.
