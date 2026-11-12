import * as THREE from 'three';
import { SIMULATION_HZ } from '../shared/simulation';
import {
  createSimulationDriver,
  type InterruptionReason,
} from './simulation-driver';
import type { Replay } from '../shared/replay';
import { createRaceCamera } from './race-camera';
import { createCarVisual } from './car-visual';
import { createScenery } from './scenery';
import {
  loadCarAsset,
  loadSceneryAssets,
  disposeSceneAssets,
  type SceneryAssets,
} from './scene-assets';
import { sampleTrack, type Track } from '../shared/track';
import {
  createTrackDebugOverlay,
  createTrackRenderer,
  getTrackBounds,
} from './track-renderer';

export type AttemptPreparation = {
  kind: 'practice' | 'ranked' | 'blocked';
  message: string;
};
export type VerificationOutcome = {
  status: 'verified' | 'rejected' | 'unavailable';
  message: string;
  finishTicks?: number;
};
export type GameSceneHooks = {
  onAttemptStart?: (attempt: { attemptId: number }) => void;
  onResults?: (attempt: {
    attemptId: number;
    mode: 'practice' | 'ranked';
  }) => void;
  beforeStart?: (attempt: {
    attemptId: number;
    signal: AbortSignal;
  }) => Promise<AttemptPreparation>;
  onFinish?: (attempt: {
    attemptId: number;
    replay: Replay;
    finishTicks: number;
  }) => Promise<VerificationOutcome>;
  onAbandon?: (attempt: {
    attemptId: number;
    reason: InterruptionReason;
  }) => void;
};
export type GameSceneOptions = GameSceneHooks & { generated: boolean };

