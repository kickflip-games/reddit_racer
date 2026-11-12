import type { Replay } from '../replay.ts';

/** Frozen arcade-v1 inputs on createOvalTrack(); times are regression expectations. */
export const EXPECTED_HOLD_FINISH_TICKS = 1867;
export const EXPECTED_LIFT_FINISH_TICKS = 1590;
export const HOLD_REPLAY: Replay = {
  schemaVersion: 1,
  simulationVersion: 'fixed-step-v2',
  handlingVersion: 'arcade-v1',
  transitions: [{ tick: 0, held: true }],
  endTick: EXPECTED_HOLD_FINISH_TICKS,
};
export const LIFT_REPLAY: Replay = {
  schemaVersion: 1,
  simulationVersion: 'fixed-step-v2',
  handlingVersion: 'arcade-v1',
  transitions: [
    { tick: 0, held: true },
    { tick: 800, held: false },
    { tick: 860, held: true },
  ],
  endTick: EXPECTED_LIFT_FINISH_TICKS,
};

export const EXPECTED_HOLD_STATE = {
  tick: 1867,
  distance: 222.1072,
  speed: 20.725456,
  lateralOffset: 2.689002,
  lateralVelocity: 4.030506,
  slip: 1,
  offRoad: false,
  recovering: false,
  recoveryTicksRemaining: 0,
  recoveryCount: 0,
  finishedTick: 1867,
  status: 'finished',
};
export const EXPECTED_LIFT_STATE = {
  tick: 1590,
  distance: 222.1072,
  speed: 21.105213,
  lateralOffset: 3.327484,
  lateralVelocity: 4.083442,
  slip: 1,
  offRoad: false,
  recovering: false,
  recoveryTicksRemaining: 0,
  recoveryCount: 0,
  finishedTick: 1590,
  status: 'finished',
};
