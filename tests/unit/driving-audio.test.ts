import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_FINISH_SUSPEND_MS,
  AUDIO_VERIFIED_BEST_SUSPEND_MS,
  AUDIO_RESUME_TIMEOUT_MS,
  createDrivingAudio,
  type DrivingAudioBackend,
  type DrivingAudioFrame,
  type DrivingAudioStatus,
} from '../../src/client/driving-audio.ts';
import {
  calculateDrivingAudioTargets,
  type DrivingAudioCue,
  type DrivingAudioTargets,
} from '../../src/client/driving-audio-graph.ts';
import { createSimulationState } from '../../src/shared/simulation.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { createRacingState, stepRace } from '../../src/shared/race-rules.ts';
import { generateCurrentDailyCircuit } from '../../src/shared/braking-course-generator';
import { LIFT_REPLAY } from '../../src/shared/fixtures/reference-replays.ts';
import { runReplay } from '../../src/shared/replay.ts';

function deferred() {
  let resolve = (): void => {
    throw new Error('Deferred not initialized');
  };
  let reject = (_error: unknown): void => {
    throw new Error('Deferred not initialized');
  };
  const promise = new Promise<void>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { promise, resolve, reject };
}
class Backend implements DrivingAudioBackend {
  state = 'suspended';
  currentTime = 0;
  resumes = 0;
  suspends = 0;
  closes = 0;
  silences = 0;
  cueActive = false;
  cues: DrivingAudioCue[] = [];
  targets: DrivingAudioTargets[] = [];
  listeners = new Set<() => void>();
  resumeWork: (() => Promise<void>) | undefined;
  setState(value: string): void {
    this.state = value;
    for (const listener of this.listeners) listener();
  }
  resume(): Promise<void> {
    this.resumes++;
    if (this.resumeWork) return this.resumeWork();
    this.setState('running');
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.suspends++;
    this.setState('suspended');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closes++;
    this.setState('closed');
    return Promise.resolve();
  }
  apply(targets: Readonly<DrivingAudioTargets>): void {
    this.targets.push({ ...targets });
  }
  silence(): void {
    this.silences++;
    this.cueActive = false;
  }
  cue(kind: DrivingAudioCue): void {
    this.cues.push(kind);
    this.cueActive = true;
  }
  subscribeState(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
function frame(attemptId = 1): DrivingAudioFrame {
  return {
    attemptId,
    phase: 'racing',
    state: { ...createSimulationState(), tick: 1, speed: 12, slip: 0.5 },
    held: true,
    acceleration: 6,
  };
}
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

void test('audio is lazy, saved mute creates no backend, and unmute alone never grants playback', async () => {
  let creations = 0;
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: true,
    createBackend: () => {
      creations++;
      return backend;
    },
  });
  audio.resetAttempt(1);
  audio.update(frame());
  audio.unlockFromGesture();
  assert.equal(creations, 0);
  assert.equal(audio.status, 'muted');
  audio.setMuted(false);
  assert.equal(creations, 0);
  assert.equal(audio.status, 'locked');
  audio.unlockFromGesture();
  await flush();
  assert.equal(creations, 1);
  assert.equal(audio.status, 'running');
  assert.ok((backend.targets.at(-1)?.engineGain ?? 0) > 0);
  await audio.dispose();
});

