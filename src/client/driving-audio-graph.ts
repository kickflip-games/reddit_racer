import type { DrivingAudioFrame } from './driving-audio';

export const AUDIO_GRAPH_NODE_COUNT = 12;
export const AUDIO_GRAPH_BUFFER_COUNT = 1;
export type DrivingAudioTargets = {
  engineHz: number;
  engineFilterHz: number;
  engineGain: number;
  squealHz: number;
  squealGain: number;
  offRoadGain: number;
};
export type DrivingAudioCue =
  'finish' | 'recovery' | 'countdown' | 'go' | 'lap';
export type DrivingAudioGraph = {
  readonly nodeCount: number;
  readonly bufferCount: number;
  apply(targets: Readonly<DrivingAudioTargets>, atSeconds?: number): void;
  silence(atSeconds?: number): void;
  cue(kind: DrivingAudioCue, atSeconds?: number): void;
  dispose(): void;
};

function bounded(value: number, minimum: number, maximum: number): number {
  return Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(value) ? value : minimum)
  );
}

/** Pure presentation targets; no handling constants, clocks, inputs or state writes. */
export function calculateDrivingAudioTargets(
  frame: Readonly<DrivingAudioFrame>,
  audible: boolean
): DrivingAudioTargets {
  const speed = bounded(
    frame.state.speed * (frame.state.vertical ? 22 / 30 : 1),
    0,
    22
  );
  const acceleration = bounded(frame.acceleration, -10, 7);
  const slip = frame.state.vertical?.airborne
    ? 0
    : bounded(frame.state.slip, 0, 1);
  const active =
    audible &&
    frame.phase === 'racing' &&
    frame.state.status === 'running' &&
    !frame.state.recovering;
  return {
    engineHz: bounded(65 + speed * 12 + acceleration * 1.1, 50, 340),
    engineFilterHz: 700 + speed * 45,
    engineGain: active ? (frame.held ? 0.045 : 0.025) + speed * 0.001 : 0,
    squealHz: 1400 + slip * 1300,
    squealGain: active && speed > 3 ? Math.max(0, slip - 0.08) * 0.07 : 0,
    offRoadGain:
      active &&
      !frame.state.vertical?.airborne &&
      frame.state.offRoad &&
      speed > 2
        ? Math.min(0.05, speed * 0.003)
        : 0,
  };
}

