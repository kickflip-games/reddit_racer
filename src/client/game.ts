import * as THREE from 'three';
import { createPreviewState } from '../shared/race';
import { createOvalTrack } from '../shared/track-authoring';
import { sampleTrack } from '../shared/track';
import {
  createTrackDebugOverlay,
  createTrackRenderer,
  getTrackBounds,
} from './track-renderer';

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
const card = element('card');
const cardTitle = element('card-title');
const cardCopy = element('card-copy');
const inputLabel = element('status');
const start = element('start-button');
const retry = element('retry-button');
element('mode-label').textContent = import.meta.env.DEV
  ? 'LOCAL · UNRANKED'
  : 'PRACTICE · UNRANKED';

// The shared track is authoritative; this preview car follows its arc length.
const track = createOvalTrack();
const bounds = getTrackBounds(track, 0.8);
const centerX = (bounds.minX + bounds.maxX) / 2;
const centerZ = (bounds.minZ + bounds.maxZ) / 2;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#548365');
const camera = new THREE.OrthographicCamera(-70, 70, 70, -70, 0.1, 400);
camera.position.set(centerX, 115, centerZ + 55);
camera.lookAt(centerX, 0, centerZ);
camera.updateMatrixWorld();
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
} catch (error) {
  element('error').hidden = false;
  element('error').textContent =
    'Your browser could not start the 3D race. Please try a browser with WebGL enabled.';
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
scene.add(new THREE.HemisphereLight('#fff4d8', '#46664f', 2.6));
const sun = new THREE.DirectionalLight('#fff0cf', 2.1);
sun.position.set(-30, 80, 30);
scene.add(sun);

const grass = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.MeshLambertMaterial({ color: '#548365' })
);
grass.rotation.x = -Math.PI / 2;
grass.position.y = -0.05;
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

const treeTrunkMaterial = new THREE.MeshLambertMaterial({ color: '#7f6551' });
const treeCrownMaterial = new THREE.MeshLambertMaterial({ color: '#2d6249' });
const treeTrunkGeometry = new THREE.CylinderGeometry(0.35, 0.45, 2.4, 5);
const treeCrownGeometry = new THREE.ConeGeometry(2.2, 5.2, 6);
for (const [x, z] of [
  [-11, -10],
  [-15, -5],
  [-10, 2],
  [10, 15],
  [14, 20],
  [9, 25],
  [-43, 16],
  [-46, 23],
  [42, -24],
  [45, -18],
]) {
  if (x === undefined || z === undefined) continue;
  const trunk = new THREE.Mesh(treeTrunkGeometry, treeTrunkMaterial);
  trunk.position.set(x, 1.2, z);
  const crown = new THREE.Mesh(treeCrownGeometry, treeCrownMaterial);
  crown.position.set(x, 4.4, z);
  scene.add(trunk, crown);
}

const car = new THREE.Group();
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.9, 0.65, 3.3),
  new THREE.MeshLambertMaterial({ color: '#ff784e' })
);
body.position.y = 0.8;
const cabin = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 0.6, 1.5),
  new THREE.MeshLambertMaterial({ color: '#ffe6ad' })
);
cabin.position.set(0, 1.35, -0.2);
const windscreen = new THREE.Mesh(
  new THREE.BoxGeometry(1.55, 0.45, 0.15),
  new THREE.MeshLambertMaterial({ color: '#254647' })
);
windscreen.position.set(0, 1.32, 0.62);
car.add(body, cabin, windscreen);
const tyreGeometry = new THREE.CylinderGeometry(0.48, 0.48, 0.35, 8);
const tyreMaterial = new THREE.MeshLambertMaterial({ color: '#20322f' });
for (const x of [-1, 1])
  for (const z of [-1.05, 1.05]) {
    const tyre = new THREE.Mesh(tyreGeometry, tyreMaterial);
    tyre.rotation.z = Math.PI / 2;
    tyre.position.set(x, 0.5, z);
    car.add(tyre);
  }
const brakeMaterial = new THREE.MeshBasicMaterial({ color: '#ff302e' });
for (const x of [-0.65, 0.65]) {
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.2, 0.08),
    brakeMaterial
  );
  lamp.position.set(x, 0.85, -1.69);
  car.add(lamp);
}
const shadow = new THREE.Mesh(
  new THREE.PlaneGeometry(3, 4.4),
  new THREE.MeshBasicMaterial({
    color: '#1a322b',
    transparent: true,
    opacity: 0.22,
  })
);
shadow.rotation.x = -Math.PI / 2;
shadow.position.y = 0.065;
car.add(shadow);
scene.add(car);