void test('targets are finite/bounded and expose real held/slip/off-road/recovery gates', () => {
  const slow = calculateDrivingAudioTargets(
    { ...frame(), state: { ...frame().state, speed: 3, slip: 0 } },
    true
  );
  const fast = calculateDrivingAudioTargets(
    {
      ...frame(),
      state: { ...frame().state, speed: 22, slip: 1, offRoad: true },
    },
    true
  );
  assert.ok(fast.engineHz > slow.engineHz && fast.engineGain > slow.engineGain);
  assert.ok(fast.squealGain > 0 && fast.offRoadGain > 0);
  assert.ok(
    calculateDrivingAudioTargets({ ...frame(), held: false }, true).engineGain <
      calculateDrivingAudioTargets(frame(), true).engineGain
  );
  for (const value of [NaN, Infinity, -Infinity, -1000, 1000]) {
    const targets = calculateDrivingAudioTargets(
      {
        ...frame(),
        acceleration: value,
        state: { ...frame().state, speed: value, slip: value },
      },
      true
    );
    assert.ok(Object.values(targets).every(Number.isFinite));
    assert.ok(targets.engineHz >= 40 && targets.engineHz <= 232);
    assert.ok(targets.engineGain >= 0 && targets.engineGain <= 0.07);
    assert.ok(targets.squealGain >= 0 && targets.squealGain <= 0.07);
  }
  for (const phase of [
    'loading',
    'ready',
    'countdown',
    'finished',
    'abandoned',
  ]) {
    const testFrame = frame();
    if (
      phase === 'loading' ||
      phase === 'ready' ||
      phase === 'countdown' ||
      phase === 'finished' ||
      phase === 'abandoned'
    )
      testFrame.phase = phase;
    const targets = calculateDrivingAudioTargets(testFrame, true);
    assert.equal(
      targets.engineGain + targets.squealGain + targets.offRoadGain,
      0
    );
  }
  assert.equal(calculateDrivingAudioTargets(frame(), false).engineGain, 0);
  assert.equal(
    calculateDrivingAudioTargets(
      { ...frame(), state: { ...frame().state, recovering: true } },
      true
    ).engineGain,
    0
  );
});

void test('twenty attempts reuse one backend/listener, coalesce audio-clock updates and dispose once', async () => {
  const backend = new Backend();
  let creations = 0;
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => {
      creations++;
      return backend;
    },
  });
  for (let attempt = 1; attempt <= 20; attempt++) {
    audio.resetAttempt(attempt);
    audio.unlockFromGesture();
    await flush();
    audio.update(frame(attempt));
    const before = backend.targets.length;
    for (let tick = 0; tick < 120; tick++) {
      backend.currentTime += 1 / 120;
      audio.update({
        ...frame(attempt),
        state: { ...frame().state, tick: tick + 2 },
      });
    }
    assert.ok(backend.targets.length - before <= 30);
    assert.equal(backend.listeners.size, 1);
    audio.silence('abandon');
  }
  assert.equal(creations, 1);
  const one = audio.dispose();
  assert.equal(audio.dispose(), one);
  await one;
  assert.equal(backend.closes, 1);
  assert.equal(backend.listeners.size, 0);
  const calls = backend.resumes;
  audio.unlockFromGesture();
  audio.update(frame());
  assert.equal(backend.resumes, calls);
  assert.equal(audio.status, 'disposed');
});

void test('finish cue survives the same-render finished update and suspends exactly once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  audio.update(frame());
  const silences = backend.silences;
  audio.finish(1);
  audio.update({
    ...frame(),
    phase: 'finished',
    state: { ...frame().state, status: 'finished', finishedTick: 3000 },
  });
  audio.finish(1);
  assert.deepEqual(backend.cues, ['finish']);
  assert.equal(backend.cueActive, true);
  assert.equal(backend.targets.at(-1)?.engineGain, 0);
  assert.equal(backend.silences, silences);
  t.mock.timers.tick(AUDIO_FINISH_SUSPEND_MS - 1);
  assert.equal(backend.cueActive, true);
  t.mock.timers.tick(1);
  assert.equal(backend.cueActive, false);
  assert.equal(backend.state, 'suspended');
  await audio.dispose();
});

void test('retry cancels the old finish suspend and stale frames cannot silence the new attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  audio.update(frame());
  audio.finish(1);
  audio.resetAttempt(2);
  audio.unlockFromGesture();
  await flush();
  audio.update(frame(2));
  const writes = backend.targets.length;
  audio.update({ ...frame(1), phase: 'abandoned' });
  audio.finish(1);
  assert.equal(backend.targets.length, writes);
  t.mock.timers.tick(AUDIO_FINISH_SUSPEND_MS * 2);
  assert.equal(backend.state, 'running');
  assert.equal(audio.status, 'running');
  assert.ok((backend.targets.at(-1)?.engineGain ?? 0) > 0);
  await audio.dispose();
});