/** One fixed 12-node graph and one buffer; shared by real-time and offline checks. */
export function createDrivingAudioGraph(
  context: BaseAudioContext
): DrivingAudioGraph {
  const engine = context.createOscillator();
  const harmonic = context.createOscillator();
  const engineFilter = context.createBiquadFilter();
  const engineGain = context.createGain();
  const noise = context.createBufferSource();
  const squealFilter = context.createBiquadFilter();
  const squealGain = context.createGain();
  const offRoadFilter = context.createBiquadFilter();
  const offRoadGain = context.createGain();
  const result = context.createOscillator();
  const resultGain = context.createGain();
  const master = context.createGain();
  const nodes: AudioNode[] = [
    engine,
    harmonic,
    engineFilter,
    engineGain,
    noise,
    squealFilter,
    squealGain,
    offRoadFilter,
    offRoadGain,
    result,
    resultGain,
    master,
  ];
  const sources: AudioScheduledSourceNode[] = [engine, harmonic, noise, result];
  engine.type = 'sawtooth';
  harmonic.type = 'triangle';
  engine.frequency.value = 65;
  harmonic.frequency.value = 32.5;
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 700;
  engineFilter.Q.value = 0.6;
  squealFilter.type = 'bandpass';
  squealFilter.frequency.value = 1400;
  squealFilter.Q.value = 3;
  offRoadFilter.type = 'lowpass';
  offRoadFilter.frequency.value = 450;
  offRoadFilter.Q.value = 0.7;
  result.type = 'sine';
  result.frequency.value = 440;
  for (const gain of [engineGain, squealGain, offRoadGain, resultGain])
    gain.gain.value = 0;
  master.gain.value = 0.35;
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate),
    context.sampleRate
  );
  const samples = buffer.getChannelData(0);
  let noiseSeed = 0x734812;
  for (let index = 0; index < samples.length; index++) {
    noiseSeed = (Math.imul(noiseSeed, 1664525) + 1013904223) >>> 0;
    samples[index] = (noiseSeed / 4294967296) * 2 - 1;
  }
  noise.buffer = buffer;
  noise.loop = true;
  engine.connect(engineFilter);
  harmonic.connect(engineFilter);
  engineFilter.connect(engineGain).connect(master);
  noise.connect(squealFilter).connect(squealGain).connect(master);
  noise.connect(offRoadFilter).connect(offRoadGain).connect(master);
  result.connect(resultGain).connect(master);
  master.connect(context.destination);
  for (const source of sources) source.start();
  let disposed = false;
  function atTime(value: number): number {
    if (!Number.isFinite(value) || value < 0)
      throw new Error('Audio time must be finite and nonnegative');
    return value;
  }
  function hold(parameter: AudioParam, time: number): void {
    if (typeof parameter.cancelAndHoldAtTime === 'function')
      parameter.cancelAndHoldAtTime(time);
    else {
      parameter.cancelScheduledValues(time);
      parameter.setValueAtTime(parameter.value, time);
    }
  }
  function ramp(parameter: AudioParam, value: number, time: number): void {
    hold(parameter, time);
    parameter.linearRampToValueAtTime(value, time + 0.025);
  }
  return {
    nodeCount: AUDIO_GRAPH_NODE_COUNT,
    bufferCount: AUDIO_GRAPH_BUFFER_COUNT,
    apply(targets, atSeconds = context.currentTime) {
      if (disposed) return;
      const time = atTime(atSeconds);
      ramp(engine.frequency, bounded(targets.engineHz, 50, 340), time);
      ramp(harmonic.frequency, bounded(targets.engineHz, 50, 340) / 2, time);
      ramp(
        engineFilter.frequency,
        bounded(targets.engineFilterHz, 700, 1690),
        time
      );
      ramp(engineGain.gain, bounded(targets.engineGain, 0, 0.07), time);
      ramp(squealFilter.frequency, bounded(targets.squealHz, 1400, 2700), time);
      ramp(squealGain.gain, bounded(targets.squealGain, 0, 0.07), time);
      ramp(offRoadGain.gain, bounded(targets.offRoadGain, 0, 0.05), time);
    },
    silence(atSeconds = context.currentTime) {
      if (disposed) return;
      const time = atTime(atSeconds);
      for (const gain of [engineGain, squealGain, offRoadGain, resultGain]) {
        gain.gain.cancelScheduledValues(time);
        gain.gain.setValueAtTime(0, time);
      }
    },
    cue(kind, atSeconds = context.currentTime) {
      if (disposed) return;
      const time = atTime(atSeconds);
      result.frequency.cancelScheduledValues(time);
      resultGain.gain.cancelScheduledValues(time);
      resultGain.gain.setValueAtTime(0, time);
      if (kind === 'lap' || kind === 'finish') {
        // A soft ascending two-note chime, short enough not to mask the engine.
        for (const { offset, frequency } of [
          { offset: 0, frequency: 660 },
          { offset: 0.11, frequency: 880 },
        ]) {
          result.frequency.setValueAtTime(frequency, time + offset);
          resultGain.gain.setValueAtTime(0, time + offset);
          resultGain.gain.linearRampToValueAtTime(0.07, time + offset + 0.01);
          resultGain.gain.linearRampToValueAtTime(0, time + offset + 0.13);
        }
      } else {
        const frequency = kind === 'countdown' ? 440 : kind === 'go' ? 880 : 90;
        const duration = kind === 'countdown' ? 0.12 : 0.25;
        result.frequency.setValueAtTime(frequency, time);
        if (kind === 'recovery')
          result.frequency.linearRampToValueAtTime(55, time + 0.12);
        resultGain.gain.linearRampToValueAtTime(
          kind === 'recovery' ? 0.05 : 0.08,
          time + 0.01
        );
        resultGain.gain.linearRampToValueAtTime(0, time + duration);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of sources) source.stop();
      for (const node of nodes) node.disconnect();
    },
  };
}
