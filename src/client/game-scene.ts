import {
  createGhostStore,
  MAX_GHOST_POINTS,
  type GhostPoint,
} from './best-ghost';
import { createGhostVisual } from './ghost-visual';
import { addToonLighting } from './toon-material';
import {
  createPracticeBestStore,
  practiceBestKey,
  type LocalBestResult,
} from './practice-best';
import * as THREE from 'three';
import { SIMULATION_HZ } from '../shared/simulation';
import {
  createSimulationDriver,
  type InterruptionReason,
} from './simulation-driver';
import { createPracticeDriver } from './practice-driver';
import type { Replay } from '../shared/replay';
import { createRaceCamera } from './race-camera';
import { createCircuitMinimap } from './circuit-minimap';
import { createCarVisual } from './car-visual';
import { createLandingFeedback } from './landing-feedback';
import { createScenery } from './scenery';
import { generateSceneryLayout, groundHeightAt } from './scenery-layout';
import { createVegetation } from './vegetation';
import { readSceneryOptions } from './scenery-options';
import { getGameRenderer, releaseGameScene } from './game-renderer';
import { createEnvironment } from './environment';
import { createDrivingVfx } from './driving-vfx';
import { createDrivingAudio, type DrivingAudioStatus } from './driving-audio';
import { createFeedbackPreferences } from './feedback-preferences';
import {
  createResolutionObserver,
  resolveRenderPixelRatio,
  resolveRenderViewport,
  type RenderViewport,
} from './render-viewport';
import { createSceneAssetCache, type SceneryAssets } from './scene-assets';
import { sampleTrack, type Track } from '../shared/track';
import { createTrackDebugOverlay, createTrackRenderer } from './track-renderer';

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
export type GameSceneOptions = GameSceneHooks & {
  generated: boolean;
  continuousPractice?: boolean;
};
export type GameSceneController = {
  dispose(): void;
  celebrateVerifiedLeader(attemptId: number): void;
};