void test('mute/background invalidate a pending resume and returning to foreground does not autoplay', async () => {
  for (const cause of ['mute', 'background']) {
    const backend = new Backend();
    const pending = deferred();
    backend.resumeWork = () => pending.promise;
    const audio = createDrivingAudio({
      muted: false,
      createBackend: () => backend,
    });
    audio.resetAttempt(1);
    audio.update(frame());
    audio.unlockFromGesture();
    audio.unlockFromGesture();
    assert.equal(backend.resumes, 1);
    if (cause === 'mute') audio.setMuted(true);
    else audio.setForeground(false);
    backend.setState('running');
    pending.resolve();
    await flush();
    assert.equal(backend.state, 'suspended');
    assert.equal(audio.status, cause === 'mute' ? 'muted' : 'locked');
    if (cause === 'mute') audio.setMuted(false);
    else audio.setForeground(true);
    audio.update(frame());
    assert.equal(backend.state, 'suspended');
    assert.equal(audio.status, 'locked');
    backend.resumeWork = undefined;
    audio.unlockFromGesture();
    await flush();
    assert.equal(backend.state, 'running');
    await audio.dispose();
  }
});

void test('pending activation times out without blocking and a fresh gesture can retry the same context', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const backend = new Backend();
  const pending = deferred();
  backend.resumeWork = () => pending.promise;
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  audio.update(frame());
  assert.equal(audio.status, 'starting');
  t.mock.timers.tick(AUDIO_RESUME_TIMEOUT_MS);
  assert.equal(audio.status, 'unavailable');
  backend.setState('running');
  pending.resolve();
  await flush();
  assert.equal(backend.state, 'suspended');
  backend.resumeWork = undefined;
  audio.unlockFromGesture();
  await flush();
  assert.equal(audio.status, 'running');
  await audio.dispose();
});

void test('old resume rejection cannot overwrite a newer successful attempt and interruption requires another gesture', async () => {
  const backend = new Backend();
  const pending = deferred();
  backend.resumeWork = () => pending.promise;
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  audio.resetAttempt(2);
  backend.resumeWork = undefined;
  audio.unlockFromGesture();
  await flush();
  pending.reject(new Error('Late activation failure'));
  await flush();
  assert.equal(audio.status, 'running');
  backend.setState('interrupted');
  assert.equal(audio.status, 'locked');
  backend.setState('running');
  assert.equal(backend.state, 'suspended');
  audio.unlockFromGesture();
  await flush();
  assert.equal(audio.status, 'running');
  await audio.dispose();
});

void test('recovery cues follow new authoritative count edges and never replay on same-tick redraw or unmute', async () => {
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  audio.update(frame());
  const recovering = {
    ...frame(),
    state: {
      ...frame().state,
      tick: 2,
      recovering: true,
      recoveryTicksRemaining: 119,
      recoveryCount: 1,
    },
  };
  audio.update(recovering);
  audio.update(recovering);
  assert.deepEqual(backend.cues, ['recovery']);
  audio.setMuted(true);
  audio.update({
    ...recovering,
    state: { ...recovering.state, tick: 3, recoveryCount: 2 },
  });
  audio.setMuted(false);
  audio.unlockFromGesture();
  await flush();
  audio.update({
    ...recovering,
    state: { ...recovering.state, tick: 4, recoveryCount: 2 },
  });
  assert.deepEqual(backend.cues, ['recovery']);
  await audio.dispose();
});

void test('missing/rejecting backends and status observers remain nonfatal', async () => {
  const statuses: DrivingAudioStatus[] = [];
  const missing = createDrivingAudio({
    muted: false,
    createBackend: () => {
      throw new Error('Audio unavailable');
    },
    onStatusChange: (status) => {
      statuses.push(status);
      throw new Error('UI failed');
    },
  });
  assert.doesNotThrow(() => {
    missing.resetAttempt(1);
    missing.unlockFromGesture();
    missing.update(frame());
    missing.finish(1);
  });
  assert.ok(statuses.includes('unavailable'));
  await missing.dispose();
  const backend = new Backend();
  backend.resumeWork = () => Promise.reject(new Error('Gesture denied'));
  const rejected = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  rejected.resetAttempt(1);
  rejected.unlockFromGesture();
  await flush();
  assert.equal(rejected.status, 'unavailable');
  await rejected.dispose();
});

