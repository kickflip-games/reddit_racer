import { expect, test } from '@playwright/test';
import type {
  DrivingAudio,
  DrivingAudioFrame,
} from '../../src/client/driving-audio.ts';

test('BROWSER AUDIO FIXTURE activates the production owner from native gestures and requires reactivation after backgrounding', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/feedback-audio-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BROWSER AUDIO FIXTURE</title><h1>BROWSER AUDIO FIXTURE</h1><p>Native audio API lifecycle with synthetic driving inputs. No race, score or speaker-audibility claim.</p><p id="audio-state" role="status"></p><button id="activate">Activate attempt</button><button id="mute">Mute</button><button id="unmute">Unmute</button><button id="background">Background lifecycle</button><button id="foreground">Return without unlocking</button><button id="dispose">Dispose</button>',
    })
  );
  await page.goto('/feedback-audio-fixture.html');
  await page.evaluate(async () => {
    const audioUrl = '/driving-audio.ts';
    const {
      createDrivingAudio,
    }: typeof import('../../src/client/driving-audio.ts') = await import(
      audioUrl
    );
    // The frame is an explicit presentation input, never an authoritative race result.
    let attempt = 0;
    const status = document.getElementById('audio-state');
    if (!status) throw new Error('Missing audio fixture status');
    const frame = (): DrivingAudioFrame => ({
      attemptId: attempt,
      phase: 'racing',
      state: {
        tick: 1,
        distance: 0,
        speed: 18,
        lateralOffset: 0,
        lateralVelocity: 0,
        slip: 0,
        offRoad: false,
        recovering: false,
        recoveryTicksRemaining: 0,
        recoveryCount: 0,
        finishedTick: null,
        status: 'running',
      },
      held: true,
      acceleration: 2,
    });
    const owner: DrivingAudio = createDrivingAudio({
      muted: false,
      onStatusChange(value) {
        status.textContent = value;
        if (value === 'running') owner?.update(frame());
      },
    });
    status.textContent = owner.status;
    function on(id: string, action: () => void): void {
      const button = document.getElementById(id);
      if (!button) throw new Error(`Missing audio fixture button: ${id}`);
      button.addEventListener('click', action);
    }
    on('activate', () => {
      attempt += 1;
      owner?.resetAttempt(attempt);
      owner?.unlockFromGesture();
      owner?.update(frame());
    });
    on('mute', () => owner?.setMuted(true));
    on('unmute', () => {
      owner?.setMuted(false);
      owner?.unlockFromGesture();
      owner?.update(frame());
    });
    on('background', () => {
      owner?.setForeground(false);
      owner?.silence('background');
    });
    on('foreground', () => {
      owner?.setForeground(true);
      owner?.update(frame());
    });
    on('dispose', () => void owner?.dispose());
  });
  const status = page.locator('#audio-state');
  await expect(status).toHaveText('locked');
  await page.getByRole('button', { name: 'Activate attempt' }).click();
  await expect(status).toHaveText('running');
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(status).toHaveText('muted');
  await page.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect(status).toHaveText('running');
  await page.getByRole('button', { name: 'Background lifecycle' }).click();
  await expect(status).toHaveText('locked');
  await page.getByRole('button', { name: 'Return without unlocking' }).click();
  await expect(status).toHaveText('locked');
  await page.getByRole('button', { name: 'Activate attempt' }).click();
  await expect(status).toHaveText('running');
  await page.getByRole('button', { name: 'Activate attempt' }).click();
  await expect(status).toHaveText('running');
  await page.getByRole('button', { name: 'Dispose' }).click();
  await expect(status).toHaveText('disposed');
  expect(errors).toEqual([]);
});

