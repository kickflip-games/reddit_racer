import * as THREE from 'three';
import { createPreviewState } from '../shared/race';

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

// Temporary foundation course; the canonical shared track replaces this in #5.
const radiusX = 28;
const radiusZ = 42;
const roadWidth = 7;
const sampleCount = 192;
const points = Array.from({ length: sampleCount }, (_, index) => {
  const angle = Math.PI + (index / sampleCount) * Math.PI * 2;
  const x = Math.sin(angle) * radiusX;
  const z = Math.cos(angle) * radiusZ;
  const tangent = new THREE.Vector3(
    Math.cos(angle) * radiusX,
    0,
    -Math.sin(angle) * radiusZ
  ).normalize();
  return { x, z, tangent, normal: new THREE.Vector3(-tangent.z, 0, tangent.x) };
});
const courseLength = points.reduce((length, point, index) => {
  const next = points[(index + 1) % sampleCount];
  return next
    ? length + Math.hypot(next.x - point.x, next.z - point.z)
    : length;
}, 0);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#548365');
const camera = new THREE.OrthographicCamera(-70, 70, 70, -70, 0.1, 400);
camera.position.set(0, 115, 55);
camera.lookAt(0, 0, 0);
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

function roadStrip(
  inner: number,
  outer: number,
  color: string,
  y: number
): THREE.Mesh {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= sampleCount; i++) {
    const point = points[i % sampleCount];
    if (!point) continue;
    for (const width of [inner, outer]) {
      vertices.push(
        point.x + point.normal.x * width,
        y,
        point.z + point.normal.z * width
      );
    }
    if (i < sampleCount) {
      const base = i * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide })
  );
}
scene.add(roadStrip(-roadWidth / 2 - 0.8, roadWidth / 2 + 0.8, '#d4c5a0', 0));
scene.add(roadStrip(-roadWidth / 2, roadWidth / 2, '#394747', 0.03));
scene.add(
  roadStrip(-roadWidth / 2 + 0.18, -roadWidth / 2 + 0.32, '#e7e9cc', 0.045)
);
scene.add(
  roadStrip(roadWidth / 2 - 0.32, roadWidth / 2 - 0.18, '#e7e9cc', 0.045)
);

// Painted start line, with no physics dependency on its visual mesh.
for (let column = 0; column < 8; column++) {
  for (let row = 0; row < 2; row++) {
    const tile = new THREE.Mesh(
      new THREE.PlaneGeometry(0.65, roadWidth / 8),
      new THREE.MeshLambertMaterial({
        color: (column + row) % 2 ? '#f9f3d6' : '#222e30',
      })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(
      row * 0.65 - 0.325,
      0.06,
      -radiusZ - roadWidth / 2 + ((column + 0.5) * roadWidth) / 8
    );
    scene.add(tile);
  }
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
  const sample = (distance / courseLength) * sampleCount;
  const index = Math.floor(sample) % sampleCount;
  const point = points[index];
  const next = points[(index + 1) % sampleCount];
  if (!point || !next) return;
  const fraction = sample - Math.floor(sample);
  car.position.set(
    THREE.MathUtils.lerp(point.x, next.x, fraction),
    0,
    THREE.MathUtils.lerp(point.z, next.z, fraction)
  );
  car.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
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
  const halfHeight = Math.max(64, 47 / aspect);
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
    if (distance >= courseLength) {
      distance = courseLength;
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