void test('disposing during pending activation consumes late completion and removes the only state listener', async () => {
  const backend = new Backend();
  const pending = deferred();
  backend.resumeWork = () => pending.promise;
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.update(frame());
  audio.unlockFromGesture();
  assert.equal(backend.listeners.size, 1);
  await audio.dispose();
  const writes = backend.targets.length;
  pending.resolve();
  await flush();
  assert.equal(audio.status, 'disposed');
  assert.equal(backend.targets.length, writes);
  assert.equal(backend.closes, 1);
  assert.equal(backend.listeners.size, 0);
});

void test('an externally closed context is replaced only by another explicit gesture', async () => {
  const first = new Backend();
  const second = new Backend();
  let creations = 0;
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => (++creations === 1 ? first : second),
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  first.setState('closed');
  assert.equal(audio.status, 'unavailable');
  audio.update(frame());
  assert.equal(creations, 1);
  audio.unlockFromGesture();
  await flush();
  assert.equal(creations, 2);
  assert.equal(first.listeners.size, 0);
  assert.equal(first.closes, 1);
  assert.equal(second.listeners.size, 1);
  assert.equal(audio.status, 'running');
  await audio.dispose();
  assert.equal(second.closes, 1);
});

void test('backward tick frames cannot regress pitch or manufacture another recovery cue', async () => {
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  const current = {
    ...frame(),
    state: {
      ...frame().state,
      tick: 10,
      recovering: true,
      recoveryTicksRemaining: 119,
      recoveryCount: 1,
    },
  };
  audio.update(current);
  const writes = backend.targets.length;
  audio.update({
    ...current,
    state: { ...current.state, tick: 5, speed: 2, recoveryCount: 0 },
  });
  audio.update(current);
  assert.equal(backend.targets.length, writes);
  assert.deepEqual(backend.cues, ['recovery']);
  await audio.dispose();
});

void test('retry preparation can display the old finished tick before countdown zero and audible scored tick one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  audio.update({
    ...frame(),
    state: { ...frame().state, tick: 3214 },
  });
  audio.finish(1);
  audio.resetAttempt(2);
  audio.unlockFromGesture();
  await flush();

  // The next auth request is pending; the visible driver still holds lap one.
  audio.update({
    ...frame(2),
    phase: 'finished',
    state: {
      ...frame().state,
      tick: 3215,
      status: 'finished',
      finishedTick: 3215,
    },
  });
  assert.equal(backend.targets.at(-1)?.engineGain, 0);
  audio.update({
    ...frame(2),
    phase: 'countdown',
    state: createSimulationState(),
  });
  assert.equal(backend.targets.at(-1)?.engineGain, 0);
  audio.update({
    ...frame(2),
    state: { ...frame().state, tick: 1, speed: 10 },
  });
  assert.equal(audio.status, 'running');
  assert.ok((backend.targets.at(-1)?.engineGain ?? 0) > 0);
  assert.deepEqual(backend.cues, ['finish']);
  t.mock.timers.tick(AUDIO_FINISH_SUSPEND_MS * 2);
  assert.equal(
    backend.state,
    'running',
    'prior finish timer remains cancelled'
  );
  await audio.dispose();
});

void test('audio presentation enabled/disabled preserves the complete frozen replay outcome and never mutates state', async () => {
  const track = createOvalTrack();
  const expected = runReplay(track, LIFT_REPLAY);
  for (const enabled of [false, true]) {
    const backend = new Backend();
    const audio = createDrivingAudio({
      muted: !enabled,
      createBackend: () => backend,
    });
    audio.resetAttempt(1);
    audio.unlockFromGesture();
    await flush();
    let race = createRacingState(track),
      held = false,
      event = 0;
    while (race.phase === 'racing') {
      const transition = LIFT_REPLAY.transitions[event];
      if (transition?.tick === race.simulation.tick) {
        held = transition.held;
        event++;
      }
      race = stepRace(track, race, held);
      const frozen = Object.freeze(race.simulation);
      backend.currentTime = frozen.tick / 120;
      audio.update({
        attemptId: 1,
        phase: race.phase,
        state: frozen,
        held,
        acceleration: 0,
      });
    }
    assert.deepEqual(race.simulation, expected.state);
    assert.equal(race.simulation.finishedTick, expected.finishTicks);
    await audio.dispose();
  }
});

