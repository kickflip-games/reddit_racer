import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { withRequestDeadline } from './request-deadline';

export type SceneryKind =
  'treeSmall' | 'barrierRed' | 'barrierWhite' | 'pylon' | 'flagCheckersSmall';
export type SceneryAssets = Readonly<Partial<Record<SceneryKind, THREE.Group>>>;
export type AssetModelLoader = (
  url: string,
  manager: THREE.LoadingManager
) => Promise<THREE.Group>;
export type SceneAssetCache = {
  loadCarAsset(): Promise<THREE.Group | undefined>;
  loadSceneryAssets(): Promise<SceneryAssets>;
  dispose(): void;
};

const carUrl = new URL(
  './assets/kenney/car-kit/race.glb?no-inline',
  import.meta.url
).href;
const paletteUrl = new URL(
  './assets/kenney/car-kit/Textures/colormap.png?no-inline',
  import.meta.url
).href;
const sceneryUrls: Record<SceneryKind, string> = {
  treeSmall: new URL(
    './assets/kenney/racing-kit/treeSmall.glb?no-inline',
    import.meta.url
  ).href,
  barrierRed: new URL(
    './assets/kenney/racing-kit/barrierRed.glb?no-inline',
    import.meta.url
  ).href,
  barrierWhite: new URL(
    './assets/kenney/racing-kit/barrierWhite.glb?no-inline',
    import.meta.url
  ).href,
  pylon: new URL(
    './assets/kenney/racing-kit/pylon.glb?no-inline',
    import.meta.url
  ).href,
  flagCheckersSmall: new URL(
    './assets/kenney/racing-kit/flagCheckersSmall.glb?no-inline',
    import.meta.url
  ).href,
};

/** Dispose an owned import once, including shared materials within its hierarchy. */
export function disposeAssetTemplate(root: THREE.Group): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      materials.add(material);
      if (
        material instanceof THREE.MeshStandardMaterial ||
        material instanceof THREE.MeshBasicMaterial
      ) {
        if (material.map) textures.add(material.map);
        if (material.alphaMap) textures.add(material.alphaMap);
      }
      if (material instanceof THREE.MeshStandardMaterial) {
        for (const texture of [
          material.normalMap,
          material.roughnessMap,
          material.metalnessMap,
          material.aoMap,
          material.emissiveMap,
        ]) {
          if (texture) textures.add(texture);
        }
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    const image: unknown = texture.image;
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)
      bitmaps.add(image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
}

async function loadModel(
  url: string,
  manager: THREE.LoadingManager
): Promise<THREE.Group> {
  const loaded = await new GLTFLoader(manager).loadAsync(url);
  loaded.scene.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(loaded.scene);
  if (
    bounds.isEmpty() ||
    !Number.isFinite(
      bounds.min.x +
        bounds.min.y +
        bounds.min.z +
        bounds.max.x +
        bounds.max.y +
        bounds.max.z
    )
  ) {
    disposeAssetTemplate(loaded.scene);
    throw new Error('The selected model has invalid bounds');
  }
  return loaded.scene;
}

/** A scene owns one cache; retries borrow its immutable templates. */
export function createSceneAssetCache(
  loader: AssetModelLoader = loadModel,
  timeoutMs = 10_000
): SceneAssetCache {
  let car: Promise<THREE.Group | undefined> | undefined;
  let scenery: Promise<SceneryAssets> | undefined;
  let disposed = false;
  const lifetime = new AbortController();
  const templates = new Set<THREE.Group>();
  async function selected(
    url: string,
    palette?: string
  ): Promise<THREE.Group | undefined> {
    if (disposed) return undefined;
    const manager = new THREE.LoadingManager();
    let resourceFailed = false;
    manager.onError = () => {
      resourceFailed = true;
    };
    if (palette) {
      const authoredPalette = new URL('Textures/colormap.png', url).href;
      manager.setURLModifier((requested) =>
        requested === authoredPalette ? palette : requested
      );
    }
    try {
      return await withRequestDeadline(
        async (signal) => {
          const abort = (): void => {
            manager.abort();
          };
          signal.addEventListener('abort', abort, { once: true });
          try {
            const result = await loader(url, manager);
            if (disposed || signal.aborted || resourceFailed) {
              disposeAssetTemplate(result);
              return undefined;
            }
            templates.add(result);
            return result;
          } finally {
            signal.removeEventListener('abort', abort);
          }
        },
        { signal: lifetime.signal, timeoutMs }
      );
    } catch {
      return undefined;
    }
  }
  return {
    loadCarAsset() {
      if (disposed) return Promise.resolve(undefined);
      car ??= selected(carUrl, paletteUrl);
      return car;
    },
    loadSceneryAssets() {
      if (disposed) return Promise.resolve({});
      scenery ??= Promise.all(
        Object.entries(sceneryUrls).map(async ([key, url]) => ({
          key,
          model: await selected(url),
        }))
      ).then((models) => {
        const assets: Partial<Record<SceneryKind, THREE.Group>> = {};
        for (const { key, model } of models) {
          if (!model) continue;
          if (
            key === 'treeSmall' ||
            key === 'barrierRed' ||
            key === 'barrierWhite' ||
            key === 'pylon' ||
            key === 'flagCheckersSmall'
          )
            assets[key] = model;
        }
        return assets;
      });
      return scenery;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifetime.abort();
      for (const template of templates) disposeAssetTemplate(template);
      templates.clear();
    },
  };
}

const sceneAssets = createSceneAssetCache();
export const loadCarAsset = (): Promise<THREE.Group | undefined> =>
  sceneAssets.loadCarAsset();
export const loadSceneryAssets = (): Promise<SceneryAssets> =>
  sceneAssets.loadSceneryAssets();
/** Whole-scene teardown only, after borrowed car/scenery consumers are removed. */
export const disposeSceneAssets = (): void => sceneAssets.dispose();
