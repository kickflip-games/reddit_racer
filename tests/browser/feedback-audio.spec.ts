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