void test('countdown emits each number once, distinct GO, and a fresh retry resets it', async () => {
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  for (const seconds of [3, 3, 2, 2, 1, 1, 0, 0]) audio.countdown(1, seconds);
  assert.deepEqual(backend.cues, ['countdown', 'countdown', 'countdown', 'go']);
  audio.countdown(0, 3);
  audio.countdown(1, -1);
  audio.resetAttempt(2);
  audio.unlockFromGesture();
  await flush();
  audio.countdown(2, 3);
  assert.deepEqual(backend.cues, [
    'countdown',
    'countdown',
    'countdown',
    'go',
    'countdown',
  ]);
  await audio.dispose();
});

void test('continuous laps chime once without finishing or suspending, muted cues never replay', async () => {
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  audio.lap(1, 1);
  audio.lap(1, 1);
  audio.lap(0, 2);
  assert.deepEqual(backend.cues, ['lap']);
  assert.equal(backend.suspends, 0);
  audio.setMuted(true);
  audio.lap(1, 2);
  audio.countdown(1, 3);
  audio.countdown(1, 0);
  audio.setMuted(false);
  audio.unlockFromGesture();
  await flush();
  audio.lap(1, 2);
  audio.countdown(1, 0);
  assert.deepEqual(backend.cues, ['lap']);
  audio.lap(1, 3);
  assert.deepEqual(backend.cues, ['lap', 'lap']);
  assert.equal(audio.status, 'running');
  await audio.dispose();
});

void test('landing thumps only follow fresh grounded impact edges, never ready, recovery, redraw or unmute', async () => {
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  function landings(
    tick: number,
    count: number,
    impact = 0.6
  ): DrivingAudioFrame {
    const value = frame();
    value.state = {
      ...value.state,
      tick,
      vertical: {
        height: 0,
        velocity: 0,
        airborne: false,
        landings: count,
        impact,
      },
    };
    return value;
  }
  audio.update(landings(1, 2)); // Initial snapshot is not a landing event.
  audio.update(landings(2, 3));
  audio.update(landings(2, 3));
  audio.update(landings(3, 4, 0));
  const recovering = landings(4, 5);
  recovering.state = { ...recovering.state, recovering: true };
  audio.update(recovering);
  assert.deepEqual(backend.cues, ['landing']);
  audio.setMuted(true);
  audio.update(landings(5, 6));
  audio.setMuted(false);
  audio.unlockFromGesture();
  await flush();
  audio.update(landings(6, 6));
  assert.deepEqual(backend.cues, ['landing']);
  audio.update(landings(7, 7));
  assert.deepEqual(backend.cues, ['landing', 'landing']);
  await audio.dispose();
});

void test('wind rises smoothly only at speed, stays quiet and is gated with driving audio', () => {
  const slow = frame();
  const fast = frame();
  fast.state = { ...fast.state, speed: 30 };
  assert.equal(calculateDrivingAudioTargets(slow, true).windGain, 0);
  assert.equal(calculateDrivingAudioTargets(fast, true).windGain, 0.025);
  assert.equal(calculateDrivingAudioTargets(fast, false).windGain, 0);
  fast.phase = 'countdown';
  assert.equal(calculateDrivingAudioTargets(fast, true).windGain, 0);
  fast.phase = 'racing';
  fast.state = { ...fast.state, recovering: true };
  assert.equal(calculateDrivingAudioTargets(fast, true).windGain, 0);
});

void test('personal-best laps lift once, stay continuous and never replay after mute/background', async () => {
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  audio.lap(1, 1);
  audio.lap(1, 2, true);
  audio.lap(1, 2, true);
  audio.lap(0, 3, true);
  assert.deepEqual(backend.cues, ['lap', 'personal-best']);
  assert.equal(backend.suspends, 0);
  audio.setMuted(true);
  audio.lap(1, 3, true);
  audio.setMuted(false);
  audio.unlockFromGesture();
  await flush();
  audio.lap(1, 3, true);
  audio.setForeground(false);
  audio.lap(1, 4, true);
  audio.setForeground(true);
  audio.unlockFromGesture();
  await flush();
  audio.lap(1, 4, true);
  assert.deepEqual(backend.cues, ['lap', 'personal-best']);
  audio.lap(1, 5, true);
  assert.deepEqual(backend.cues, ['lap', 'personal-best', 'personal-best']);
  assert.equal(audio.status, 'running');
  await audio.dispose();
});