test('OFFLINE AUDIO FIXTURE renders the production graph with rising engine pitch, bounded signal and a silent muted tail', async ({
  page,
}) => {
  await page.route('**/feedback-offline-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OFFLINE AUDIO FIXTURE</title><h1>OFFLINE AUDIO FIXTURE</h1><p>Production synthesis signal only. No activation, race or speaker-audibility claim.</p>',
    })
  );
  await page.goto('/feedback-offline-fixture.html');
  const signals = await page.evaluate(async () => {
    const graphUrl = '/driving-audio-graph.ts';
    const {
      createDrivingAudioGraph,
      calculateDrivingAudioTargets,
      AUDIO_GRAPH_NODE_COUNT,
      AUDIO_GRAPH_BUFFER_COUNT,
    }: typeof import('../../src/client/driving-audio-graph.ts') = await import(
      graphUrl
    );
    async function render(speed: number, silenceAt?: number) {
      const sampleRate = 24_000;
      const context = new OfflineAudioContext(1, sampleRate, sampleRate);
      const graph = createDrivingAudioGraph(context);
      const frame: DrivingAudioFrame = {
        attemptId: 1,
        phase: 'racing',
        state: {
          tick: 1,
          distance: 0,
          speed,
          lateralOffset: 0,
          lateralVelocity: 0,
          slip: 0,
          offRoad: false,
          recovering: false,
          recoveryTicksRemaining: 0,
          recoveryCount: 0,
          finishedTick: null,
          status: 'running',
        },
        held: true,
        acceleration: 2,
      };
      const targets = calculateDrivingAudioTargets(frame, true);
      graph.apply(targets, 0);
      if (silenceAt !== undefined) graph.silence(silenceAt);
      const buffer = await context.startRendering();
      const samples = buffer.getChannelData(0);
      function metrics(startSeconds: number, endSeconds: number) {
        let peak = 0;
        let energy = 0;
        let crossings = 0;
        const start = Math.floor(startSeconds * sampleRate);
        const end = Math.floor(endSeconds * sampleRate);
        for (let i = start; i < end; i += 1) {
          const sample = samples[i];
          if (sample === undefined || !Number.isFinite(sample))
            throw new Error('Nonfinite production audio sample');
          peak = Math.max(peak, Math.abs(sample));
          energy += sample * sample;
          const previous = samples[i - 1];
          if (previous !== undefined && previous <= 0 && sample > 0)
            crossings += 1;
        }
        return { peak, rms: Math.sqrt(energy / (end - start)), crossings };
      }
      const result = {
        targets,
        nodes: graph.nodeCount,
        buffers: graph.bufferCount,
        active: metrics(0.08, 0.35),
        tail: metrics(0.8, 1),
      };
      graph.dispose();
      return result;
    }
    return {
      expectedNodes: AUDIO_GRAPH_NODE_COUNT,
      expectedBuffers: AUDIO_GRAPH_BUFFER_COUNT,
      low: await render(3),
      high: await render(35),
      muted: await render(35, 0.45),
    };
  });
  for (const signal of [signals.low, signals.high, signals.muted]) {
    expect(signal.nodes).toBe(signals.expectedNodes);
    expect(signal.buffers).toBe(signals.expectedBuffers);
    expect(signal.active.rms).toBeGreaterThan(0.000_01);
    expect(signal.active.peak).toBeLessThan(0.8);
    expect(signal.targets.engineHz).toBeLessThanOrEqual(232);
    expect(signal.targets.engineFilterHz).toBeLessThanOrEqual(1000);
    expect(signal.tail.peak).toBeLessThan(0.8);
  }
  expect(signals.high.targets.engineHz).toBeGreaterThan(
    signals.low.targets.engineHz
  );
  expect(signals.high.active.crossings).toBeGreaterThan(
    signals.low.active.crossings * 1.15
  );
  expect(signals.muted.tail.rms).toBeLessThan(0.000_001);
  await test.info().attach('offline-production-audio-signal', {
    body: JSON.stringify(signals, null, 2),
    contentType: 'application/json',
  });
});

