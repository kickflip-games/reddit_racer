import type { RacePhase } from '../shared/race-rules';
import type { SimulationState } from '../shared/simulation';
import {
  AUDIO_GEAR_STARTS,
  drivingAudioGear,
  drivingAudioSpeed,
  calculateDrivingAudioTargets,
  createDrivingAudioGraph,
  type DrivingAudioCue,
  type DrivingAudioTargets,
} from './driving-audio-graph';

export type DrivingAudioFrame = {
  attemptId: number;
  phase: RacePhase;
  state: Readonly<SimulationState>;
  held: boolean;
  acceleration: number;
};
export type DrivingAudioStatus =
  'locked' | 'starting' | 'running' | 'muted' | 'unavailable' | 'disposed';
/** Narrow injectable boundary: fake backends test ownership, never audibility. */
export type DrivingAudioBackend = {
  readonly state: string;
  readonly currentTime: number;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  apply(targets: Readonly<DrivingAudioTargets>): void;
  silence(): void;
  cue(kind: DrivingAudioCue, strength?: number): void;
  subscribeState(listener: () => void): () => void;
};
export type DrivingAudioOptions = {
  muted: boolean;
  onStatusChange?: (status: DrivingAudioStatus) => void;
  createBackend?: () => DrivingAudioBackend;
};
export type DrivingAudio = {
  readonly status: DrivingAudioStatus;
  resetAttempt(attemptId: number): void;
  /** Call synchronously from Start/Retry/unmute, before any asynchronous work. */
  unlockFromGesture(): void;
  setMuted(value: boolean): void;
  setForeground(value: boolean): void;
  update(frame: Readonly<DrivingAudioFrame>): void;
  countdown(attemptId: number, seconds: number): void;
  lap(attemptId: number, completedLaps: number, personalBest?: boolean): void;
  finish(attemptId: number): void;
  /** Only for a server-confirmed lead on this finished attempt. */
  verifiedBest(attemptId: number): void;
  silence(reason: 'abandon' | 'background'): void;
  dispose(): Promise<void>;
};
export const AUDIO_RESUME_TIMEOUT_MS = 1500;
export const AUDIO_FINISH_SUSPEND_MS = 300;
export const AUDIO_VERIFIED_BEST_SUSPEND_MS = 400;
export const AUDIO_PARAMETER_HZ = 30;

function browserBackend(): DrivingAudioBackend {
  if (typeof AudioContext === 'undefined')
    throw new Error('Web Audio is unavailable');
  const context = new AudioContext({ latencyHint: 'interactive' });
  let graph: ReturnType<typeof createDrivingAudioGraph>;
  try {
    graph = createDrivingAudioGraph(context);
  } catch (error) {
    void context.close().catch(() => {});
    throw error;
  }
  let closed: Promise<void> | undefined;
  return {
    get state() {
      return context.state;
    },
    get currentTime() {
      return context.currentTime;
    },
    resume: () => context.resume(),
    suspend: () => context.suspend(),
    apply: (targets) => graph.apply(targets),
    silence: () => graph.silence(),
    cue: (kind, strength) => graph.cue(kind, undefined, strength),
    subscribeState(listener) {
      context.addEventListener('statechange', listener);
      return () => context.removeEventListener('statechange', listener);
    },
    close() {
      if (!closed) {
        graph.dispose();
        closed =
          context.state === 'closed' ? Promise.resolve() : context.close();
      }
      return closed;
    },
  };
}