void test('verified lead reuses only the finished gesture-unlocked graph and suspends after its cue', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const backend = new Backend();
  let creates = 0;
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => {
      creates++;
      return backend;
    },
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  audio.finish(1);
  t.mock.timers.tick(AUDIO_FINISH_SUSPEND_MS);
  assert.equal(backend.state, 'suspended');
  audio.verifiedBest(0);
  audio.verifiedBest(1);
  audio.verifiedBest(1);
  await flush();
  assert.deepEqual(backend.cues, ['finish', 'personal-best']);
  assert.equal(creates, 1);
  assert.equal(backend.resumes, 2);
  t.mock.timers.tick(AUDIO_VERIFIED_BEST_SUSPEND_MS - 1);
  assert.equal(backend.state, 'running');
  t.mock.timers.tick(1);
  assert.equal(backend.state, 'suspended');
  await audio.dispose();
});

void test('early verified lead replaces finish timer without resuming, and never creates a locked graph', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.finish(1);
  audio.verifiedBest(1);
  assert.equal(backend.resumes, 0);
  audio.resetAttempt(2);
  audio.unlockFromGesture();
  await flush();
  audio.finish(2);
  audio.verifiedBest(2);
  t.mock.timers.tick(AUDIO_FINISH_SUSPEND_MS);
  assert.equal(backend.state, 'running');
  assert.equal(backend.resumes, 1);
  assert.deepEqual(backend.cues, ['finish', 'personal-best']);
  t.mock.timers.tick(AUDIO_VERIFIED_BEST_SUSPEND_MS);
  assert.equal(backend.state, 'suspended');
  await audio.dispose();
});