test('OFFLINE race cues have distinct countdown and GO pitch and a bounded two-note lap chime', async ({
  page,
}) => {
  await page.goto('/game.html');
  const cues = await page.evaluate(async () => {
    const url = '/driving-audio-graph.ts';
    const {
      createDrivingAudioGraph,
    }: typeof import('../../src/client/driving-audio-graph.ts') = await import(
      url
    );
    const results = [];
    for (const kind of [
      'countdown',
      'go',
      'lap',
      'landing',
      'shift-up',
      'shift-down',
      'recovery',
    ] as const) {
      const context = new OfflineAudioContext(1, 12000, 24000);
      const graph = createDrivingAudioGraph(context);
      graph.cue(kind, 0);
      const samples = (await context.startRendering()).getChannelData(0);
      let peak = 0;
      let crossings = 0;
      let tail = 0;
      for (let i = 1; i < samples.length; i++) {
        const current = samples[i] ?? 0;
        peak = Math.max(peak, Math.abs(current));
        if (i < 2400 && current > 0 && (samples[i - 1] ?? 0) <= 0) crossings++;
        if (i > 7200) tail = Math.max(tail, Math.abs(current));
      }
      results.push({ kind, peak, crossings, tail });
      graph.dispose();
    }
    return results;
  });
  expect(cues.map((c) => c.kind)).toEqual([
    'countdown',
    'go',
    'lap',
    'landing',
    'shift-up',
    'shift-down',
    'recovery',
  ]);
  for (const cue of cues) {
    expect(cue.peak).toBeGreaterThan(0.01);
    expect(cue.peak).toBeLessThan(0.08);
    if (cue.kind === 'countdown' || cue.kind === 'go')
      expect(cue.peak).toBeGreaterThan(0.045);
    expect(cue.tail).toBeLessThan(0.0001);
  }
  expect(cues[1]!.crossings).toBeGreaterThan(cues[0]!.crossings * 1.8);
});

test('OFFLINE personal-best chime adds a third rising note without a loud or sustained tail', async ({
  page,
}) => {
  await page.goto('/game.html');
  const result = await page.evaluate(async () => {
    const url = '/driving-audio-graph.ts';
    const {
      createDrivingAudioGraph,
    }: typeof import('../../src/client/driving-audio-graph.ts') = await import(
      url
    );
    const captures = [];
    for (const kind of ['lap', 'personal-best'] as const) {
      const context = new OfflineAudioContext(1, 14400, 24000);
      const graph = createDrivingAudioGraph(context);
      graph.cue(kind, 0);
      const data = (await context.startRendering()).getChannelData(0);
      const crossings = [0, 0, 0];
      let peak = 0,
        thirdEnergy = 0,
        tail = 0;
      for (let i = 1; i < data.length; i++) {
        const value = data[i] ?? 0;
        peak = Math.max(peak, Math.abs(value));
        if (i >= 6000 && i < 7920) thirdEnergy += value * value;
        if (i > 9600) tail = Math.max(tail, Math.abs(value));
        for (let note = 0; note < 3; note++) {
          const start = Math.round((note * 0.11 + 0.02) * 24000);
          if (
            i >= start &&
            i < start + 1680 &&
            value > 0 &&
            (data[i - 1] ?? 0) <= 0
          )
            crossings[note] = (crossings[note] ?? 0) + 1;
        }
      }
      captures.push({
        peak,
        thirdEnergy,
        tail,
        crossings,
        nodes: graph.nodeCount,
      });
      graph.dispose();
    }
    return captures;
  });
  const [ordinary, best] = result;
  expect(best!.nodes).toBe(ordinary!.nodes);
  expect(best!.peak).toBeGreaterThan(ordinary!.peak);
  expect(best!.peak).toBeLessThan(0.04);
  expect(best!.thirdEnergy).toBeGreaterThan(ordinary!.thirdEnergy + 0.01);
  expect(best!.crossings[1]).toBeGreaterThan(best!.crossings[0]!);
  expect(best!.crossings[2]).toBeGreaterThan(best!.crossings[1]!);
  expect(best!.tail).toBeLessThan(0.0001);
});

