import { expect, test } from '@playwright/test';
import type { CarVisualFrame } from '../../src/client/car-visual.ts';
import type { DrivingVfxFrame } from '../../src/client/driving-vfx.ts';
import { createOvalTrack } from '../../src/shared/track-authoring.ts';
import { sampleTrack } from '../../src/shared/track.ts';

test('VFX FIXTURE renders tyre-aligned translucent smoke, road skids and off-road dust, then clears reduced motion', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const track = createOvalTrack();
  const poses = Array.from({ length: 42 }, (_, index) =>
    sampleTrack(track, 8 + index * 0.2)
  );
  await page.route('**/feedback-vfx-fixture.html', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>VFX FIXTURE</title><body style="margin:0;padding:10px;background:#f5eddb;color:#183529;font:14px sans-serif"><h1 style="font-size:16px">VFX FIXTURE</h1><p>Synthetic slip/off-road frames and real car rear contacts on a canonical curve. No race or result.</p></body>',
    })
  );
  await page.goto('/feedback-vfx-fixture.html');
  const metrics = await page.evaluate(
    async ({ track, poses }) => {
      const threeUrl = '/@id/three';
      const assetUrl = '/scene-assets.ts';
      const carUrl = '/car-visual.ts';
      const roadUrl = '/track-renderer.ts';
      const vfxUrl = '/driving-vfx.ts';
      const THREE: typeof import('three') = await import(threeUrl);
      const {
        loadCarAsset,
        disposeSceneAssets,
      }: typeof import('../../src/client/scene-assets.ts') = await import(
        assetUrl
      );
      const {
        createCarVisual,
      }: typeof import('../../src/client/car-visual.ts') = await import(carUrl);
      const {
        createTrackRenderer,
      }: typeof import('../../src/client/track-renderer.ts') = await import(
        roadUrl
      );
      const {
        createDrivingVfx,
      }: typeof import('../../src/client/driving-vfx.ts') = await import(
        vfxUrl
      );
      const model = await loadCarAsset();
      if (!model)
        throw new Error('Selected car did not load for rear-contact fixture');
      const car = createCarVisual();
      if (!car.installModel(model))
        throw new Error('Selected car rig was rejected');
      const effects = createDrivingVfx(track, { noiseSeed: 42 });
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#77a55b');
      const road = createTrackRenderer(track);
      scene.add(road, car.object, effects.object);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x536e42, 2.6));
      const light = new THREE.DirectionalLight(0xffffff, 2.1);
      light.position.set(4, 7, 5);
      scene.add(light);
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(1);
      renderer.setSize(300, 300);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const camera = new THREE.OrthographicCamera(-9, 9, 9, -9, 0.1, 80);
      const centre = poses[20];
      if (!centre) throw new Error('Missing canonical curve pose');
      camera.position.set(centre.x, 50, centre.z + 0.01);
      camera.lookAt(centre.x, 0, centre.z);
      const rearLeft = new THREE.Vector3();
      const rearRight = new THREE.Vector3();
      let last: DrivingVfxFrame | undefined;
      function frame(index: number, offRoad: boolean): DrivingVfxFrame {
        const pose = poses[index];
        if (!pose) throw new Error('Missing canonical presentation pose');
        const lateral = offRoad ? pose.width / 2 + 2 : 0;
        const carFrame: CarVisualFrame = {
          x: pose.x - pose.tz * lateral,
          z: pose.z + pose.tx * lateral,
          heading: Math.atan2(pose.tx, pose.tz),
          distance: pose.s,
          speed: 12,
          acceleration: -4,
          lateralAcceleration: 0,
          curvature: pose.curvature,
          slip: 0.75,
          held: false,
          racing: true,
          reducedMotion: false,
          deltaSeconds: 1 / 60,
        };
        car.update(carFrame);
        car.object.updateMatrixWorld(true);
        car.getRearContacts(rearLeft, rearRight);
        return {
          state: {
            tick: index * 2,
            distance: pose.s,
            speed: 12,
            lateralOffset: lateral,
            lateralVelocity: 0,
            slip: 0.75,
            offRoad,
            recovering: false,
            recoveryTicksRemaining: 0,
            recoveryCount: 0,
            finishedTick: null,
            status: 'running',
          },
          phase: 'racing',
          held: false,
          acceleration: -4,
          rearLeft,
          rearRight,
          deltaSeconds: 1 / 60,
          cssPixelsPerMetre: 300 / 18,
          reducedMotion: false,
        };
      }
      const smoke = effects.object.getObjectByName('tyre-smoke');
      const dust = effects.object.getObjectByName('offroad-dust');
      const skids = effects.object.getObjectByName('tyre-skids');
      if (
        !(smoke instanceof THREE.Points) ||
        !(dust instanceof THREE.Points) ||
        !(skids instanceof THREE.Mesh) ||
        !(smoke.material instanceof THREE.PointsMaterial) ||
        !(dust.material instanceof THREE.PointsMaterial)
      )
        throw new Error('Missing public effect geometry/materials');
      function pixels(): Uint8Array {
        renderer.render(scene, camera);
        const gl = renderer.getContext();
        const data = new Uint8Array(300 * 300 * 4);
        gl.readPixels(0, 0, 300, 300, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return data;
      }
      function changedPixels(before: Uint8Array, after: Uint8Array): number {
        let count = 0;
        for (let index = 0; index < before.length; index += 4)
          if (
            Math.abs((before[index] ?? 0) - (after[index] ?? 0)) > 1 ||
            Math.abs((before[index + 1] ?? 0) - (after[index + 1] ?? 0)) > 1 ||
            Math.abs((before[index + 2] ?? 0) - (after[index + 2] ?? 0)) > 1
          )
            count += 1;
        return count;
      }
      function pixelEnergy(before: Uint8Array, after: Uint8Array): number {
        let energy = 0;
        for (let index = 0; index < before.length; index += 4)
          for (let channel = 0; channel < 3; channel += 1)
            energy += Math.abs(
              (before[index + channel] ?? 0) - (after[index + channel] ?? 0)
            );
        return energy;
      }
      function snapshot(caption: string): void {
        renderer.render(scene, camera);
        const figure = document.createElement('figure');
        figure.style.margin = '12px 0';
        const label = document.createElement('figcaption');
        label.textContent = `VFX FIXTURE · ${caption}`;
        const image = document.createElement('img');
        image.alt = label.textContent;
        image.width = 300;
        image.height = 300;
        image.src = renderer.domElement.toDataURL();
        figure.append(label, image);
        document.body.append(figure);
      }
      for (let index = 0; index <= 20; index += 1) {
        last = frame(index, false);
        effects.update(last);
      }
      const smokeCount = smoke.geometry.drawRange.count;
      const skidCount = skids.geometry.drawRange.count;
      const alpha = smoke.geometry.getAttribute('color');
      const alphaValues = Array.from({ length: smokeCount }, (_, index) =>
        alpha.getW(index)
      );
      effects.object.visible = false;
      const bareRoad = pixels();
      const baselineCalls = renderer.info.render.calls;
      effects.object.visible = true;
      smoke.visible = false;
      dust.visible = false;
      const withSkids = pixels();
      smoke.visible = true;
      const withSmoke = pixels();
      const slipCalls = renderer.info.render.calls;
      snapshot('synthetic road slip and grounded rear-wheel skids');
      if (!last) throw new Error('Missing slip presentation frame');
      for (let update = 0; update < 5; update += 1)
        effects.update({ ...last, phase: 'finished', deltaSeconds: 0.05 });
      smoke.visible = false;
      const agedSkids = pixels();
      smoke.visible = true;
      const agedSmoke = pixels();
      for (let index = 21; index < poses.length; index += 1) {
        last = frame(index, true);
        effects.update(last);
      }
      const dustCount = dust.geometry.drawRange.count;
      dust.visible = false;
      const withoutDust = pixels();
      dust.visible = true;
      const withDust = pixels();
      snapshot('synthetic off-road dust beside the canonical road');
      if (!last) throw new Error('Missing final presentation frame');
      for (let update = 0; update < 130; update += 1)
        effects.update({ ...last, phase: 'finished', deltaSeconds: 0.05 });
      const fadedCounts = [
        smoke.geometry.drawRange.count,
        dust.geometry.drawRange.count,
        skids.geometry.drawRange.count,
      ];
      effects.reset();
      for (let index = 0; index <= 20; index += 1)
        effects.update(frame(index, false));
      const beforeReduced = smoke.geometry.drawRange.count;
      effects.update({ ...frame(21, false), reducedMotion: true });
      const reducedCounts = [
        smoke.geometry.drawRange.count,
        dust.geometry.drawRange.count,
        skids.geometry.drawRange.count,
      ];
      effects.reset();
      const fast = frame(20, false);
      effects.update({ ...fast, state: { ...fast.state, speed: 28, slip: 0 } });
      const streaks = effects.object.getObjectByName('car-speed-streaks');
      if (!(streaks instanceof THREE.Mesh))
        throw new Error('Missing speed streak mesh');
      streaks.visible = false;
      const withoutSpeed = pixels();
      streaks.visible = true;
      const withSpeed = pixels();
      const speedStreakPixels = changedPixels(withoutSpeed, withSpeed);
      const speedStreakCount = streaks.geometry.drawRange.count;
      snapshot('high-speed car-relative wind ribbons');
      effects.update({ ...fast, reducedMotion: true });
      const reducedStreakCount = streaks.geometry.drawRange.count;
      const result = {
        speedStreakPixels,
        speedStreakCount,
        reducedStreakCount,
        smokeCount,
        dustCount,
        skidCount,
        alphaItemSize: alpha.itemSize,
        alphaValues,
        smokeTransparent: smoke.material.transparent,
        smokeDepthWrite: smoke.material.depthWrite,
        smokeDepthTest: smoke.material.depthTest,
        baselineCalls,
        slipCalls,
        skidPixels: changedPixels(bareRoad, withSkids),
        smokePixels: changedPixels(withSkids, withSmoke),
        smokeEnergy: pixelEnergy(withSkids, withSmoke),
        agedSmokeEnergy: pixelEnergy(agedSkids, agedSmoke),
        dustPixels: changedPixels(withoutDust, withDust),
        fadedCounts,
        beforeReduced,
        reducedCounts,
        glError: renderer.getContext().getError(),
      };
      effects.dispose();
      car.dispose();
      road.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        for (const material of materials) material.dispose();
      });
      disposeSceneAssets();
      renderer.dispose();
      return result;
    },
    { track, poses }
  );
  expect(metrics.speedStreakPixels).toBeGreaterThan(0);
  expect(metrics.speedStreakCount).toBe(48);
  expect(metrics.reducedStreakCount).toBe(0);
  expect(metrics.smokeCount).toBeGreaterThan(0);
  expect(metrics.dustCount).toBeGreaterThan(0);
  expect(metrics.skidCount).toBeGreaterThan(0);
  expect(metrics.alphaItemSize).toBe(4);
  expect(metrics.alphaValues.every((alpha) => alpha > 0 && alpha < 1)).toBe(
    true
  );
  expect(metrics.smokeTransparent).toBe(true);
  expect(metrics.smokeDepthWrite).toBe(false);
  expect(metrics.smokeDepthTest).toBe(true);
  expect(metrics.slipCalls - metrics.baselineCalls).toBeLessThanOrEqual(3);
  expect(metrics.skidPixels).toBeGreaterThan(0);
  expect(metrics.smokePixels).toBeGreaterThan(0);
  expect(metrics.agedSmokeEnergy).toBeLessThan(metrics.smokeEnergy);
  expect(metrics.dustPixels).toBeGreaterThan(0);
  expect(metrics.fadedCounts).toEqual([0, 0, 0]);
  expect(metrics.beforeReduced).toBeGreaterThan(0);
  expect(metrics.reducedCounts).toEqual([0, 0, 0]);
  expect(metrics.glError).toBe(0);
  expect(errors).toEqual([]);
  await test.info().attach('vfx-public-module-render', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({
    path: `test-results/feedback-vfx-fixture-${test.info().project.name}.png`,
    fullPage: true,
  });
});
