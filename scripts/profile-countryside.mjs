// Paired local-development measurements, real input/RAF, no simulation overrides.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release } from 'node:os';
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const machine = {
  cpu: cpus()[0]?.model,
  logicalCores: cpus().length,
  platform: platform(),
  release: release(),
};
const output = process.argv[2];
if (!output)
  throw new Error(
    'Usage: node scripts/profile-countryside.mjs NEW_OUTPUT_DIRECTORY'
  );
await mkdir(output, { recursive: false });
const browser = await chromium.launch({
  args: ['--enable-precise-memory-info'],
});
const records = [];
for (const [label, url, width, height] of [
  ['before-portrait', 'http://127.0.0.1:5184', 412, 839],
  ['after-portrait', 'http://127.0.0.1:5173', 412, 839],
  ['after-desktop', 'http://127.0.0.1:5173', 960, 720],
  ['before-desktop', 'http://127.0.0.1:5184', 960, 720],
  ['after-light', 'http://127.0.0.1:5173', 412, 839],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  await page.addInitScript(() => {
    const observed = new WeakSet(),
      live = Object.fromEntries(
        ['Buffer', 'Texture', 'Program', 'VertexArray'].map((k) => [
          k,
          new Set(),
        ])
      );
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const gl = Reflect.apply(original, this, args);
      if (args[0] === 'webgl2' && gl && !observed.has(gl)) {
        observed.add(gl);
        for (const key of Object.keys(live))
          for (const prefix of ['create', 'delete']) {
            const name = prefix + key,
              call = gl[name];
            gl[name] = function (...a) {
              const result = Reflect.apply(call, this, a);
              if (prefix === 'create' && result) live[key].add(result);
              else if (prefix === 'delete') live[key].delete(a[0]);
              return result;
            };
          }
      }
      return gl;
    };
    const data = { frames: [], drawing: [], measuring: false, live };
    window.__countrysideProfile = data;
    let previous;
    function frame(time) {
      if (data.measuring && previous !== undefined) {
        data.frames.push(time - previous);
        const race = document.querySelector('#race');
        if (race)
          data.drawing.push({
            calls: Number(race.dataset.drawCalls),
            triangles: Number(race.dataset.triangles),
          });
      }
      previous = time;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  const start = performance.now();
  await page.goto(
    `${url}/game.html?practice=1&seed=practice-1&sceneryQuality=${label === 'after-light' ? 'light&wind=0' : 'standard'}`
  );
  await page.waitForFunction(
    () =>
      document.querySelector('#race')?.dataset.phase === 'ready' &&
      document.querySelector('#race')?.dataset.carLoad === 'ready' &&
      document.querySelector('#race')?.dataset.sceneryArt === 'kenney'
  );
  const loadMilliseconds = performance.now() - start;
  const session = await context.newCDPSession(page);
  await session.send('HeapProfiler.collectGarbage');
  const heapStart = await page.evaluate(
    () => performance.memory?.usedJSHeapSize ?? null
  );
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.waitForFunction(
    () => document.querySelector('#race')?.dataset.phase === 'racing'
  );
  await page.evaluate(() => {
    window.__countrysideProfile.measuring = true;
  });
  await page.waitForTimeout(12000);
  const measured = await page.evaluate(() => {
    const p = window.__countrysideProfile;
    p.measuring = false;
    const sorted = [...p.frames].sort((a, b) => a - b),
      mean = p.frames.reduce((a, b) => a + b, 0) / p.frames.length;
    const canvas = document.querySelector('#race-canvas'),
      gl = canvas.getContext('webgl2'),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      frames: p.frames.length,
      rawFrameMs: p.frames,
      rawDrawSamples: p.drawing,
      frameMs: {
        mean,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        max: sorted.at(-1),
      },
      calls: {
        min: Math.min(...p.drawing.map((x) => x.calls)),
        max: Math.max(...p.drawing.map((x) => x.calls)),
      },
      triangles: {
        min: Math.min(...p.drawing.map((x) => x.triangles)),
        max: Math.max(...p.drawing.map((x) => x.triangles)),
      },
      gpu: Object.fromEntries(
        Object.entries(p.live).map(([k, v]) => [k, v.size])
      ),
      renderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : 'unavailable',
      state: { ...document.querySelector('#race').dataset },
    };
  });
  await page.keyboard.up('Space');
  await page.screenshot({ path: join(output, `${label}.png`) });
  const regenerations = [];
  if (label === 'after-portrait' || label === 'before-portrait')
    for (let i = 0; i < 5; i++) {
      await page.locator('#race-settings > summary').click();
      await page.locator('#next-practice-button').click();
      await page.waitForFunction(
        () =>
          document.querySelector('#race')?.dataset.phase === 'ready' &&
          document.querySelector('#race')?.dataset.carLoad === 'ready' &&
          document.querySelector('#race')?.dataset.sceneryArt === 'kenney'
      );
      await session.send('HeapProfiler.collectGarbage');
      regenerations.push(
        await page.evaluate(() => ({
          heap: performance.memory?.usedJSHeapSize ?? null,
          gpu: Object.fromEntries(
            Object.entries(window.__countrysideProfile.live).map(([k, v]) => [
              k,
              v.size,
            ])
          ),
          state: { ...document.querySelector('#race').dataset },
        }))
      );
    }
  records.push({
    label,
    sourceCommit: label.startsWith('before')
      ? '27922a1477301fd99ae87c88aa210aa32c5fb656'
      : sourceCommit,
    machine,
    scope:
      'Mac headless Chromium; development server; native input and real-time frames; instrumentation shared by both sources; no physical-phone claim',
    width,
    height,
    loadMilliseconds,
    heapStart,
    measured,
    regenerations,
    errors,
  });
  await writeFile(
    join(output, `${label}.json`),
    JSON.stringify(records.at(-1), null, 2),
    { flag: 'wx' }
  );
  await context.close();
}
await browser.close();
await writeFile(
  join(output, 'performance.json'),
  JSON.stringify(records, null, 2),
  { flag: 'wx' }
);
console.log(
  JSON.stringify(
    records.map((r) => ({
      label: r.label,
      load: r.loadMilliseconds,
      frameMs: r.measured.frameMs,
      calls: r.measured.calls,
      triangles: r.measured.triangles,
      errors: r.errors,
    }))
  )
);
