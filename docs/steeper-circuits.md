# Steeper rolling circuits

The current recipe is `linked-circuits-v5`. It increases the existing hill height coefficient from 0.00032 to 0.00044 and the height cap from 5m to 6.5m. Shorter hills are 37.5% steeper; the capped increase is 30%. The horizontal motifs, flat grid, tight-corner exclusions and C2 crest shape are retained. The 0.01056/m vertical-curvature bound remains below the airborne contact threshold at the existing 30m/s speed limit.

| Seed                         | Previous peak grade | New peak grade | Previous height | New height |
| ---------------------------- | ------------------: | -------------: | --------------: | ---------: |
| `word-v2:banana`             |              6.470% |         8.897% |          1.110m |     1.526m |
| `word-v2:tui`                |             10.654% |        14.649% |          3.007m |     4.134m |
| `word-v2:river`              |              7.251% |         9.970% |          1.394m |     1.916m |
| `daily:t5_kv7foq:2026-11-21` |              8.236% |        11.324% |          1.797m |     2.471m |
| `word-v2:evaluation-29`      |             10.641% |        14.632% |          2.999m |     4.124m |

## Compatibility

- Stored daily records retain their complete serialized tracks, challenge hashes, scored rules and leaderboard bindings. An existing day is never regenerated or migrated. New daily records and newly requested practice courses use V5.
- Saved V3/V4 share payloads reconstruct the old hill recipe and its exact bounded quality-selection result. V3 retains fixed-step-v8; V4 and V5 use the unchanged fixed-step-v9/countdown-start-v1 simulation. No driving or drift-boost algorithm is changed.
- New geometry and generator identity produce new track hashes. Practice best/ghost keys also include the complete course identity. Old and new times are not combined.
- The pre-change fixtures pin five V4 hashes and recorded input tapes, plus a complete immutable stored daily. Tests replay the original tapes to their exact ticks and verify retained share roundtrips.

## Integrated presentation and controls

This integrates the previously local animated Kenney-car home and presentation work from `b4af774`, along with the private countdown, GO, muddy/asphalt marks, top-right minimap and SVG control changes through `72e9694`. The in-race camera implementation remains unchanged. The pre-race line remains “Hold to accelerate. Release to brake.” One-tap retries remain; countdown and driving gain no helper text or technique labels.

## Validation and release scope

Local Node 24.22.2 full checks pass with 506 unit tests, formatting, types, lint, flat track checks and the production build. The existing 205-course campaign passes every unchanged gate, authoritative replay check and sampled daily/practice parity check. Camera tests follow the real steep-hill replay across portrait, narrow, desktop and landscape layouts. Production browser regressions additionally drive native input through the hill crests and completed laps, current/retained daily previews and countdowns.

The requested release target is only private `the-daily-lap` on `full_throttle_dev_dev`. Existing dailies retain their earlier grades; use practice seed `tui` or `banana` to see the new hills immediately. Public r/theDailyLap and the separate legacy app are outside this release. No data migration is needed.
