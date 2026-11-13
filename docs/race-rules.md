# Race lifecycle and valid laps

`src/shared/race-rules.ts` wraps the unchanged arcade physics with the lifecycle and lap rules used by both client driving and replay verification. A client cannot submit simulation state, checkpoint claims, position, or a finishing time.

## Lifecycle

| Phase       | Entry and behaviour                                                           |
| ----------- | ----------------------------------------------------------------------------- |
| `loading`   | Fresh state; no accepted track and no physics updates                         |
| `ready`     | `prepareRace(track)` validates the canonical track and resets conditions      |
| `countdown` | `startRace()` starts 360 stationary, unscored ticks                           |
| `racing`    | Fixed physics updates and ordered sector crossings count toward elapsed ticks |
| `finished`  | One complete legal lap; result and state are terminal                         |
| `abandoned` | Interruption, time limit or illegal progress; no accepted result              |

`createRaceState()` begins in loading. `prepareRace()` only accepts loading; `startRace()` only accepts ready. Both construct fresh timing, simulation and checkpoint state. The last countdown update changes phase to racing without executing physics. The following update is scored tick `0 → 1`.

The accelerator may be held during countdown, but nothing moves. The browser driver records the input sampled by the first scored update as a transition at tick zero. Inputs changed and released entirely during countdown have no replay effect. All racers begin with the same stationary canonical start conditions.

`abandonRace()` is idempotent. Finished and abandoned states remain terminal under further steps or interruption events. Retry builds a new prepared race and a fresh driver clock/input tape, while reusing loaded visual resources and existing listeners.

## Authoritative progress and checkpoints

A race owns its `SimulationState`, `nextCheckpointIndex`, and `checkpointTicks`. `stepRace()` obtains the next simulation state itself, then applies `advanceLapProgress()` to guard the trajectory:

- Completed tick increments by exactly one.
- Numeric state is finite and lies within supported bounds.
- Centreline distance is monotonic and within the complete lap.
- Forward movement is no greater than one maximum-speed tick and matches the quantized movement for the newly calculated speed.
- Recovery advances time without changing course distance.
- Checkpoint metadata agrees with the prior distance; a claimed future gate or an unvisited gate already behind the car is invalid.
- Crossed checkpoints advance in stored order and receive authoritative split ticks.
- Finishing requires the full centreline distance, all intermediate checkpoints and the simulator's matching finish tick.

The helper is a trajectory/checkpoint guard, not an independent proof of every physics field. For example, it does not independently recalculate acceleration from two arbitrary supplied snapshots. Its caller must obtain the next snapshot from `stepSimulation()`, as `stepRace()` does. Server replay verification never accepts either snapshot from a client.

Several closely spaced gates may cross on the same legal tick; their split ticks may therefore be equal. No gate may be skipped, reordered or claimed early. Splits are diagnostic race data and never a separately trusted submitted score.

## Runoff and recovery

Checkpoint gates span the runoff corridor at an ordered **arc distance**. They are not narrow road-only trigger meshes. A player who slides wide must still be able to finish without reverse or steering controls. The car continues to pay every forward metre around the canonical circuit, with surface drag and stationary recovery penalties. It cannot shorten a bend by jumping to a nearby visual road segment.

The existing handling rules remain unchanged: ordinary off-road excursions lose speed and can return naturally; an extreme departure triggers 120 stationary recovery ticks and returns to the same course distance. Recovery gives no checkpoint or forward progress. The reference hold-only replay crosses its fifth gate while off-road and validly finishes in 1,867 ticks. The deliberate lift replay remains faster at 1,590 ticks.

## Interruptions and verification

Focus loss, hidden/background state, a frame gap of at least 250 ms, input overflow and the race duration limit abandon the client attempt and release its latched input. The UI shows an interrupted result and Retry. There is no pause/resume path that preserves a ranked-eligible attempt.

`runReplay()` parses only a bounded, versioned Boolean transition tape, creates fresh racing state with `createRacingState(track)`, then executes `stepRace()` until the submitted tape ends or a terminal phase occurs. The fresh racing helper omits the UI countdown computationally but uses exactly the same scored starting conditions. Only `phase === finished` with the authoritative finish tick and a completely consumed tape is accepted.

Pure replay cannot prove whether a modified client ignored a focus event or used assisted input. Authenticated session expiry, server-side duration/rate limits and immutable challenge binding are additional controls in issues #9–11. No claim of human play or deployed ranked integration follows from these local rules.

The simulation compatibility version is now `fixed-step-v2`; handling remains `arcade-v1`. Existing fixed-step-v1 tapes are rejected by the current verifier. A future persisted challenge must retain its compatible versioned verifier or explicitly reject incompatible sessions; deploying new code must not silently reinterpret an old ranked challenge.

## Continuous unranked practice

The dedicated **Practice tracks** mode uses a separate client-only driver around the same movement step. It continues kinematics and held input across the line, resets only lap timing/checkpoints, and exposes monotonic presentation snapshots. It creates no replay or ranked session. The one-lap lifecycle and initial-condition guards above remain the ranked authority; [practice](practice.md) records the separate clock and seam policy.

## Verification

Shared tests exercise loading/ready/countdown timing, unchanged golden finishes, ordered gates including runoff, jumps, reverse progress, skipped/fabricated checkpoint claims, partial finishes, recovery, interruption and clean retry. Driver tests compare render schedules and confirm that countdown input changes enter a replay only when sampled by scored ticks. Browser checks cover visible countdown/progress, complete lap, touch/keyboard input and retry; hosted Reddit and physical-phone observations remain separate evidence.