export function initializeGame(track: Track, options: GameSceneOptions): void {
  function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing game element: ${id}`);
    return found;
  }

  const canvas = element('race-canvas');
  if (!(canvas instanceof HTMLCanvasElement))
    throw new Error('Missing race canvas');
  const timer = element('timer');
  const speedLabel = element('speed');
  const raceRoot = element('race');
  const countdown = element('race-countdown');
  const progressElement = element('lap-progress');
  if (!(progressElement instanceof HTMLProgressElement))
    throw new Error('Missing lap progress indicator');
  const lapProgress = progressElement;
  const lapProgressLabel = element('lap-progress-label');
  const card = element('card');
  const cardTitle = element('card-title');
  const cardCopy = element('card-copy');
  const inputLabel = element('status');
  const start = element('start-button');
  const retry = element('retry-button');
  element('mode-label').textContent = import.meta.env.DEV
    ? 'LOCAL · UNRANKED'
    : 'PRACTICE · UNRANKED';

  // Shared fixed-step state drives the car; rendering only interpolates snapshots.
  const bounds = getTrackBounds(track, 0.8);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#65945e');
  const raceCamera = createRaceCamera(track);
  const camera = raceCamera.camera;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
  } catch (error) {
    throw new Error(
      'Your browser could not start the 3D race. Please try a browser with WebGL enabled.',
      { cause: error }
    );
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene.add(new THREE.HemisphereLight('#fff4d8', '#46664f', 2.6));
  const sun = new THREE.DirectionalLight('#fff0cf', 2.1);
  sun.position.set(-30, 80, 30);
  scene.add(sun);

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    new THREE.MeshLambertMaterial({ color: '#65945e' })
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(centerX, -0.05, centerZ);
  scene.add(grass);

  scene.add(createTrackRenderer(track));

  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('debug') === 'track'
  ) {
    scene.add(createTrackDebugOverlay(track));
    const legend = document.createElement('aside');
    legend.id = 'track-debug';
    legend.className = 'track-debug';
    legend.setAttribute('aria-label', 'Canonical track debug legend');
    const widthRange = track.samples.map((sample) => sample.width);
    legend.innerHTML = `
    <strong>CANONICAL TRACK</strong>
    <span class="debug-centerline">Centreline</span>
    <span class="debug-width">Road width</span>
    <span class="debug-normal">Normals</span>
    <span class="debug-curvature">Curvature · yellow → red</span>
    <span class="debug-checkpoint">Checkpoints</span>
    <small>${track.totalLength.toFixed(1)} m · ${track.samples.length} samples ·
      ${Math.min(...widthRange).toFixed(1)}–${Math.max(...widthRange).toFixed(1)} m wide</small>`;
    element('race').append(legend);
  }

  const carVisual = createCarVisual();
  const scenery = createScenery(track);
  scene.add(carVisual.object, scenery.object);
  raceRoot.dataset.carArt = 'fallback';
  raceRoot.dataset.carLoad = 'loading';
  raceRoot.dataset.sceneryArt = 'fallback';

  let racing = false;
  let preparing = false;
  let attemptId = 0;
  let attemptMode: 'practice' | 'ranked' = 'practice';
  let preparation: AbortController | undefined;
  const verification = element('verification-status');
  let pointerHeld = false;
  let keyHeld = false;
  let activePointer: number | undefined;
  const driver = createSimulationDriver(track);
  const hud = element('race-hud');
  const footer = document.querySelector('.race-footer');
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let viewportDirty = true;
  let needsCameraReset = true;
  let pendingCar: THREE.Group | undefined;
  let pendingScenery: SceneryAssets | undefined;
  let destroyed = false;
  let frameHandle = 0;
  let previousFrameTime: number | undefined;

  function applyPendingAssets(): boolean {
    // Read the actual driver now: a Start click can precede the next render.
    if (destroyed || preparing || driver.active) return false;
    let changed = false;
    if (pendingCar) {
      const installed = carVisual.installModel(pendingCar);
      pendingCar = undefined;
      raceRoot.dataset.carArt = carVisual.kind;
      raceRoot.dataset.carLoad = installed ? 'ready' : 'unavailable';
      changed = installed;
    }
    if (pendingScenery) {
      const available = Object.keys(pendingScenery).length;
      const installed = scenery.installAssets(pendingScenery);
      pendingScenery = undefined;
      raceRoot.dataset.sceneryArt = installed
        ? available === 5
          ? 'kenney'
          : 'partial'
        : 'fallback';
      changed = installed || changed;
    }
    return changed;
  }

  function refreshCameraViewport(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const canvasBounds = canvas.getBoundingClientRect();
    const hudBounds = hud.getBoundingClientRect();
    const footerBounds = footer?.getBoundingClientRect();
    const top = Math.max(12, hudBounds.bottom - canvasBounds.top + 8);
    const bottom = footerBounds
      ? Math.max(12, canvasBounds.bottom - footerBounds.top + 8)
      : 36;
    raceRoot.style.setProperty('--hud-bottom', `${top}px`);
    raceCamera.resize({
      width,
      height,
      insets: { top, bottom, left: 12, right: 12 },
    });
    viewportDirty = false;
  }

  function renderReadyArt(): void {
    if (!applyPendingAssets()) return;
    positionCar();
    if (raceCamera.renderable) renderer.render(scene, camera);
  }

  function held(): boolean {
    return (racing || preparing) && (pointerHeld || keyHeld);
  }
  function feedback(): void {
    const state = driver.state;
    const race = driver.raceState;
    if (raceRoot.dataset.phase !== race.phase) viewportDirty = true;
    raceRoot.dataset.phase = race.phase;
    raceRoot.dataset.preparing = String(preparing);
    countdown.hidden = race.phase !== 'countdown';
    if (race.phase === 'countdown') {
      const value = String(
        Math.ceil(race.countdownTicksRemaining / SIMULATION_HZ)
      );
      if (countdown.textContent !== value) countdown.textContent = value;
    }
    const percentage = Math.min(
      100,
      Math.floor((state.distance / track.totalLength) * 100)
    );
    lapProgress.max = track.totalLength;
    lapProgress.value = state.distance;
    lapProgress.textContent = `${percentage}%`;
    lapProgressLabel.textContent = `Gates ${race.nextCheckpointIndex}/${track.checkpoints.length} · ${percentage}%`;
    inputLabel.dataset.held = String(held());
    inputLabel.dataset.condition = state.recovering
      ? 'recovering'
      : state.offRoad
        ? 'off-road'
        : state.slip > 0.05
          ? 'sliding'
          : 'gripping';
    const driveLabel = held() ? 'ACCELERATING' : 'RELEASED · BRAKING';
    const surfaceLabel = state.recovering
      ? 'RECOVERING'
      : state.offRoad
        ? 'OFF ROAD'
        : state.slip > 0.05
          ? 'SLIDING'
          : '';
    inputLabel.textContent = preparing
      ? held()
        ? 'HOLDING · GETTING READY'
        : 'GETTING READY'
      : racing
        ? race.phase === 'countdown'
          ? held()
            ? 'HOLDING · READY TO GO'
            : 'GET READY · HOLD TO GO'
          : `${driveLabel}${surfaceLabel ? ` · ${surfaceLabel}` : ''}`
        : driver.interrupted
          ? 'RACE INTERRUPTED · TRY AGAIN'
          : state.status === 'finished'
            ? 'LAP COMPLETE'
            : 'SPACE OR TOUCH THE TRACK';
  }
  function clearPointer(): void {
    const pointer = activePointer;
    // Clear ownership before capture release can dispatch lostpointercapture.
    activePointer = undefined;
    pointerHeld = false;
    if (pointer !== undefined && canvas.hasPointerCapture(pointer)) {
      canvas.releasePointerCapture(pointer);
    }
  }
  function release(): void {
    keyHeld = false;
    clearPointer();
    feedback();
  }
  function positionCar(deltaSeconds = 0): void {
    const current = driver.state;
    const previous = driver.previousState;
    const alpha = driver.alpha;
    const distance = THREE.MathUtils.lerp(
      previous.distance,
      current.distance,
      alpha
    );
    const lateral = THREE.MathUtils.lerp(
      previous.lateralOffset,
      current.lateralOffset,
      alpha
    );
    const lateralVelocity = THREE.MathUtils.lerp(
      previous.lateralVelocity,
      current.lateralVelocity,
      alpha
    );
    const speed = THREE.MathUtils.lerp(previous.speed, current.speed, alpha);
    const frame = sampleTrack(track, track.startS + distance);
    const velocityX = frame.tx * speed + frame.nx * lateralVelocity;
    const velocityZ = frame.tz * speed + frame.nz * lateralVelocity;
    const heading =
      speed > 0.1 || Math.abs(lateralVelocity) > 0.1
        ? Math.atan2(velocityX, velocityZ)
        : Math.atan2(frame.tx, frame.tz);
    const phase = driver.raceState.phase;
    const scored = phase === 'racing';
    carVisual.update({
      x: frame.x + frame.nx * lateral,
      z: frame.z + frame.nz * lateral,
      heading,
      distance,
      speed,
      acceleration: scored
        ? (current.speed - previous.speed) * SIMULATION_HZ
        : 0,
      lateralAcceleration: scored
        ? (current.lateralVelocity - previous.lateralVelocity) * SIMULATION_HZ
        : 0,
      curvature: frame.curvature,
      slip: THREE.MathUtils.lerp(previous.slip, current.slip, alpha),
      held: held(),
      racing: scored,
      reducedMotion: motionQuery.matches,
      deltaSeconds,
    });
    if (viewportDirty) refreshCameraViewport();
    raceCamera.update(
      { distance, lateralOffset: lateral, heading },
      {
        mode:
          phase === 'countdown' || phase === 'racing' || phase === 'finished'
            ? 'chase'
            : 'overview',
        deltaSeconds,
        reset: needsCameraReset,
      }
    );
    needsCameraReset = false;
  }

  function formatTime(seconds: number): string {
    return seconds.toFixed(3).padStart(6, '0');
  }
  function verificationStatus(state: string, message: string): void {
    verification.dataset.state = state;
    verification.textContent = message;
    verification.hidden = !message;
  }
  function enableAttemptButtons(enabled: boolean): void {
    start.toggleAttribute('disabled', !enabled);
    retry.toggleAttribute('disabled', !enabled);
  }
  function applyVerification(id: number, result: VerificationOutcome): void {
    if (destroyed || id !== attemptId) return;
    verificationStatus(result.status, result.message);
    cardCopy.textContent = result.message;
    if (result.status === 'verified' && result.finishTicks !== undefined) {
      cardTitle.textContent = `${formatTime(result.finishTicks / SIMULATION_HZ)} seconds`;
      element('card-kicker').textContent = 'VERIFIED TIME';
    } else {
      element('card-kicker').textContent = 'LAP COMPLETE · UNVERIFIED';
    }
    options.onResults?.({ attemptId: id, mode: attemptMode });
  }
  function showOutcome(): void {
    if (!racing || driver.active) return;
    racing = false;
    release();
    const state = driver.state;
    if (driver.interrupted) {
      options.onAbandon?.({
        attemptId,
        reason: driver.interruptionReason ?? 'focus',
      });
      verificationStatus(
        'abandoned',
        'Attempt interrupted. This run will not be submitted.'
      );
      cardTitle.textContent = 'Race interrupted.';
      cardCopy.textContent =
        driver.interruptionReason === 'focus'
          ? 'The game lost focus. Try again when you are ready.'
          : driver.interruptionReason === 'time-limit'
            ? 'Practice timed out. Try another run.'
            : driver.interruptionReason === 'invalid-progress'
              ? 'This lap missed a gate. Try another run.'
              : 'The race could not continue smoothly. Try another run.';
      element('card-kicker').textContent = 'ATTEMPT ENDED · UNRANKED';
    } else {
      const finishTicks = state.finishedTick ?? state.tick;
      cardTitle.textContent = `${formatTime(finishTicks / SIMULATION_HZ)} seconds`;
      cardCopy.textContent = 'Practice complete. Find a faster rhythm.';
      element('card-kicker').textContent = 'LAP COMPLETE · UNRANKED';
      if (attemptMode === 'ranked' && options.onFinish) {
        const id = attemptId;
        verificationStatus('pending', 'Checking your time…');
        cardCopy.textContent = 'Checking your time…';
        element('card-kicker').textContent = 'CHECKING TIME';
        const result = { attemptId: id, replay: driver.replay, finishTicks };
        void options
          .onFinish(result)
          .then((outcome) => applyVerification(id, outcome))
          .catch(() => {
            applyVerification(id, {
              status: 'unavailable',
              message:
                'Verification is unavailable. This time remains unverified.',
            });
          });
      } else {
        options.onResults?.({ attemptId, mode: attemptMode });
      }
    }
    start.hidden = true;
    retry.hidden = false;
    card.hidden = false;
    card.scrollTop = 0;
    cardTitle.focus({ preventScroll: true });
  }
  function startCountdown(): void {
    preparing = false;
    preparation = undefined;
    enableAttemptButtons(true);
    const timestamp = performance.now();
    driver.start(timestamp);
    carVisual.reset();
    needsCameraReset = true;
    racing = true;
    driver.setInput(pointerHeld || keyHeld, timestamp);
    raceRoot.dataset.attemptMode = attemptMode;
    card.hidden = true;
    canvas.focus({ preventScroll: true });
    feedback();
    positionCar();
  }
  function preparationBlocked(message: string): void {
    preparing = false;
    preparation = undefined;
    enableAttemptButtons(true);
    release();
    cardTitle.textContent = 'Run could not start.';
    cardCopy.textContent = message;
    verificationStatus('blocked', message);
    start.hidden = true;
    retry.hidden = false;
    card.hidden = false;
    card.scrollTop = 0;
    cardTitle.focus({ preventScroll: true });
  }
  function beginRace(): void {
    if (destroyed || preparing || racing) return;
    renderReadyArt();
    release();
    card.scrollTop = 0;
    attemptId++;
    attemptMode = 'practice';
    options.onAttemptStart?.({ attemptId });
    if (!options.beforeStart) {
      verificationStatus('practice', '');
      startCountdown();
      return;
    }
    const id = attemptId;
    const controller = new AbortController();
    preparation = controller;
    preparing = true;
    cardTitle.textContent = 'Preparing your race…';
    cardCopy.textContent = 'Hold to go. Release to slow when the race begins.';
    element('card-kicker').textContent = 'GETTING READY';
    enableAttemptButtons(false);
    verificationStatus('preparing', 'Preparing your daily race…');
    feedback();
    void options
      .beforeStart({ attemptId: id, signal: controller.signal })
      .then((decision) => {
        if (
          id !== attemptId ||
          controller.signal.aborted ||
          !preparing ||
          document.hidden
        )
          return;
        if (decision.kind === 'blocked') {
          preparationBlocked(decision.message);
          return;
        }
        attemptMode = decision.kind;
        verificationStatus(decision.kind, decision.message);
        startCountdown();
      })
      .catch(() => {
        if (id === attemptId && !controller.signal.aborted)
          preparationBlocked(
            'The run could not be prepared. Please try again.'
          );
      });
  }
  function updateInput(timestamp: number): void {
    if (racing) driver.setInput(pointerHeld || keyHeld, timestamp);
    showOutcome();
    feedback();
  }
  start.addEventListener('click', beginRace);
  retry.addEventListener('click', beginRace);
  canvas.addEventListener('pointerdown', (event) => {
    if (
      (!racing && !preparing) ||
      activePointer !== undefined ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    activePointer = event.pointerId;
    pointerHeld = true;
    canvas.setPointerCapture(event.pointerId);
    updateInput(performance.now());
  });
  canvas.addEventListener('contextmenu', (event) => {
    if (preparing || (racing && driver.active)) event.preventDefault();
  });
  function releasePointer(event: PointerEvent): void {
    if (event.pointerId !== activePointer) return;
    clearPointer();
    updateInput(performance.now());
  }
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('lostpointercapture', releasePointer);
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || (!racing && !preparing)) return;
    event.preventDefault();
    keyHeld = true;
    updateInput(performance.now());
  });
  window.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') return;
    keyHeld = false;
    updateInput(performance.now());
  });
  function interruptRace(): void {
    if (preparing) {
      const id = attemptId;
      preparation?.abort();
      attemptId++;
      preparationBlocked('The game lost focus. Try again when you are ready.');
      verificationStatus(
        'abandoned',
        'Preparation cancelled. This attempt did not start.'
      );
      options.onAbandon?.({ attemptId: id, reason: 'focus' });
      return;
    }
    driver.abandon('focus');
    showOutcome();
    release();
  }
  window.addEventListener('blur', interruptRace);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) interruptRace();
  });

  function resize(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    viewportDirty = true;
    if (width <= 0 || height <= 0) {
      refreshCameraViewport();
      return;
    }
    renderer.setSize(width, height, false);
    // The drawing buffer is cleared even with paused clocks; always redraw it.
    positionCar();
    if (raceCamera.renderable) renderer.render(scene, camera);
  }
  window.addEventListener('resize', resize);
  feedback();
  resize();
  // Daily metadata and asynchronous verification can wrap after initialization.
  // Observe layout changes instead of measuring the HUD on every driving frame.
  const hudObserver = new ResizeObserver(() => {
    if (destroyed) return;
    viewportDirty = true;
    positionCar();
    if (raceCamera.renderable) renderer.render(scene, camera);
  });
  hudObserver.observe(hud);
  if (footer) hudObserver.observe(footer);

  void loadCarAsset()
    .then((template) => {
      if (destroyed) return;
      if (!template) {
        raceRoot.dataset.carLoad = 'unavailable';
        return;
      }
      pendingCar = template;
      renderReadyArt();
    })
    .catch(() => {
      if (!destroyed) raceRoot.dataset.carLoad = 'unavailable';
    });
  void loadSceneryAssets()
    .then((assets) => {
      if (destroyed) return;
      pendingScenery = assets;
      renderReadyArt();
    })
    .catch(() => {});

  function animate(time: number): void {
    if (destroyed) return;
    const deltaSeconds =
      previousFrameTime === undefined
        ? 0
        : Math.min(0.1, Math.max(0, (time - previousFrameTime) / 1000));
    previousFrameTime = time;
    driver.advance(time);
    showOutcome();
    applyPendingAssets();
    feedback();
    positionCar(deltaSeconds);
    const state = driver.state;
    timer.textContent = formatTime(
      (state.finishedTick ?? state.tick) / SIMULATION_HZ
    );
    speedLabel.textContent = String(Math.round(state.speed * 3.6));
    if (raceCamera.renderable) renderer.render(scene, camera);
    frameHandle = requestAnimationFrame(animate);
  }
  frameHandle = requestAnimationFrame(animate);

  window.addEventListener('pagehide', (event) => {
    if (event.persisted || destroyed) return;
    destroyed = true;
    cancelAnimationFrame(frameHandle);
    preparation?.abort();
    hudObserver.disconnect();
    window.removeEventListener('resize', resize);
    carVisual.dispose();
    scenery.dispose();
    scene.remove(carVisual.object, scenery.object);
    disposeSceneAssets();
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          material.dispose();
      }
    });
    renderer.dispose();
  });
}