/** One lazy context/graph per scene; no DOM listeners, RAF or racing writes. */
export function createDrivingAudio(options: DrivingAudioOptions): DrivingAudio {
  let muted = options.muted;
  let foreground = true;
  let status: DrivingAudioStatus = muted ? 'muted' : 'locked';
  let disposed = false;
  let backend: DrivingAudioBackend | undefined;
  let unsubscribe: (() => void) | undefined;
  let attemptId = 0;
  let generation = 0;
  let granted = false;
  let resumePending = false;
  let finishing = false;
  let finishRewardEligible = false;
  let verifiedBestSeen = false;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFrame: DrivingAudioFrame | undefined;
  let lastWriteTime = -Infinity;
  let lastTick = -1;
  let lastRecoveryCount = 0;
  let lastLandingCount = 0;
  let lastCountdown: number | undefined;
  let lastLap = 0;
  let virtualGear: number | undefined;
  let lastShiftTick = -Infinity;
  let closing: Promise<void> | undefined;

  function notify(): void {
    try {
      options.onStatusChange?.(status);
    } catch {
      /* UI observers cannot block racing. */
    }
  }
  function publish(next: DrivingAudioStatus): void {
    if (status === next) return;
    status = next;
    notify();
  }
  function clearResumeTimer(): void {
    if (resumeTimer !== undefined) clearTimeout(resumeTimer);
    resumeTimer = undefined;
  }
  function clearTimers(): void {
    clearResumeTimer();
    if (finishTimer !== undefined) clearTimeout(finishTimer);
    finishTimer = undefined;
  }
  function canPlay(): boolean {
    return (
      !disposed &&
      !muted &&
      foreground &&
      granted &&
      backend?.state === 'running'
    );
  }
  function suspend(): void {
    const current = backend;
    const operation = generation;
    if (!current || current.state === 'closed') return;
    try {
      void current.suspend().catch(() => {
        if (!disposed && generation === operation && !muted)
          publish('unavailable');
      });
    } catch {
      if (!disposed && !muted) publish('unavailable');
    }
  }
  function stop(suspendBackend = true, preserveFinishReward = false): void {
    if (!preserveFinishReward) finishRewardEligible = false;
    generation++;
    granted = false;
    resumePending = false;
    clearTimers();
    lastWriteTime = -Infinity;
    try {
      backend?.silence();
    } catch {
      /* Continue cleanup if the device was lost. */
    }
    if (suspendBackend) suspend();
  }
  function unavailable(): void {
    stop();
    publish(muted ? 'muted' : 'unavailable');
  }
  function applyCurrent(force: boolean): void {
    const current = backend;
    const frame = lastFrame;
    if (!current || !frame || frame.attemptId !== attemptId) return;
    const time = current.currentTime;
    if (!Number.isFinite(time)) {
      unavailable();
      return;
    }
    if (
      !force &&
      time >= lastWriteTime &&
      time - lastWriteTime < 1 / AUDIO_PARAMETER_HZ
    )
      return;
    try {
      current.apply(
        calculateDrivingAudioTargets(
          frame,
          canPlay() && !finishing,
          virtualGear
        )
      );
      lastWriteTime = time;
    } catch {
      unavailable();
    }
  }
  function stateChanged(): void {
    if (disposed || !backend) return;
    if (backend.state === 'running') {
      if (!canPlay()) {
        try {
          backend.silence();
        } catch {
          /* Suspend remains best effort. */
        }
        suspend();
        publish(muted ? 'muted' : 'locked');
      } else {
        resumePending = false;
        clearResumeTimer();
        publish('running');
        applyCurrent(true);
      }
    } else if (backend.state !== 'suspended' || !resumePending) {
      granted = false;
      resumePending = false;
      clearResumeTimer();
      try {
        backend.silence();
      } catch {
        /* The graph may already be closed. */
      }
      publish(
        muted ? 'muted' : backend.state === 'closed' ? 'unavailable' : 'locked'
      );
    }
  }
  function ensureBackend(): DrivingAudioBackend {
    if (backend?.state === 'closed') {
      unsubscribe?.();
      void backend.close().catch(() => {});
      backend = undefined;
    }
    if (!backend) {
      backend = (options.createBackend ?? browserBackend)();
      unsubscribe = backend.subscribeState(stateChanged);
    }
    return backend;
  }
  notify();
  return {
    get status() {
      return status;
    },
    resetAttempt(id) {
      if (disposed) return;
      if (!Number.isSafeInteger(id) || id < 0)
        throw new Error('Audio attempt must be a nonnegative integer');
      // The same native click immediately unlocks the next attempt. Do not queue
      // a suspend here that could race that gesture's resume.
      stop(false);
      attemptId = id;
      finishing = false;
      verifiedBestSeen = false;
      lastFrame = undefined;
      lastTick = -1;
      lastRecoveryCount = 0;
      lastLandingCount = 0;
      lastCountdown = undefined;
      lastLap = 0;
      virtualGear = undefined;
      lastShiftTick = -Infinity;
      publish(muted ? 'muted' : 'locked');
    },
    unlockFromGesture() {
      if (disposed || muted || !foreground) return;
      if (resumePending && granted) return;
      clearTimers();
      generation++;
      const operation = generation;
      granted = true;
      let current: DrivingAudioBackend;
      try {
        current = ensureBackend();
      } catch {
        unavailable();
        return;
      }
      resumePending = true;
      publish('starting');
      resumeTimer = setTimeout(() => {
        if (disposed || generation !== operation) return;
        resumeTimer = undefined;
        unavailable();
      }, AUDIO_RESUME_TIMEOUT_MS);
      try {
        // The call itself stays in the native gesture stack. Its resolution is gated.
        void current
          .resume()
          .then(() => {
            if (disposed || backend !== current || generation !== operation)
              return;
            resumePending = false;
            clearResumeTimer();
            if (canPlay()) {
              publish('running');
              applyCurrent(true);
            } else unavailable();
          })
          .catch(() => {
            if (!disposed && backend === current && generation === operation)
              unavailable();
          });
      } catch {
        unavailable();
      }
    },
    setMuted(value) {
      if (disposed || muted === value) return;
      muted = value;
      if (muted) stop();
      publish(muted ? 'muted' : 'locked');
    },
    setForeground(value) {
      if (disposed || foreground === value) return;
      foreground = value;
      if (!value) stop();
      publish(muted ? 'muted' : 'locked');
    },
    update(frame) {
      if (disposed || frame.attemptId !== attemptId) return;
      const scored = frame.phase === 'racing';
      if (
        scored &&
        lastFrame?.phase === 'racing' &&
        frame.state.tick < lastTick
      )
        return;
      const force =
        frame.phase !== lastFrame?.phase ||
        frame.state.recovering !== lastFrame?.state.recovering;
      const recovery =
        scored &&
        frame.state.tick > lastTick &&
        frame.state.recoveryCount > lastRecoveryCount;
      const landingCount = frame.state.vertical?.landings ?? 0;
      const landing =
        scored &&
        lastFrame?.phase === 'racing' &&
        frame.state.tick > lastTick &&
        landingCount > lastLandingCount &&
        !frame.state.recovering &&
        !frame.state.vertical?.airborne &&
        (frame.state.vertical?.impact ?? 0) > 0.05;
      const audioSpeed = drivingAudioSpeed(frame);
      let shift: DrivingAudioCue | undefined;
      if (virtualGear === undefined || !scored || frame.state.recovering) {
        virtualGear = drivingAudioGear(audioSpeed);
        lastShiftTick = frame.state.tick;
      } else if (
        frame.state.tick > lastTick &&
        frame.state.tick - lastShiftTick >= 60 &&
        !frame.state.vertical?.airborne
      ) {
        // Separate up/down boundaries and a half-second dwell stop threshold chatter.
        const up = AUDIO_GEAR_STARTS[virtualGear + 1] ?? Infinity;
        const down = (AUDIO_GEAR_STARTS[virtualGear] ?? 0) - 1.2;
        if (audioSpeed >= up + 0.3 && virtualGear < 3) {
          virtualGear++;
          shift = 'shift-up';
        } else if (audioSpeed < down && virtualGear > 0) {
          virtualGear--;
          shift = 'shift-down';
        }
        if (shift) lastShiftTick = frame.state.tick;
      }
      lastLandingCount = landingCount;
      // During async retry preparation the driver still displays the previous
      // completed lap. Its tick must not become the new race's progress floor.
      lastTick = scored ? frame.state.tick : -1;
      lastRecoveryCount = scored ? frame.state.recoveryCount : 0;
      lastFrame = { ...frame, state: { ...frame.state } };
      applyCurrent(force || shift !== undefined);
      if (shift && !landing && !recovery && canPlay() && !finishing) {
        try {
          backend?.cue(shift);
        } catch {
          unavailable();
        }
      }
      if (recovery && canPlay() && !finishing) {
        try {
          backend?.cue('recovery');
        } catch {
          unavailable();
        }
      }
      if (landing && !recovery && canPlay() && !finishing) {
        try {
          backend?.cue('landing', frame.state.vertical?.impact);
        } catch {
          unavailable();
        }
      }
    },
    countdown(id, seconds) {
      if (
        disposed ||
        id !== attemptId ||
        finishing ||
        !Number.isInteger(seconds) ||
        seconds < 0 ||
        seconds > 3 ||
        seconds === lastCountdown
      )
        return;
      // No delayed GO when a scene starts already racing or sound is re-enabled.
      if (seconds === 0 && lastCountdown === undefined) return;
      if (!canPlay()) {
        // Give a gesture's pending resume a chance to play the current number,
        // but never queue muted/background cues for later playback.
        if (!resumePending) lastCountdown = seconds;
        return;
      }
      lastCountdown = seconds;
      try {
        backend?.cue(seconds === 0 ? 'go' : 'countdown');
      } catch {
        unavailable();
      }
    },
    lap(id, completedLaps, personalBest = false) {
      if (
        disposed ||
        id !== attemptId ||
        finishing ||
        !Number.isSafeInteger(completedLaps) ||
        completedLaps <= lastLap
      )
        return;
      lastLap = completedLaps;
      if (!canPlay()) return;
      try {
        backend?.cue(personalBest ? 'personal-best' : 'lap');
      } catch {
        unavailable();
      }
    },
    finish(id) {
      if (disposed || id !== attemptId || finishing) return;
      finishing = true;
      if (!canPlay()) {
        stop();
        return;
      }
      finishRewardEligible = true;
      applyCurrent(true);
      try {
        backend?.cue('finish');
      } catch {
        unavailable();
        return;
      }
      const operation = generation;
      finishTimer = setTimeout(() => {
        finishTimer = undefined;
        if (disposed || generation !== operation) return;
        stop(true, true);
        publish(muted ? 'muted' : 'locked');
      }, AUDIO_FINISH_SUSPEND_MS);
    },
    verifiedBest(id) {
      if (disposed || id !== attemptId || verifiedBestSeen) return;
      // Consume even inaudible confirmations. Never queue a reward for unmute,
      // foreground return, a retry, or a later activation gesture.
      verifiedBestSeen = true;
      const current = backend;
      if (
        !finishing ||
        !finishRewardEligible ||
        muted ||
        !foreground ||
        !current ||
        (current.state !== 'running' && current.state !== 'suspended')
      )
        return;
      finishRewardEligible = false;
      clearTimers();
      const operation = ++generation;
      granted = true;
      const play = () => {
        if (disposed || backend !== current || generation !== operation) return;
        resumePending = false;
        clearResumeTimer();
        if (!canPlay()) {
          unavailable();
          return;
        }
        try {
          current.cue('personal-best');
        } catch {
          unavailable();
          return;
        }
        publish('running');
        finishTimer = setTimeout(() => {
          if (disposed || generation !== operation) return;
          finishTimer = undefined;
          stop();
          publish(muted ? 'muted' : 'locked');
        }, AUDIO_VERIFIED_BEST_SUSPEND_MS);
      };
      if (current.state === 'running') {
        play();
        return;
      }
      // Only reawaken the existing gesture-unlocked graph suspended by finish.
      // No backend creation and no attempt to obtain a new user gesture.
      resumePending = true;
      publish('starting');
      resumeTimer = setTimeout(() => {
        if (!disposed && generation === operation) unavailable();
      }, AUDIO_RESUME_TIMEOUT_MS);
      try {
        void current
          .resume()
          .then(play)
          .catch(() => {
            if (!disposed && backend === current && generation === operation)
              unavailable();
          });
      } catch {
        unavailable();
      }
    },
    silence(reason) {
      if (disposed) return;
      if (reason === 'background') foreground = false;
      stop();
      lastFrame = undefined;
      publish(muted ? 'muted' : 'locked');
    },
    dispose() {
      if (closing) return closing;
      if (disposed) return Promise.resolve();
      stop();
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      lastFrame = undefined;
      publish('disposed');
      try {
        closing = backend ? backend.close().catch(() => {}) : Promise.resolve();
      } catch {
        closing = Promise.resolve();
      }
      return closing;
    },
  };
}