let racing = false;
let pointerHeld = false;
let keyHeld = false;
let activePointer: number | undefined;
let { distance, speed } = createPreviewState();
let elapsed = 0;
let previousTime = 0;

function held(): boolean {
  return racing && (pointerHeld || keyHeld);
}
function feedback(): void {
  inputLabel.dataset.held = String(held());
  inputLabel.textContent = racing
    ? held()
      ? 'ACCELERATING'
      : 'RELEASED · BRAKING'
    : 'SPACE OR TOUCH THE TRACK';
  brakeMaterial.color.set(held() ? '#672e27' : '#ff302e');
}
function release(): void {
  pointerHeld = false;
  keyHeld = false;
  activePointer = undefined;
  feedback();
}
function positionCar(): void {
  const frame = sampleTrack(track, track.startS + distance);
  car.position.set(frame.x, 0, frame.z);
  car.rotation.y = Math.atan2(frame.tx, frame.tz);
}
function formatTime(seconds: number): string {
  return seconds.toFixed(3).padStart(6, '0');
}
function beginRace(): void {
  distance = 0;
  speed = 0;
  elapsed = 0;
  release();
  racing = true;
  card.hidden = true;
  feedback();
  positionCar();
}
start.addEventListener('click', beginRace);
retry.addEventListener('click', beginRace);
canvas.addEventListener('pointerdown', (event) => {
  if (!racing || activePointer !== undefined || event.button !== 0) return;
  event.preventDefault();
  activePointer = event.pointerId;
  pointerHeld = true;
  canvas.setPointerCapture(event.pointerId);
  feedback();
});
function releasePointer(event: PointerEvent): void {
  if (event.pointerId !== activePointer) return;
  pointerHeld = false;
  activePointer = undefined;
  feedback();
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', releasePointer);
window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || !racing) return;
  event.preventDefault();
  keyHeld = true;
  feedback();
});
window.addEventListener('keyup', (event) => {
  if (event.code !== 'Space') return;
  keyHeld = false;
  feedback();
});
window.addEventListener('blur', release);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) release();
});

function resize(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const aspect = width / Math.max(height, 1);
  // Fit the authoritative road bounds in the camera's angled view.
  const corners = [
    new THREE.Vector3(bounds.minX, 0, bounds.minZ),
    new THREE.Vector3(bounds.minX, 0, bounds.maxZ),
    new THREE.Vector3(bounds.maxX, 0, bounds.minZ),
    new THREE.Vector3(bounds.maxX, 0, bounds.maxZ),
  ].map((point) => point.applyMatrix4(camera.matrixWorldInverse));
  const projectedWidth =
    Math.max(...corners.map((point) => point.x)) -
    Math.min(...corners.map((point) => point.x));
  const projectedHeight =
    Math.max(...corners.map((point) => point.y)) -
    Math.min(...corners.map((point) => point.y));
  const halfHeight = Math.max(
    projectedHeight * 0.72,
    (projectedWidth * 0.72) / aspect
  );
  camera.left = -halfHeight * aspect;
  camera.right = halfHeight * aspect;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
window.addEventListener('resize', resize);
resize();
positionCar();
feedback();

function animate(time: number): void {
  const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.05) : 0;
  previousTime = time;
  if (racing) {
    speed = Math.max(0, Math.min(18, speed + (held() ? 7 : -9) * dt));
    distance += speed * dt;
    elapsed += dt;
    if (distance >= track.totalLength) {
      distance = track.totalLength;
      racing = false;
      release();
      cardTitle.textContent = `${formatTime(elapsed)} seconds`;
      cardCopy.textContent = 'Practice complete. Find a faster rhythm.';
      element('card-kicker').textContent = 'LAP COMPLETE · UNRANKED';
      start.hidden = true;
      retry.hidden = false;
      card.hidden = false;
    }
    positionCar();
  }
  timer.textContent = formatTime(elapsed);
  speedLabel.textContent = String(Math.round(speed * 3.6));
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