export function initializeGame(
  track: Track,
  options: GameSceneOptions
): GameSceneController {
  const lifetime = new AbortController();
  const eventOptions = { signal: lifetime.signal };
  const sceneAssets = createSceneAssetCache();
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
  const minimap = createCircuitMinimap(element('circuit-minimap'), track);
  const countdown = element('race-countdown');
  const progressElement = element('lap-progress');
  if (!(progressElement instanceof HTMLProgressElement))
    throw new Error('Missing lap progress indicator');
  const lapProgress = progressElement;
  const lapProgressLabel = element('lap-progress-label');
  const card = element('card');
  const cardTitle = element('card-title');
  const cardCopy = element('card-copy');
  const viewportMessage = element('viewport-message');
  const inputLabel = element('status');
  const start = element('start-button');
  const retry = element('retry-button');
  const restart = element('restart-button');
  const soundToggle = element('sound-toggle');
  const soundFeedback = element('sound-feedback');
  const settingsElement = element('race-settings');
  if (!(settingsElement instanceof HTMLDetailsElement))
    throw new Error('Missing race settings');
  const settings = settingsElement;
  const dialogElement = element('settings-dialog');
  if (!(dialogElement instanceof HTMLDialogElement))
    throw new Error('Missing settings dialog');
  const settingsDialog = dialogElement;
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    /* Session bests remain available. */
  }
  const localBests = createPracticeBestStore(storage);
  const localBestKey = practiceBestKey(track, options);
  const ghostStore = createGhostStore(storage);
  let ghostLap = ghostStore.get(localBestKey);
  // Old best times have no trajectory. Do not mislabel a slower new lap as best.
  if (ghostLap?.ticks !== localBests.best(localBestKey)) ghostLap = null;
  let ghostPoints: GhostPoint[] = [];
  let ghostOverflow = false;
  let ghostEnabled = true;
  try {
    ghostEnabled = storage?.getItem('reddit-racer.ghost-enabled') !== 'false';
  } catch {
    /* Default on. */
  }
  const ghostToggle = element('ghost-toggle');
  ghostToggle.hidden = !options.continuousPractice;
  function showGhostToggle() {
    ghostToggle.setAttribute('aria-pressed', String(ghostEnabled));
    ghostToggle.textContent = ghostEnabled
      ? 'Best lap ghost on'
      : 'Best lap ghost off';
  }
  showGhostToggle();
  ghostToggle.addEventListener(
    'click',
    () => {
      ghostEnabled = !ghostEnabled;
      showGhostToggle();
      try {
        storage?.setItem('reddit-racer.ghost-enabled', String(ghostEnabled));
      } catch {
        /* Session preference. */
      }
    },
    eventOptions
  );
  let seenPracticeLaps = 0;
  let lapNoticeUntil = 0;
  function showLocalBest(): void {
    const best = localBests.best(localBestKey);
    const label = element('practice-best-lap');
    label.hidden = best === null && !options.continuousPractice;
    if (
      best !== null &&
      card.dataset.result !== 'true' &&
      !options.beforeStart
    ) {
      element('practice-result').hidden = false;
      element('practice-result').textContent =
        `Best ${formatTime(best / SIMULATION_HZ)} s`;
    }
    label.textContent =
      best === null ? 'Best —' : `Best ${formatTime(best / SIMULATION_HZ)} s`;
  }
  function recordLocalLap(ticks: number): LocalBestResult {
    const result = localBests.record(localBestKey, ticks);
    showLocalBest();
    return result;
  }
  function localResultText(result: LocalBestResult, ticks: number): string {
    const delta = ticks - result.bestTicks;
    return `Best ${formatTime(result.bestTicks / SIMULATION_HZ)} s${delta > 0 ? ` · +${formatTime(delta / SIMULATION_HZ)} s` : ''}`;
  }
  function showFinishTime(ticks: number): void {
    card.dataset.result = 'true';
    element('finish-value').textContent = formatTime(ticks / SIMULATION_HZ);
    element('finish-time').hidden = false;
  }
  function closeSettings(): void {
    settings.open = false;
    if (settingsDialog.open) settingsDialog.close();
    raceRoot.dataset.settingsOpen = 'false';
  }
  function openSettings(): void {
    settings.open = true;
    release();
    if (driver.active) driver.setInput(false, performance.now());
    raceRoot.dataset.settingsOpen = 'true';
    if (!settingsDialog.open) settingsDialog.showModal();
    element('settings-close').focus({ preventScroll: true });
  }
  settings.querySelector('summary')?.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      if (settingsDialog.open) closeSettings();
      else openSettings();
    },
    eventOptions
  );
  settings.addEventListener(
    'toggle',
    () => {
      if (settings.open && !settingsDialog.open) openSettings();
      else if (!settings.open) closeSettings();
    },
    eventOptions
  );
  settingsDialog.addEventListener(
    'cancel',
    (event) => {
      event.preventDefault();
      closeSettings();
    },
    eventOptions
  );
  element('settings-close').addEventListener(
    'click',
    closeSettings,
    eventOptions
  );
  settingsDialog.addEventListener(
    'close',
    () => {
      if (settingsDialog.open) return; // Ignore a queued close from an earlier opening.
      const wasOpen = settings.open;
      settings.open = false;
      raceRoot.dataset.settingsOpen = 'false';
      if (wasOpen)
        settings.querySelector('summary')?.focus({ preventScroll: true });
    },
    eventOptions
  );
  settingsDialog.addEventListener(
    'click',
    (event) => {
      if (event.target === settingsDialog) {
        const bounds = settingsDialog.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          closeSettings();
      }
    },
    eventOptions
  );
  showLocalBest();
  if (!(soundToggle instanceof HTMLButtonElement))
    throw new Error('Missing sound control');
  element('mode-label').textContent = import.meta.env.DEV
    ? 'Unranked'
    : 'Unranked';

  // Shared fixed-step state drives the car; rendering only interpolates snapshots.
  const scene = new THREE.Scene();
  // The uniformly lit field receives no shadows; match it with the clear color
  // to avoid a redundant full-screen ground draw on every racing frame.
  scene.background = new THREE.Color('#62ab73');
  const jumps = track.jumps ?? [];
  const countryside = generateSceneryLayout(track, {
    ...readSceneryOptions(),
    jumps,
  });
  scene.add(createEnvironment(track, countryside.props, countryside));
  const vegetation = createVegetation(countryside);
  scene.add(vegetation.object);
  const raceCamera = createRaceCamera(track);
  const camera = raceCamera.camera;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = getGameRenderer(canvas);
  } catch (error) {
    throw new Error(
      'Your browser could not start the 3D race. Please try a browser with WebGL enabled.',
      { cause: error }
    );
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  addToonLighting(scene);

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
  const landingFeedback = createLandingFeedback();
  // The intended Kenney model is required. Never race with placeholder art.
  carVisual.object.visible = false;
  let carLoadState: 'loading' | 'ready' | 'unavailable' = 'loading';
  const carLoadStatus = document.createElement('p');
  carLoadStatus.id = 'car-load-status';
  carLoadStatus.setAttribute('role', 'status');
  const carLoadRetry = document.createElement('button');
  carLoadRetry.id = 'car-load-retry';
  carLoadRetry.type = 'button';
  carLoadRetry.textContent = 'Retry car load';
  carLoadRetry.hidden = true;
  start.before(carLoadStatus, carLoadRetry);
  let racingViewport:
    { width: number; height: number; top: number } | undefined;
  const scenery = createScenery(track, countryside);
  const drivingVfx = createDrivingVfx(track, {
    followContactHeight: true,
  });
  const ghostVisual = createGhostVisual();
  scene.add(ghostVisual.object);
  const rearLeft = new THREE.Vector3();
  const rearRight = new THREE.Vector3();
  scene.add(carVisual.object, scenery.object, drivingVfx.object);
  raceRoot.dataset.carArt = 'loading';
  raceRoot.dataset.carLoad = 'loading';
  raceRoot.dataset.sceneryArt = 'fallback';
  raceRoot.dataset.sceneryVersion = countryside.version;
  raceRoot.dataset.vegetationCount = String(countryside.plants.length);
  raceRoot.dataset.sceneryCandidates = String(countryside.work.candidates);

  let racing = false;
  let preparing = false;
  let attemptId = 0;
  let attemptMode: 'practice' | 'ranked' = 'practice';
  let preparation: AbortController | undefined;
  const verification = element('verification-status');
  let pointerHeld = false;
  let keyHeld = false;
  let activePointer: number | undefined;
  const rankedDriver = createSimulationDriver(track);
  const practiceDriver = options.continuousPractice
    ? createPracticeDriver(track)
    : null;
  const driver = practiceDriver ?? rankedDriver;
  const hud = element('race-hud');
  const footer = document.querySelector('.race-footer');
  let viewportDirty = true;
  let needsCameraReset = true;
  let pendingCar: THREE.Group | undefined;
  let pendingScenery: SceneryAssets | undefined;
  let destroyed = false;
  let frameHandle = 0;
  let previousFrameTime: number | undefined;
  let sceneReady = false;
  let sceneDirty = true;
  let renderViewport: RenderViewport | undefined;
  let viewportUsable = true;
  const preferences = createFeedbackPreferences();
  function showSoundState(status: DrivingAudioStatus): void {
    if (destroyed) return;
    const messages: Record<DrivingAudioStatus, string> = {
      locked: '',
      starting: '',
      running: '',
      muted: '',
      unavailable: 'Sound unavailable',
      disposed: '',
    };
    raceRoot.dataset.audioState = status;
    soundFeedback.dataset.state = status;
    soundFeedback.textContent = messages[status];
  }
  const audio = createDrivingAudio({
    muted: preferences.snapshot.muted,
    onStatusChange: showSoundState,
  });
  audio.setForeground(!document.hidden);
  showSoundState(audio.status);
  const unsubscribePreferences = preferences.subscribe((snapshot) => {
    if (destroyed) return;
    audio.setMuted(snapshot.muted);
    soundToggle.setAttribute('aria-pressed', String(!snapshot.muted));
    soundToggle.textContent = snapshot.muted ? 'Sound off' : 'Sound on';
    raceRoot.dataset.reducedMotion = String(snapshot.reducedMotion);
    raceRoot.dataset.motionPreference = snapshot.motion;
    if (snapshot.reducedMotion) drivingVfx.reset();
    viewportDirty = true;
    if (sceneReady) {
      sceneDirty = true;
      positionCar();
      renderScene();
    }
  });
  soundToggle.disabled = false;
  soundToggle.addEventListener(
    'click',
    () => {
      preferences.setMuted(!preferences.snapshot.muted);
      if (!preferences.snapshot.muted) {
        audio.setForeground(!document.hidden);
        audio.unlockFromGesture();
      }
    },
    eventOptions
  );
  function applyPendingAssets(): boolean {
    // Read the actual driver now: a Start click can precede the next render.
    if (destroyed || preparing || driver.active) return false;
    let changed = false;
    if (pendingCar && carLoadState !== 'ready') {
      const installed = carVisual.installModel(pendingCar);
      if (installed) ghostVisual.installModel(pendingCar);
      pendingCar = undefined;
      carVisual.object.visible = installed;
      raceRoot.dataset.carArt = installed ? carVisual.kind : 'unavailable';
      setCarLoadState(installed ? 'ready' : 'unavailable');
      changed = true;
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
    // Results are an overlay, not a request to move the track out of the way.
    // The default one-lap race is no longer active when its results appear.
    const chaseLayout = driver.active || driver.raceState.phase === 'finished';
    const cardBounds =
      card.hidden || chaseLayout ? null : card.getBoundingClientRect();
    let top = Math.max(12, hudBounds.bottom - canvasBounds.top + 8);
    if (chaseLayout) {
      // Lap/best labels resize the HUD at the finish line. They must not move
      // the world underneath the car. Only a real viewport resize refits it.
      if (racingViewport?.width === width && racingViewport.height === height)
        top = racingViewport.top;
      else racingViewport = { width, height, top };
    } else racingViewport = undefined;
    const portrait = width <= 700 && height > 480;
    const bottom =
      portrait && cardBounds
        ? Math.max(20, canvasBounds.bottom - cardBounds.top + 14)
        : 28;
    const left = !portrait && cardBounds ? cardBounds.right + 24 : 14;
    raceRoot.style.setProperty('--hud-bottom', `${top}px`);
    raceRoot.style.setProperty('--footer-inset', `${bottom}px`);
    const changed = raceCamera.resize({
      width,
      height,
      insets: { top, bottom, left, right: 14 },
    });
    sceneDirty ||= changed;
    viewportDirty = false;
  }

  function renderScene(active = false): void {
    if (!viewportUsable || !raceCamera.renderable || (!active && !sceneDirty))
      return;
    renderer.render(scene, camera);
    raceRoot.dataset.drawCalls = String(renderer.info.render.calls);
    raceRoot.dataset.triangles = String(renderer.info.render.triangles);
    sceneDirty = false;
  }

  function renderReadyArt(): void {
    if (!applyPendingAssets()) return;
    sceneDirty = true;
    positionCar();
    renderScene();
  }

  function held(): boolean {
    return (racing || preparing) && (pointerHeld || keyHeld);
  }
  function feedback(): void {
    // boot() may finish its course setup after initializeGame; the asset gate
    // remains authoritative even if that code enables the Start button.
    if (carLoadState !== 'ready') enableAttemptButtons(false);
    const state = driver.state;
    element('practice-best-lap').hidden =
      attemptMode === 'ranked' ||
      (!practiceDriver && localBests.best(localBestKey) === null);
    raceRoot.dataset.surface = state.offRoad ? 'grass' : 'dry';
    raceRoot.dataset.gripModel = 'progressive-slip';
    raceRoot.dataset.lateralOffset = String(state.lateralOffset);
    const race = driver.raceState;
    timer.textContent = formatTime(
      (practiceDriver
        ? practiceDriver.lapTicks
        : (state.finishedTick ?? state.tick)) / SIMULATION_HZ
    );
    if (practiceDriver) {
      const completed = practiceDriver.completedLaps;
      if (
        completed > seenPracticeLaps &&
        practiceDriver.lastLapTicks !== null
      ) {
        const result = recordLocalLap(practiceDriver.lastLapTicks);
        const seam = sampleTrack(track, track.startS);
        const end: GhostPoint = [
          practiceDriver.lastLapTicks,
          seam.x + seam.nx * state.lateralOffset,
          practiceDriver.elevation,
          seam.z + seam.nz * state.lateralOffset,
        ];
        if (
          !ghostOverflow &&
          ghostPoints.length > 1 &&
          result.bestTicks === practiceDriver.lastLapTicks
        ) {
          ghostStore.save(localBestKey, {
            ticks: practiceDriver.lastLapTicks,
            points: [...ghostPoints, end],
          });
          ghostLap = ghostStore.get(localBestKey);
        }
        if (ghostLap?.ticks !== result.bestTicks) ghostLap = null;
        ghostPoints = [[0, end[1], end[2], end[3]]];
        ghostOverflow = false;
        const improved = result.isNewBest && result.previousBestTicks !== null;
        audio.lap(attemptId, completed, improved);
        const notice = element('practice-lap-notice');
        notice.dataset.kind = improved ? 'best' : 'lap';
        notice.textContent = `${improved ? 'Personal best!' : result.previousBestTicks === null ? 'First lap banked' : 'Lap complete'} · ${formatTime(practiceDriver.lastLapTicks / SIMULATION_HZ)} s`;
        // Presentation only: neither pause nor restart the continuing driver.
        lapNoticeUntil = performance.now() + (improved ? 2400 : 1600);
      }
      seenPracticeLaps = completed;
      if (race.phase === 'racing') {
        const ticks = practiceDriver.lapTicks;
        if (!ghostPoints.length) {
          const first = sampleTrack(track, track.startS);
          ghostPoints.push([0, first.x, first.y ?? 0, first.z]);
        }
        if (ticks - ghostPoints[ghostPoints.length - 1]![0] >= 12) {
          const frame = sampleTrack(track, track.startS + state.distance);
          const x = frame.x + frame.nx * state.lateralOffset,
            z = frame.z + frame.nz * state.lateralOffset;
          const y = practiceDriver.elevation;
          if (ghostPoints.length < MAX_GHOST_POINTS - 1)
            ghostPoints.push([ticks, x, y, z]);
          else ghostOverflow = true;
        }
      }
      ghostVisual.update(
        ghostLap,
        practiceDriver.lapTicks,
        ghostEnabled && race.phase === 'racing'
      );
      raceRoot.dataset.ghostVisible = String(ghostVisual.object.visible);
      raceRoot.dataset.ghostBestTicks = String(ghostLap?.ticks ?? '');
      element('practice-lap-notice').hidden =
        race.phase !== 'racing' || performance.now() >= lapNoticeUntil;
      raceRoot.dataset.practiceLaps = String(completed);
      element('mode-label').textContent = `Lap ${completed + 1}`;
      const last = element('practice-last-lap');
      last.hidden = false;
      const message =
        practiceDriver.lastLapTicks === null
          ? 'Last —'
          : `Last ${formatTime(practiceDriver.lastLapTicks / SIMULATION_HZ)}`;
      if (last.textContent !== message) last.textContent = message;
    }
    speedLabel.textContent = String(Math.round(state.speed * 3.6));
    if (raceRoot.dataset.phase !== race.phase) {
      viewportDirty = true;
      sceneDirty = true;
    }
    raceRoot.dataset.phase = race.phase;
    raceRoot.dataset.preparing = String(preparing);
    if (race.phase === 'countdown' || race.phase === 'racing') {
      audio.countdown(
        attemptId,
        race.phase === 'countdown'
          ? Math.ceil(race.countdownTicksRemaining / SIMULATION_HZ)
          : 0
      );
    }
    countdown.hidden = race.phase !== 'countdown';
    if (race.phase === 'countdown') {
      const value = String(
        Math.ceil(race.countdownTicksRemaining / SIMULATION_HZ)
      );
      if (countdown.textContent !== value) countdown.textContent = value;
    }
    const lapDistance = practiceDriver
      ? Math.max(
          0,
          state.distance - practiceDriver.completedLaps * track.totalLength
        )
      : state.distance;
    const percentage = Math.min(
      100,
      Math.floor((lapDistance / track.totalLength) * 100)
    );
    minimap.update({
      phase: race.phase,
      distance: state.distance,
      completedLaps: practiceDriver?.completedLaps ?? 0,
    });
    lapProgress.max = track.totalLength;
    lapProgress.value = lapDistance;
    lapProgress.textContent = `${percentage}%`;
    lapProgressLabel.textContent = `Gates ${race.nextCheckpointIndex}/${track.checkpoints.length} · ${percentage}%`;
    inputLabel.dataset.held = String(held());
    inputLabel.dataset.condition = practiceDriver?.airborne
      ? 'airborne'
      : state.recovering
        ? 'recovering'
        : state.offRoad
          ? 'off-road'
          : state.slip > 0.05
            ? 'sliding'
            : 'gripping';
    const driveLabel = held() ? 'ACCELERATING' : 'RELEASED · BRAKING';
    const surfaceLabel = practiceDriver?.airborne
      ? 'AIRBORNE'
      : state.recovering
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
    const trajectoryHeading =
      speed > 0.1 || Math.abs(lateralVelocity) > 0.1
        ? Math.atan2(velocityX, velocityZ)
        : needsCameraReset
          ? Math.atan2(frame.tx, frame.tz)
          : carVisual.object.rotation.y;
    // A stopped/sliding car has no new travel direction. Keep its last facing
    // instead of snapping it back to the road tangent when speed crosses 0.1.
    // Retry explicitly resets the pose; scored motion and steering are untouched.
    const heading = trajectoryHeading;
    const phase = driver.raceState.phase;
    const scored = phase === 'racing';
    const acceleration = scored
      ? (current.speed - previous.speed) * SIMULATION_HZ
      : 0;
    const throttle = held();
    const reducedMotion = preferences.snapshot.reducedMotion;
    let elevation = current.vertical
      ? THREE.MathUtils.lerp(
          previous.vertical?.height ?? 0,
          current.vertical.height,
          alpha
        )
      : (practiceDriver?.elevation ?? 0);
    const verticalVelocity = current.vertical
      ? THREE.MathUtils.lerp(
          previous.vertical?.velocity ?? 0,
          current.vertical.velocity,
          alpha
        )
      : (practiceDriver?.verticalVelocity ?? 0);
    const airborne =
      current.vertical?.airborne ?? practiceDriver?.airborne ?? false;
    const worldX = frame.x + frame.nx * lateral,
      worldZ = frame.z + frame.nz * lateral;
    const ground = groundHeightAt(countryside.surface, worldX, worldZ);
    const gap =
      jumps.some((j) => frame.s > j.takeoff && frame.s < j.landing) ?? false;
    const deckHeight = frame.y ?? 0;
    const onDeck =
      Math.abs(lateral) <= frame.halfWidth + (current.vertical ? 0 : 0.8) &&
      !gap &&
      elevation >= deckHeight - 0.2;
    const surfaceHeight = onDeck ? deckHeight : ground;
    // The unranked banked prototype has a visual floor below its raised deck.
    // Match that floor outside the shoulder without changing its simulation.
    if (!current.vertical && practiceDriver && !airborne && !onDeck) {
      const blend = THREE.MathUtils.clamp(
        (Math.abs(lateral) - frame.halfWidth - 0.8) / 2,
        0,
        1
      );
      elevation = THREE.MathUtils.lerp(elevation, ground + 0.03, blend);
    }
    raceRoot.dataset.airborne = String(airborne);
    raceRoot.dataset.carHeight = String(current.vertical?.height ?? elevation);
    raceRoot.dataset.roadHeight = String(frame.y ?? 0);
    raceRoot.dataset.landings = String(current.vertical?.landings ?? 0);
    raceRoot.dataset.trackSchema = String(track.schemaVersion);
    const landing = landingFeedback.update({
      attemptId,
      landings: current.vertical?.landings ?? 0,
      impact: current.vertical?.impact ?? 0,
      active: scored && !current.recovering && !airborne,
      reducedMotion,
      deltaSeconds,
    });
    raceRoot.style.setProperty(
      '--speed-cue',
      String(
        !reducedMotion && scored
          ? Math.min(0.18, Math.max(0, (speed - 24) / 120))
          : 0
      )
    );
    const carChanged = carVisual.update({
      suspensionCompression: landing.compression,
      elevation,
      surfaceHeight,
      bank: 0,
      jumpPitch: current.vertical
        ? -(airborne
            ? Math.atan2(verticalVelocity, Math.max(speed, 1))
            : Math.atan(frame.grade ?? 0))
        : 0,
      x: frame.x + frame.nx * lateral,
      z: frame.z + frame.nz * lateral,
      heading,
      distance,
      speed,
      acceleration,
      lateralAcceleration: scored
        ? (current.lateralVelocity - previous.lateralVelocity) * SIMULATION_HZ
        : 0,
      curvature: frame.curvature,
      slip: THREE.MathUtils.lerp(previous.slip, current.slip, alpha),
      held: throttle,
      racing: scored,
      reducedMotion,
      deltaSeconds,
    });
    if (viewportDirty) refreshCameraViewport();
    const cameraChanged = raceCamera.update(
      {
        distance,
        lateralOffset: lateral,
        heading,
        speed,
        elevation,
      },
      {
        mode:
          phase === 'countdown' || phase === 'racing' || phase === 'finished'
            ? 'chase'
            : 'overview',
        deltaSeconds,
        reset: needsCameraReset,
        impulsePixels: landing.cameraPixels,
        reducedMotion,
      }
    );
    needsCameraReset = false;
    carVisual.getRearContacts(rearLeft, rearRight);
    const verticalSpan = camera.top - camera.bottom;
    if (!current.vertical && practiceDriver?.airborne) drivingVfx.reset();
    const effectsChanged = drivingVfx.update({
      state: current,
      phase: !current.vertical && practiceDriver?.airborne ? 'ready' : phase,
      held: throttle,
      acceleration,
      rearLeft,
      rearRight,
      deltaSeconds,
      cssPixelsPerMetre:
        verticalSpan > 0 ? canvas.clientHeight / verticalSpan : 0,
      reducedMotion,
    });
    sceneDirty = sceneDirty || carChanged || cameraChanged || effectsChanged;
    audio.update({
      attemptId,
      phase: !current.vertical && practiceDriver?.airborne ? 'ready' : phase,
      state: current,
      held: throttle,
      acceleration,
    });
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
    enabled = enabled && carLoadState === 'ready';
    start.toggleAttribute('disabled', !enabled);
    retry.toggleAttribute('disabled', !enabled);
    restart.toggleAttribute('disabled', !enabled);
  }
  function applyVerification(id: number, result: VerificationOutcome): void {
    if (destroyed || id !== attemptId) return;
    verificationStatus(result.status, result.message);
    cardCopy.textContent = result.status === 'verified' ? '' : result.message;
    if (result.status === 'verified' && result.finishTicks !== undefined) {
      showFinishTime(result.finishTicks);
      cardTitle.textContent = `${formatTime(result.finishTicks / SIMULATION_HZ)} seconds`;
      element('card-kicker').textContent = 'Verified';
    } else {
      element('card-kicker').textContent = 'Unverified';
    }
    options.onResults?.({ attemptId: id, mode: attemptMode });
  }
  function showOutcome(): void {
    if (!racing || driver.active) return;
    racing = false;
    release();
    const state = driver.state;
    card.dataset.result = 'false';
    element('finish-time').hidden = true;
    element('practice-result').hidden = true;
    if (driver.interrupted) {
      audio.silence('abandon');
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
            ? 'Run timed out. Try another run.'
            : driver.interruptionReason === 'invalid-progress'
              ? 'This lap missed a gate. Try another run.'
              : driver.interruptionReason === 'frame-gap'
                ? 'The game paused too long to verify this time. Try another run.'
                : 'Too many input changes to verify this run. Try again.';
      element('card-kicker').textContent = '';
    } else {
      audio.finish(attemptId);
      const finishTicks = state.finishedTick ?? state.tick;
      showFinishTime(finishTicks);
      cardTitle.textContent = `${formatTime(finishTicks / SIMULATION_HZ)} seconds`;
      cardCopy.textContent = '';
      element('card-kicker').textContent = '';
      if (attemptMode === 'ranked' && options.onFinish) {
        const id = attemptId;
        verificationStatus('pending', 'Checking your time…');
        cardCopy.textContent = 'Checking your time…';
        element('card-kicker').textContent = '';
        const result = {
          attemptId: id,
          replay: rankedDriver.replay,
          finishTicks,
        };
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
        const result = recordLocalLap(finishTicks);
        element('practice-result').hidden = false;
        element('practice-result').textContent = localResultText(
          result,
          finishTicks
        );
        card.dataset.best = String(result.isNewBest);
        element('card-kicker').textContent = '';
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
    closeSettings();
    preparing = false;
    preparation = undefined;
    enableAttemptButtons(true);
    const timestamp = performance.now();
    renderReadyArt();
    if (carLoadState !== 'ready') return;
    racingViewport = undefined;
    driver.start(timestamp);
    seenPracticeLaps = 0;
    ghostPoints = [];
    ghostOverflow = false;
    ghostVisual.object.visible = false;
    lapNoticeUntil = 0;
    card.dataset.result = 'false';
    card.dataset.best = 'false';
    element('finish-time').hidden = true;
    element('practice-result').hidden = true;
    carVisual.reset();
    drivingVfx.reset();
    needsCameraReset = true;
    racing = true;
    driver.setInput(pointerHeld || keyHeld, timestamp);
    raceRoot.dataset.attemptMode = attemptMode;
    card.hidden = true;
    canvas.focus({ preventScroll: true });
    feedback();
    positionCar();
    renderScene(true);
  }
  function preparationBlocked(message: string): void {
    audio.silence('abandon');
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
    if (
      destroyed ||
      preparing ||
      racing ||
      !viewportUsable ||
      carLoadState !== 'ready'
    )
      return;
    closeSettings();
    attemptId++;
    audio.setForeground(!document.hidden);
    audio.resetAttempt(attemptId);
    // Keep activation in this native click stack, before any auth request.
    audio.unlockFromGesture();
    renderReadyArt();
    release();
    card.scrollTop = 0;
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
    cardCopy.textContent = '';
    element('card-kicker').textContent = '';
    enableAttemptButtons(false);
    verificationStatus('preparing', 'Preparing your daily race…');
    feedback();
    canvas.focus({ preventScroll: true });
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
  start.addEventListener('click', beginRace, eventOptions);
  retry.addEventListener('click', beginRace, eventOptions);
  restart.addEventListener(
    'click',
    () => {
      if (destroyed || preparing || !viewportUsable) return;
      if (racing) {
        driver.abandon('focus');
        showOutcome();
      }
      release();
      beginRace();
    },
    eventOptions
  );
  canvas.addEventListener(
    'pointerdown',
    (event) => {
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
    },
    eventOptions
  );
  canvas.addEventListener(
    'contextmenu',
    (event) => {
      if (preparing || (racing && driver.active)) event.preventDefault();
    },
    eventOptions
  );
  function releasePointer(event: PointerEvent): void {
    if (event.pointerId !== activePointer) return;
    clearPointer();
    updateInput(performance.now());
  }
  canvas.addEventListener('pointerup', releasePointer, eventOptions);
  canvas.addEventListener('pointercancel', releasePointer, eventOptions);
  canvas.addEventListener('lostpointercapture', releasePointer, eventOptions);
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        event.code !== 'Space' ||
        (!racing && !preparing) ||
        settingsDialog.open
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        (target.closest('button, input, select, textarea, a, summary') ||
          (target instanceof HTMLElement && target.isContentEditable))
      )
        return;
      event.preventDefault();
      keyHeld = true;
      updateInput(performance.now());
    },
    eventOptions
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.code !== 'Space') return;
      keyHeld = false;
      updateInput(performance.now());
    },
    eventOptions
  );
  function interruptRace(): void {
    audio.silence('background');
    drivingVfx.reset();
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
  window.addEventListener('blur', interruptRace, eventOptions);
  window.addEventListener(
    'focus',
    () => {
      audio.setForeground(!document.hidden);
      sceneDirty = true;
      resize();
    },
    eventOptions
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) interruptRace();
      else {
        audio.setForeground(true);
        sceneDirty = true;
        resize();
      }
    },
    eventOptions
  );

  function resize(): void {
    if (destroyed) return;
    resolutionObserver.refresh();
    const next = resolveRenderViewport(
      canvas.clientWidth,
      canvas.clientHeight,
      window.devicePixelRatio
    );
    const usable = next.width >= 320 && next.height >= 320;
    const restoreFocus =
      usable &&
      !viewportUsable &&
      (document.activeElement === viewportMessage || document.hasFocus());
    if (usable !== viewportUsable) sceneDirty = true;
    viewportUsable = usable;
    viewportMessage.hidden = usable;
    raceRoot.dataset.viewportUsable = String(usable);
    if (!usable && (preparing || driver.active)) {
      // Losing a usable control surface is the same safe abandonment boundary
      // as focus loss. Never race unseen or resume an interrupted ranked tape.
      interruptRace();
      cardCopy.textContent =
        'The view became too small. Rotate or expand, then try again.';
      viewportMessage.focus({ preventScroll: true });
    }
    raceRoot.inert = !usable;
    if (restoreFocus && !card.hidden) cardTitle.focus({ preventScroll: true });
    viewportDirty = true;
    if (!next.drawable) {
      refreshCameraViewport();
      return;
    }
    if (
      !renderViewport ||
      renderViewport.width !== next.width ||
      renderViewport.height !== next.height ||
      renderViewport.pixelRatio !== next.pixelRatio
    ) {
      renderer.setDrawingBufferSize(next.width, next.height, next.pixelRatio);
      renderViewport = next;
      sceneDirty = true;
    }
    // A changed drawing buffer is cleared, including while clocks are paused.
    positionCar();
    renderScene();
  }
  const resolutionObserver = createResolutionObserver(resize);
  window.addEventListener('resize', resize, eventOptions);
  feedback();
  resize();
  sceneReady = true;
  // Daily metadata and asynchronous verification can wrap after initialization.
  // Observe layout changes instead of measuring the HUD on every driving frame.
  const hudObserver = new ResizeObserver((entries) => {
    if (destroyed) return;
    if (entries.some((entry) => entry.target === canvas)) {
      resize();
      return;
    }
    viewportDirty = true;
    sceneDirty = true;
    positionCar();
    renderScene();
  });
  hudObserver.observe(hud);
  hudObserver.observe(canvas);
  if (footer) hudObserver.observe(footer);
  hudObserver.observe(card);

  function setCarLoadState(state: typeof carLoadState): void {
    carLoadState = state;
    raceRoot.dataset.carLoad = state;
    carLoadStatus.hidden = state === 'ready';
    carLoadStatus.textContent =
      state === 'loading'
        ? 'Loading your car…'
        : state === 'unavailable'
          ? 'The car could not load. Check your connection and retry.'
          : '';
    carLoadRetry.hidden = state !== 'unavailable';
    enableAttemptButtons(state === 'ready');
    sceneDirty = true;
  }
  async function loadRequiredCar(retry = false): Promise<void> {
    setCarLoadState('loading');
    try {
      const template = await sceneAssets.loadCarAsset(retry);
      if (destroyed) return;
      if (!template) {
        setCarLoadState('unavailable');
        return;
      }
      pendingCar = template;
      renderReadyArt();
    } catch {
      if (!destroyed) setCarLoadState('unavailable');
    }
  }
  carLoadRetry.addEventListener(
    'click',
    () => {
      if (!destroyed && carLoadState === 'unavailable')
        void loadRequiredCar(true);
    },
    eventOptions
  );
  void loadRequiredCar();
  void sceneAssets
    .loadSceneryAssets()
    .then((assets) => {
      if (destroyed) return;
      pendingScenery = assets;
      renderReadyArt();
    })
    .catch(() => {});

  function animate(time: number): void {
    if (destroyed) return;
    if (
      renderViewport &&
      renderViewport.pixelRatio !==
        resolveRenderPixelRatio(window.devicePixelRatio)
    )
      resize();
    const deltaSeconds =
      previousFrameTime === undefined
        ? 0
        : Math.min(0.1, Math.max(0, (time - previousFrameTime) / 1000));
    previousFrameTime = time;
    driver.advance(time);
    showOutcome();
    sceneDirty = applyPendingAssets() || sceneDirty;
    feedback();
    positionCar(deltaSeconds);
    sceneDirty =
      vegetation.update(
        time / 1000,
        carVisual.object.position,
        preferences.snapshot.reducedMotion,
        driver.active
      ) || sceneDirty;
    // Preserve every scored/countdown frame; only settled inactive draws stop.
    renderScene(driver.active);
    frameHandle = requestAnimationFrame(animate);
  }
  frameHandle = requestAnimationFrame(animate);

  function dispose(): void {
    if (destroyed) return;
    closeSettings();
    interruptRace();
    destroyed = true;
    carLoadStatus.remove();
    carLoadRetry.remove();
    lifetime.abort();
    cancelAnimationFrame(frameHandle);
    preparation?.abort();
    hudObserver.disconnect();
    resolutionObserver.dispose();
    window.removeEventListener('resize', resize);
    unsubscribePreferences();
    preferences.dispose();
    void audio.dispose().catch(() => {});
    ghostVisual.dispose();
    scene.remove(ghostVisual.object);
    drivingVfx.dispose();
    carVisual.dispose();
    scenery.dispose();
    vegetation.dispose();
    minimap.dispose();
    scene.remove(carVisual.object, scenery.object, drivingVfx.object);
    sceneAssets.dispose();
    scene.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) node.dispose();
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material)
          ? node.material
          : [node.material])
          material.dispose();
      }
    });
    releaseGameScene(renderer);
    document.getElementById('track-debug')?.remove();
  }
  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) interruptRace();
      else dispose();
    },
    eventOptions
  );
  return {
    dispose,
    celebrateVerifiedLeader(id) {
      if (
        !lifetime.signal.aborted &&
        id === attemptId &&
        !racing &&
        attemptMode === 'ranked'
      )
        audio.verifiedBest(id);
    },
  };
}
