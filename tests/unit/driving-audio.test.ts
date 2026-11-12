import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIO_FINISH_SUSPEND_MS,
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
    assert.ok(targets.engineHz >= 50 && targets.engineHz <= 340);
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
    state: { ...frame().state, tick: 2, recovering: true, recoveryCount: 1 },
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
    state: { ...frame().state, tick: 10, recoveryCount: 1 },
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
