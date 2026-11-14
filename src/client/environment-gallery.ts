import { addToonLighting } from './toon-material';
import * as THREE from 'three';
import { generateElevatedCircuit } from '../shared/elevated-generator';
import { generateValidatedCircuit } from '../shared/circuit-quality';
import { createStuntCourse } from '../shared/stunt-course';
import { hashTrack, sampleTrack, type Track } from '../shared/track';
import {
  generateSceneryLayout,
  SCENERY_VERSION,
  type SceneryOptions,
} from './scenery-layout';
import { createVegetation, createSceneryOverlay } from './vegetation';
import { createScenery } from './scenery';
import { createEnvironment } from './environment';
import { createTrackRenderer, getTrackBounds } from './track-renderer';
import { createSceneAssetCache } from './scene-assets';
import { createRaceCamera } from './race-camera';
import { createCarVisual } from './car-visual';

// This HTML is a Vite-local entry, deliberately absent from devvit.json.
if (!import.meta.env.DEV)
  throw new Error('The scenery workshop is development-only');
function element(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing ${id}`);
  return value;
}
function input(id: string): HTMLInputElement {
  const value = element(id);
  if (!(value instanceof HTMLInputElement)) throw new Error(`Invalid ${id}`);
  return value;
}
function select(id: string): string {
  const value = element(id);
  if (!(value instanceof HTMLSelectElement)) throw new Error(`Invalid ${id}`);
  return value.value;
}
const canvasElement = element('environment-canvas');
if (!(canvasElement instanceof HTMLCanvasElement))
  throw new Error('Missing canvas');
const canvas = canvasElement;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const assets = createSceneAssetCache();
const [models, carAsset] = await Promise.all([
  assets.loadSceneryAssets(),
  assets.loadCarAsset(),
]);
input('scenery-version').value = SCENERY_VERSION;
const query = new URLSearchParams(window.location.search);
if (query.has('seed')) input('seed').value = query.get('seed') ?? '';
type Preview = ReturnType<typeof preview>;
let current: Preview | undefined,
  busy = false,
  generation = 0,
  lastTime = 0;
function options(): SceneryOptions {
  return {
    seed: input('scenery-seed').value,
    regions: Number(input('regions').value),
    trees: Number(input('trees').value),
    groundCover: Number(input('cover').value),
    wind: input('wind').checked,
    quality: select('quality') === 'light' ? 'light' : 'standard',
    lighting: select('lighting') === 'toon' ? 'toon' : 'soft',
  };
}
function course(seed: string) {
  const mode = select('course');
  if (mode === 'stunt') return createStuntCourse(seed.endsWith('1'));
  const track =
    mode === 'classic'
      ? generateValidatedCircuit(seed).track
      : generateElevatedCircuit(seed).track;
  return { track, jumps: track.jumps ?? [], gripZones: [] };
}
function preview(seed: string) {
  const data = course(seed),
    track = data.track;
  const layout = generateSceneryLayout(track, {
    ...options(),
    jumps: data.jumps,
    gripZones: data.gripZones,
  });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a5b18d');
  addToonLighting(scene);
  scene.add(
    createEnvironment(track, layout.props, layout),
    createTrackRenderer(track, data.jumps)
  );
  const scenery = createScenery(track, layout);
  scenery.installAssets(models);
  scene.add(scenery.object);
  const vegetation = createVegetation(layout);
  scene.add(vegetation.object);
  const car = createCarVisual();
  if (carAsset) car.installModel(carAsset);
  scene.add(car.object);
  const view = createRaceCamera(track),
    focus = new THREE.Vector3();
  const overlay = select('overlay');
  if (overlay !== 'none')
    scene.add(
      createSceneryOverlay(layout, overlay === 'clearance', track.samples)
    );
  return {
    scene,
    track,
    layout,
    vegetation,
    view,
    focus,
    pose(width: number, height: number) {
      const distance =
          (track.totalLength * Number(input('progress').value)) / 100,
        frame = sampleTrack(track, distance);
      focus.set(frame.x, frame.y ?? 0, frame.z);
      car.update({
        x: frame.x,
        z: frame.z,
        elevation: frame.y ?? 0,
        heading: Math.atan2(frame.tx, frame.tz),
        distance,
        speed: 0,
        acceleration: 0,
        lateralAcceleration: 0,
        curvature: frame.curvature,
        slip: 0,
        held: false,
        racing: false,
        reducedMotion: true,
        deltaSeconds: 0,
      });
      view.resize({
        width,
        height,
        insets: { top: 10, right: 10, bottom: 10, left: 10 },
      });
      view.update(
        {
          distance,
          lateralOffset: 0,
          heading: Math.atan2(frame.tx, frame.tz),
          elevation: frame.y ?? 0,
        },
        { mode: 'chase', deltaSeconds: 0, reset: true }
      );
    },
    dispose() {
      vegetation.dispose();
      scenery.dispose();
      car.dispose();
      const geometries = new Set<THREE.BufferGeometry>(),
        materials = new Set<THREE.Material>();
      scene.traverse((n) => {
        if (n instanceof THREE.InstancedMesh) n.dispose();
        if (n instanceof THREE.Mesh || n instanceof THREE.LineSegments) {
          geometries.add(n.geometry);
          for (const m of Array.isArray(n.material) ? n.material : [n.material])
            materials.add(m);
        }
      });
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      scene.clear();
      renderer.renderLists.dispose();
    },
  };
}
function overview(track: Track, aspect: number) {
  const bounds = getTrackBounds(track, 40),
    span = Math.max(
      bounds.maxX - bounds.minX,
      (bounds.maxZ - bounds.minZ) * 1.15
    ),
    half = span * 0.54;
  const camera = new THREE.OrthographicCamera(
    -half * aspect,
    half * aspect,
    half,
    -half,
    0.1,
    1500
  );
  const x = (bounds.minX + bounds.maxX) / 2,
    z = (bounds.minZ + bounds.maxZ) / 2;
  camera.position.set(x - 30, 250, z - 160);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld(true);
  return camera;
}
async function regenerate() {
  generation++;
  const seed = input('seed').value;
  if (!seed.length) return;
  current?.dispose();
  current = undefined;
  try {
    current = preview(seed);
    const link = element('drive');
    if (link instanceof HTMLAnchorElement) {
      const q = new URLSearchParams({
        seed,
        scenerySeed: input('scenery-seed').value,
        regions: input('regions').value,
        trees: input('trees').value,
        cover: input('cover').value,
        wind: input('wind').checked ? '1' : '0',
        lighting: select('lighting'),
        sceneryQuality: select('quality'),
      });
      if (select('course') === 'elevated') q.set('elevated', '1');
      if (select('course') === 'stunt') q.set('stunt', '1');
      link.href = `game.html?${q}`;
    }
    element('environment-status').dataset.state = 'ready';
    element('environment-status').textContent =
      `${seed} · ${current.layout.regions.length} regions · ${current.layout.plants.length} plants`;
    const selected = current;
    const hash = await hashTrack(selected.track);
    if (current === selected)
      element('environment-stats').dataset.trackHash = hash;
  } catch (error) {
    element('environment-status').dataset.state = 'error';
    element('environment-status').textContent =
      error instanceof Error ? error.message : 'Generation failed';
  }
}
element('environment-controls').addEventListener('submit', (event) => {
  event.preventDefault();
  void regenerate();
});
input('wind').addEventListener('change', () => void regenerate());
element('gallery-button').addEventListener('click', () => void gallery());
async function gallery() {
  if (busy) return;
  busy = true;
  const token = ++generation;
  const grid = element('environment-gallery');
  grid.replaceChildren();
  const saved = options();
  try {
    for (let i = 0; i < 12; i++) {
      if (token !== generation) break;
      const seed = `spring-review-${i}`;
      const scene = preview(seed);
      renderer.setSize(360, 248, false);
      scene.vegetation.update(0, scene.focus, true, false);
      renderer.render(scene.scene, overview(scene.track, 360 / 248));
      const image = document.createElement('img');
      image.src = renderer.domElement.toDataURL('image/png');
      image.alt = `Actual seeded countryside ${seed}`;
      const card = document.createElement('button');
      card.className = 'environment-card';
      card.type = 'button';
      card.dataset.seed = seed;
      const label = document.createElement('span');
      label.textContent = `${seed} · ${scene.layout.plants.length} plants`;
      card.append(image, label);
      card.addEventListener('click', () => {
        input('seed').value = seed;
        void regenerate();
      });
      grid.append(card);
      scene.dispose();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve())
      );
    }
    grid.dataset.state = grid.children.length === 12 ? 'complete' : 'cancelled';
    grid.dataset.options = JSON.stringify(saved);
  } finally {
    busy = false;
  }
}
await regenerate();
function animate(time: number) {
  requestAnimationFrame(animate);
  if (busy || !current) return;
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height)
    renderer.setSize(width, height, false);
  current.pose(width, height);
  current.vegetation.update(time / 1000, current.focus, false, true);
  renderer.render(current.scene, current.view.camera);
  if (time - lastTime > 500) {
    element('environment-stats').textContent =
      `${current.layout.version} · candidates ${current.layout.work.candidates}/${18000}\ndraw calls ${renderer.info.render.calls} · triangles ${renderer.info.render.triangles} · geometries ${renderer.info.memory.geometries} · textures ${renderer.info.memory.textures}`;
    const stats = element('environment-stats');
    stats.dataset.geometries = String(renderer.info.memory.geometries);
    stats.dataset.textures = String(renderer.info.memory.textures);
    stats.dataset.programs = String(renderer.info.programs?.length ?? 0);
    stats.dataset.plants = String(current.layout.plants.length);
    stats.dataset.calls = String(renderer.info.render.calls);
    stats.dataset.triangles = String(renderer.info.render.triangles);
    lastTime = time;
  }
}
requestAnimationFrame(animate);
window.addEventListener(
  'pagehide',
  () => {
    current?.dispose();
    assets.dispose();
    renderer.dispose();
  },
  { once: true }
);
