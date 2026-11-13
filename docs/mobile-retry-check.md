# Repeated local production retries

A bounded observation on November 13 used the production client built from `d40ffe7a78e3d257d6e7cdd33921f254d134e9c9`, the source installed privately as 0.0.13. Root independently matched 65 source-file hashes and all 19 served production-file hashes. The [verification summary](evidence/mobile-retries-2026-11-13.json) retains the exact build inventory digest, raw-measurement digest, browser and limits.

One warm-up plus 20 measured full laps completed in 176.212 seconds under the unchanged 180-second bound. There were 21 actual finishes and 21 trusted Retry clicks. Every lap finished at 3,215 ticks / 26.792 displayed seconds on the same canonical course; every retry returned countdown, zero time/speed/progress and released input. No driver state, finish state or rendering was substituted.

| Comparable checkpoint | DOM listeners after explicit GC | DOM nodes |    Used JS heap |
| --------------------- | ------------------------------: | --------: | --------------: |
| After warm-up         |                              61 |       339 | 6,789,972 bytes |
| After measured lap 10 |                              61 |       341 | 7,146,872 bytes |
| After measured lap 20 |                              61 |       341 | 7,208,036 bytes |

Live native handles stayed at 125 buffers, eight textures, nine programs and 25 vertex arrays, with one healthy WebGL context and one pending animation callback. There were no page or GL errors. Collected JS heap grew 418,064 bytes (6.16%); it is not flat. Uncollected per-retry node/listener counts fluctuate and are not comparable retained-object measurements. No retained GPU byte count or universal leak bound is claimed.

This was headless desktop Chromium 158 on SwiftShader at 393×852 CSS pixels / DPR 1, with native rendering, car/scenery, audio processing and full motion. An artificial clock scheduled real browser input, so wall duration and callback counts are not presented FPS. Only archived daily transport was mocked; optional board/current-post queries returned honest 404s. No authenticated start, submission or invented score occurred.

This completes a useful local repeated-retry check. Actual Android/iPhone input, sustained feed holds, sound output, thermal behavior and frame-rate budget remain open under #24 and related issues. The browser and ephemeral server were closed; the existing developer server was untouched.
