// Native-input, paired local game captures. No camera, simulation or HUD overrides.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const output = process.argv[2];
if (!output)
  throw new Error('Usage: node scripts/capture-minimap.mjs NEW_DIRECTORY');
const base = process.env.CAPTURE_URL ?? 'http://127.0.0.1:5173';
await mkdir(dirname(output), { recursive: true });
await mkdir(output, { recursive: false });
const browser = await chromium.launch();
const cases = [];
for (let i = 0; i < 6; i++)
  for (const [view, width, height] of [
    ['desktop', 960, 720],
    ['portrait', 412, 839],
  ]) {
    cases.push({
      name: `minimap-${i}-${view}`,
      query: `?${i >= 4 ? 'elevated=1&' : ''}seed=minimap-${i}`,
      width,
      height,
      ms: 9000,
    });
  }
for (const [view, width, height] of [
  ['desktop', 960, 720],
  ['portrait', 412, 839],
])
  cases.push({
    name: `hairpin-${view}`,
    query: '?stunt=1',
    width,
    height,
    ms: 19000,
  });
cases.push({
  name: 'small-portrait',
  query: '?seed=minimap-0',
  width: 320,
  height: 568,
  ms: 9000,
});
const records = [];
for (const c of cases) {
  const page = await browser.newPage({
    viewport: { width: c.width, height: c.height },
    deviceScaleFactor: 1,
  });
  const errors = [],
    backendRequests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error') errors.push(e.text());
  });
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/'))
      backendRequests.push(new URL(r.url()).pathname);
  });
  await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
  await page.goto(`${base}/game.html${c.query}`);
  await page.waitForFunction(
    () =>
      document.querySelector('#race')?.dataset.phase === 'ready' &&
      document.querySelector('#race')?.dataset.sceneryArt === 'kenney' &&
      document.querySelector('#race')?.dataset.carLoad === 'ready'
  );
  await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  await page.clock.runFor(c.ms);
  await page.screenshot({ path: join(output, `${c.name}.png`) });
  const map = page.locator('#circuit-minimap');
  if (await map.count())
    await map.screenshot({ path: join(output, `${c.name}-map.png`) });
  const record = await page.evaluate(() => {
    const progress = document.querySelector('#lap-progress'),
      map = document.querySelector('#circuit-minimap');
    return {
      state: { ...document.querySelector('#race').dataset },
      progress: { value: progress.value, max: progress.max },
      map: map
        ? {
            box: map.getBoundingClientRect().toJSON(),
            description: document
              .querySelector('#minimap-progress')
              .getAttribute('aria-valuetext'),
            stroke: document
              .querySelector('#minimap-completed')
              .getAttribute('stroke-dashoffset'),
            x: document.querySelector('#minimap-player').getAttribute('cx'),
            y: document.querySelector('#minimap-player').getAttribute('cy'),
          }
        : null,
      canvases: document.querySelectorAll('canvas').length,
    };
  });
  records.push({ ...c, ...record, errors, backendRequests });
  await page.close();
  console.log(c.name, record.progress.value, errors.length);
}
await browser.close();
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify(records, null, 2)
);