for (const action of [
  'mute',
  'background',
  'retry',
  'dispose',
  'timeout',
] as const) {
  void test(`pending verified lead never plays after ${action}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const backend = new Backend();
    const audio = createDrivingAudio({
      muted: false,
      createBackend: () => backend,
    });
    audio.resetAttempt(1);
    audio.unlockFromGesture();
    await flush();
    audio.finish(1);
    t.mock.timers.tick(AUDIO_FINISH_SUSPEND_MS);
    const pending = deferred();
    backend.resumeWork = () => pending.promise;
    audio.verifiedBest(1);
    if (action === 'mute') audio.setMuted(true);
    else if (action === 'background') audio.setForeground(false);
    else if (action === 'retry') audio.resetAttempt(2);
    else if (action === 'dispose') await audio.dispose();
    else t.mock.timers.tick(AUDIO_RESUME_TIMEOUT_MS);
    backend.setState('running');
    pending.resolve();
    await flush();
    assert.deepEqual(backend.cues, ['finish']);
    if (action !== 'dispose') assert.equal(backend.state, 'suspended');
    await audio.dispose();
  });
}

void test('inaudible verified lead is consumed, not queued for returning foreground or unmute', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  audio.finish(1);
  audio.setMuted(true);
  audio.verifiedBest(1);
  audio.setMuted(false);
  audio.unlockFromGesture();
  await flush();
  audio.verifiedBest(1);
  assert.deepEqual(backend.cues, ['finish']);
  await audio.dispose();
});

void test('virtual gears lift revs within a gear and dip on an upshift without changing driving state', () => {
  const atSpeed = (speed: number) => ({
    ...frame(),
    acceleration: 0,
    state: { ...frame().state, speed },
  });
  const low = calculateDrivingAudioTargets(atSpeed(3), true, 0);
  const revved = calculateDrivingAudioTargets(atSpeed(7.4), true, 0);
  const shifted = calculateDrivingAudioTargets(atSpeed(7.4), true, 1);
  assert.ok(revved.engineHz > low.engineHz + 35);
  assert.ok(shifted.engineHz < revved.engineHz - 50);
  assert.equal(shifted.engineGain, revved.engineGain);
});

void test('gear shifts have hysteresis, dwell, no initial cue, and no muted or airborne catch-up burst', async () => {
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  const update = (tick: number, speed: number, airborne = false) => {
    backend.currentTime = tick / 120;
    audio.update({
      ...frame(),
      state: {
        ...frame().state,
        tick,
        speed,
        ...(airborne
          ? {
              vertical: {
                height: 1,
                velocity: 1,
                airborne: true,
                landings: 0,
                impact: 0,
              },
            }
          : {}),
      },
    });
  };
  update(1, 6.8);
  assert.deepEqual(backend.cues, []);
  update(61, 7.4);
  assert.deepEqual(backend.cues, ['shift-up']);
  const postShift = backend.targets.at(-1)?.engineHz ?? 0;
  for (let tick = 62; tick < 190; tick++) update(tick, tick % 2 ? 6.9 : 7.4);
  assert.deepEqual(
    backend.cues,
    ['shift-up'],
    'hovering around the threshold never chatters'
  );
  update(190, 5.6);
  assert.deepEqual(backend.cues, ['shift-up', 'shift-down']);
  assert.ok((backend.targets.at(-1)?.engineHz ?? 0) > postShift);
  update(191, 15);
  assert.equal(backend.cues.length, 2, 'no rapid second shift');
  update(260, 20, true);
  assert.equal(backend.cues.length, 2, 'flight does not shift');
  audio.setMuted(true);
  update(300, 14);
  audio.setMuted(false);
  audio.unlockFromGesture();
  await flush();
  update(301, 14);
  assert.equal(backend.cues.length, 2, 'muted shift is consumed, not queued');
  audio.resetAttempt(2);
  audio.unlockFromGesture();
  await flush();
  audio.update({ ...frame(2), state: { ...frame().state, speed: 21 } });
  assert.equal(
    backend.cues.length,
    2,
    'retry/flying initial snapshot does not replay gears'
  );
  await audio.dispose();
});

void test('engine is deeper and less bright across every gear without raising the mix', () => {
  for (let speed = 0; speed <= 22; speed += 0.5) {
    for (const acceleration of [-10, 0, 7]) {
      const input = {
        ...frame(),
        acceleration,
        state: { ...frame().state, speed },
      };
      const targets = calculateDrivingAudioTargets(input, true);
      assert.ok(targets.engineHz <= 232);
      assert.ok(
        targets.engineFilterHz >= 450 && targets.engineFilterHz <= 1000
      );
      assert.equal(
        targets.engineGain,
        (input.held ? 0.045 : 0.025) + speed * 0.001
      );
      assert.equal(calculateDrivingAudioTargets(input, false).engineGain, 0);
    }
  }
  const idle = calculateDrivingAudioTargets(
    { ...frame(), acceleration: 0, state: { ...frame().state, speed: 0 } },
    true
  );
  const top = calculateDrivingAudioTargets(
    { ...frame(), acceleration: 0, state: { ...frame().state, speed: 22 } },
    true
  );
  assert.equal(idle.engineHz, 44.2);
  assert.ok(Math.abs(top.engineHz - 227.8) < 0.001);
});

void test('only actual reset lifecycle entries sound once, including repeated authoritative recoveries', async () => {
  const backend = new Backend();
  const audio = createDrivingAudio({
    muted: false,
    createBackend: () => backend,
  });
  audio.resetAttempt(1);
  audio.unlockFromGesture();
  await flush();
  // Neither a historical count after recovery nor ordinary grass or jump frames is a new reset.
  for (const state of [
    { ...frame().state, tick: 2, offRoad: true },
    {
      ...frame().state,
      tick: 3,
      vertical: {
        height: 3,
        velocity: 1,
        airborne: true,
        landings: 0,
        impact: 0,
      },
    },
    { ...frame().state, tick: 4, recoveryCount: 1 },
  ])
    audio.update({ ...frame(), state });
  assert.equal(backend.cues.filter((cue) => cue === 'recovery').length, 0);
  audio.resetAttempt(2);
  audio.unlockFromGesture();
  await flush();
  const track = generateCurrentDailyCircuit('daily:t5_kyc33w:2026-11-27').track;
  let race = createRacingState(track);
  while (race.phase === 'racing' && race.simulation.tick < 14400) {
    race = stepRace(track, race, true);
    const next = {
      attemptId: 2,
      phase: race.phase,
      state: race.simulation,
      held: true,
      acceleration: 0,
    };
    audio.update(next);
    audio.update(next); // Render/layout redraw must not duplicate it.
  }
  assert(race.simulation.recoveryCount >= 2);
  assert.equal(
    backend.cues.filter((cue) => cue === 'recovery').length,
    race.simulation.recoveryCount
  );
  await audio.dispose();
});