test('BROWSER AUDIO FIXTURE delayed verified lead resumes the existing real context and respects mute/background', async ({
  page,
}) => {
  await page.route('**/verified-audio-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verified audio fixture</title><button id="activate">Activate</button><button id="finish">Finish and await verification</button><button id="mute">Mute</button><button id="background">Background</button><button id="return">Return without unlocking</button><p id="state"></p>',
    })
  );
  await page.goto('/verified-audio-fixture.html');
  await page.evaluate(async () => {
    const ownerUrl = '/driving-audio.ts';
    const graphUrl = '/driving-audio-graph.ts';
    const {
      createDrivingAudio,
    }: typeof import('../../src/client/driving-audio.ts') = await import(
      ownerUrl
    );
    const {
      createDrivingAudioGraph,
    }: typeof import('../../src/client/driving-audio-graph.ts') = await import(
      graphUrl
    );
    const observed = document.documentElement;
    const state = document.getElementById('state')!;
    let attempt = 0,
      contexts = 0,
      resumes = 0,
      verifications = 0;
    const cues: string[] = [];
    // Real native AudioContext and production DSP graph, with lifecycle/cue
    // telemetry at the injectable boundary. No speaker-audibility claim.
    const owner = createDrivingAudio({
      muted: false,
      onStatusChange: (value) => {
        state.textContent = value;
      },
      createBackend: () => {
        const context = new AudioContext();
        const graph = createDrivingAudioGraph(context);
        observed.dataset.contexts = String(++contexts);
        return {
          get state() {
            return context.state;
          },
          get currentTime() {
            return context.currentTime;
          },
          resume() {
            observed.dataset.resumes = String(++resumes);
            return context.resume();
          },
          suspend: () => context.suspend(),
          close() {
            graph.dispose();
            return context.close();
          },
          apply: (targets) => graph.apply(targets),
          silence: () => graph.silence(),
          cue(kind, strength) {
            cues.push(kind);
            observed.dataset.cues = JSON.stringify(cues);
            graph.cue(kind, undefined, strength);
          },
          subscribeState(listener) {
            context.addEventListener('statechange', listener);
            return () => context.removeEventListener('statechange', listener);
          },
        };
      },
    });
    state.textContent = owner.status;
    document.getElementById('activate')!.addEventListener('click', () => {
      owner.setMuted(false);
      owner.setForeground(true);
      owner.resetAttempt(++attempt);
      owner.unlockFromGesture();
    });
    document.getElementById('finish')!.addEventListener('click', () => {
      const id = attempt;
      owner.finish(id);
      setTimeout(() => {
        // Confirmation is asynchronous, not inside another activation click.
        owner.verifiedBest(id);
        owner.verifiedBest(id);
        observed.dataset.verifications = String(++verifications);
      }, 650);
    });
    document
      .getElementById('mute')!
      .addEventListener('click', () => owner.setMuted(true));
    document
      .getElementById('background')!
      .addEventListener('click', () => owner.setForeground(false));
    document.getElementById('return')!.addEventListener('click', () => {
      owner.setMuted(false);
      owner.setForeground(true);
      owner.verifiedBest(attempt);
    });
    window.addEventListener('pagehide', () => {
      void owner.dispose();
    });
  });
  const state = page.locator('#state');
  const root = page.locator('html');
  await page.locator('#activate').click();
  await expect(state).toHaveText('running');
  await page.locator('#finish').click();
  await expect(root).toHaveAttribute('data-verifications', '1');
  await expect(root).toHaveAttribute(
    'data-cues',
    JSON.stringify(['finish', 'personal-best'])
  );
  await expect(root).toHaveAttribute('data-contexts', '1');
  await expect(root).toHaveAttribute('data-resumes', '2');
  await expect(state).toHaveText('locked');
  for (const [index, interruption] of ['mute', 'background'].entries()) {
    await page.locator('#activate').click();
    await expect(state).toHaveText('running');
    await page.locator('#finish').click();
    await page.locator(`#${interruption}`).click();
    await expect(root).toHaveAttribute('data-verifications', String(index + 2));
    await page.locator('#return').click();
    await expect(state).toHaveText('locked');
    await expect(root).toHaveAttribute(
      'data-cues',
      JSON.stringify([
        'finish',
        'personal-best',
        ...Array(index + 1).fill('finish'),
      ])
    );
  }
  await expect(root).toHaveAttribute('data-contexts', '1');
  await expect(root).toHaveAttribute('data-resumes', '4');
});
