import type { RacePhase } from '../shared/race-rules';
import type { SimulationState } from '../shared/simulation';

export type RecoveryVisualFrame = {
  attemptId: number;
  phase: RacePhase;
  state: Pick<
    SimulationState,
    'tick' | 'recovering' | 'recoveryCount' | 'recoveryTicksRemaining'
  >;
};

/** 1.5 flashes per second at 120Hz; no independent timer or recovery duration. */
export const RECOVERY_BLINK_HALF_TICKS = 40;

export function createRecoveryFeedback() {
  let attemptId = -1;
  let recoveryCount = -1;
  let startedTick: number | undefined;
  const reset = () => {
    startedTick = undefined;
    attemptId = -1;
    recoveryCount = -1;
  };
  return {
    reset,
    update(
      frame: Readonly<RecoveryVisualFrame> | undefined,
      reducedMotion: boolean
    ) {
      if (
        !frame ||
        frame.phase !== 'racing' ||
        !frame.state.recovering ||
        frame.state.recoveryTicksRemaining <= 0 ||
        frame.state.recoveryCount <= 0
      ) {
        reset();
        return { active: false, visible: true };
      }
      if (
        startedTick === undefined ||
        attemptId !== frame.attemptId ||
        recoveryCount !== frame.state.recoveryCount ||
        frame.state.tick < startedTick
      ) {
        startedTick = frame.state.tick;
        attemptId = frame.attemptId;
        recoveryCount = frame.state.recoveryCount;
      }
      const elapsed = Math.max(0, frame.state.tick - startedTick);
      return {
        active: true,
        visible:
          reducedMotion ||
          Math.floor(elapsed / RECOVERY_BLINK_HALF_TICKS) % 2 === 0,
      };
    },
  };
}
