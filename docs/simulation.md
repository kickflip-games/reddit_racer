# Fixed-step racing and replays

The current main game uses `fixed-step-v4` / `centreline-v1`: [centreline cornering, canonical gaps and overpasses](predictable-routes.md). The `arcade-v1` details below document the flat reference fixtures, which remain useful numerical controls.

`src/shared/simulation.ts` dispatches the authoritative fixed-step model. It imports only the canonical track sampler. It has no Three.js, DOM, Devvit, network, randomness or wall-clock dependency. It is shared by browser driving and Node replay execution.

## Tick and state contract

`createSimulationState()` returns an independent running state at tick zero, stationary on the start line. The UI explicitly starts its clock; constructing a state does not begin a race in the background. `stepSimulation(track, state, held)` returns a fresh state after exactly `1 / 120` seconds. Its only control is a Boolean accelerator. There is no caller-supplied delta time or steering input.

The state contains completed `tick`, centreline `distance` in metres, `speed` in metres/second, `lateralOffset` in metres along the canonical normal, `lateralVelocity`, normalized `slip`, `offRoad`, `recovering`, `recoveryTicksRemaining`, `recoveryCount`, nullable `finishedTick` and `status` (`running` or `finished`). Finished states are terminal. Physics completion is reaching `track.totalLength`. The shared race-rules layer additionally enforces ordered checkpoints, legal progress, countdown and lifecycle before a result is accepted; see [race-rules.md](race-rules.md).

## Handling version arcade-v1

The exported frozen `HANDLING` configuration is identical for every attempt:

| Parameter                | Value                           |
| ------------------------ | ------------------------------- |
| Acceleration             | 6.8 m/s²                        |
| Release braking          | 9.5 m/s²                        |
| Maximum speed            | 22 m/s                          |
| Rolling drag             | `0.015 × speed²` m/s²           |
| Lateral grip             | 7.8 m/s²                        |
| Lateral centering        | `1 × lateralOffset` m/s²        |
| Lateral damping          | `2.5 × lateralVelocity` m/s²    |
| Additional off-road drag | `3 × speed` m/s²                |
| Recovery threshold       | 8 metres beyond the road edge   |
| Recovery cost            | 120 stationary ticks (1 second) |

Acceleration and braking integrate speed gradually. Curvature demand is `abs(curvature) × speed²`. Demand beyond lateral grip produces outward lateral acceleration, opposing the sign of curvature. Centering and damping bring the car back as it slows. Corner grip never instantly clamps speed. Canonical effective road width determines whether off-road drag applies.

Extreme departures trigger automatic recovery. The triggering tick and the following 119 updates consume one full second without changing centreline distance. Speed and lateral offset ease to zero during recovery; it resumes at the same course distance, with no forward teleport or free progress. Ordinary off-road excursions remain playable and do not end an attempt.

These are initial regression settings, not a claim of human-tested balance. The 222.1072-metre reference oval is intentionally small. Generated daily courses and the balance study in issue #25 will address the 20–40-second run target and varied braking decisions.

## Deterministic math policy

Authoritative state updates are rounded to `0.000001` units after each tick. Sampled curvature and effective half-width are quantized before use. The update uses ordinary bounded arithmetic and no trigonometry or random values. Canonical sampling uses its stored geometry and a normalized cross-section. Cosmetic interpolation, audio and VFX must not feed back into state.

`SIMULATION_VERSION = fixed-step-v2` and `HANDLING_VERSION = arcade-v1` identify these rules. Any change affecting outcomes requires the appropriate new version and explicit replay-fixture updates. Do not silently apply new handling to persisted old challenges: retain a compatible versioned implementation or refuse incompatible ranked sessions. Current fixtures establish tested consistency on supported engines, rather than proving every possible future geometry has identical native math on every JavaScript engine.

## Transition replay schema

A replay has exactly these fields:

```json
{
  "schemaVersion": 1,
  "simulationVersion": "fixed-step-v2",
  "handlingVersion": "arcade-v1",
  "transitions": [
    { "tick": 0, "held": true },
    { "tick": 800, "held": false },
    { "tick": 860, "held": true }
  ],
  "endTick": 1590
}
```

Input starts released. A transition at integer tick `n` affects update `n → n+1`. Ticks must strictly increase; repeated states, same-tick duplicates, non-Boolean values, extra fields and wrong versions are rejected. The recorder coalesces changes within a tick into its final input. A pending transition on the current tick is omitted until that update has happened.

`validateReplay(unknown)` returns fresh validated data. It caps duration at 14,400 ticks (120 seconds) and transitions at 2,400 before simulation. Well-formed unfinished tapes may be decoded for development diagnostics. `runReplay(track, unknown)` creates fresh scored race state and runs the same authoritative updates through the shared lap rules. It rejects incomplete or invalid laps, unused events and trailing ticks after the actual finish. `endTick` bounds recorded work and must match the calculated finishing tick; it is never accepted directly as a score. The result is `{ state, finishTicks }` derived by simulation.

Replay verification prevents arbitrary impossible lap times. It does not prove human input or prevent automated/assisted play. Authenticated sessions, immutable challenge ownership, request-body limits, rate limiting, expiration and leaderboard persistence belong to later server issues #9–11. This implementation does not yet claim deployed ranked validation.

## Browser clock and rendering

`src/client/simulation-driver.ts` separates the fixed updates from animation frames. It retains a double-precision elapsed-time accumulator, with a small comparison tolerance; it never rounds each frame's duration. An ordinary 30/60/120-FPS schedule therefore produces the same fixed updates for the same tick inputs. `previousState`, current `state` and `alpha` support cosmetic interpolation.

A 360-tick (three-second) countdown is stationary and excluded from score. Input handlers latch Boolean input, and the driver records changes when a fixed tick samples them. Retained schema-1 tapes contain scored ticks only. V9/schema 2 also records negative countdown ticks for the [countdown launch](countdown-launch.md) rule. A frame gap of at least 250 ms abandons the attempt explicitly, rather than dropping elapsed time and silently changing the race. Focus loss, input overflow and the 120-second limit similarly interrupt the attempt. Retry resets clock, input tape and state together.

## Frozen reference fixtures

`src/shared/fixtures/reference-replays.ts` stores literal version tags, inputs, finish ticks and final states on `createOvalTrack()`:

| Replay | Input                                  | Finish                 |
| ------ | -------------------------------------- | ---------------------- |
| Hold   | Hold from tick zero                    | 1,867 ticks / 15.558 s |
| Lift   | Release at tick 800, hold again at 860 | 1,590 ticks / 13.250 s |

The race-rules update changed the simulation compatibility tag from `fixed-step-v1` to `fixed-step-v2` while preserving `arcade-v1` arithmetic and these exact numerical outcomes. The half-second lift saves 277 ticks (2.308 seconds). Holding forever still completes despite an off-road excursion. These are controlled numerical fixtures, not human playtest observations or an optimized lap record.

Unit tests cover gradual controls, outward grip loss, width-dependent surface drag, fixed golden outcomes, explicit recovery cost, replay schema and processing bounds. Browser tests run frozen replays in Chromium and WebKit against Node results. Driver tests compare 30/60/120-FPS schedules independently from rendering. Actual phone and hosted Reddit testing remain separately recorded integration work.
