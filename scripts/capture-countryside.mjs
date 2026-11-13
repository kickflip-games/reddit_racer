import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const dir = process.env.CAPTURE_DIR ?? process.argv[2];
if (!dir) throw new Error('Provide a new capture directory');
const base = process.env.CAPTURE_URL ?? 'http://127.0.0.1:5173';
await mkdir(dir, { recursive: false });
const browser = await chromium.launch();
const rows = [];
for (const c of [
  ['generated', '?seed=showcase-3', 960, 720, 9000],
  ['hairpin', '?stunt=1', 960, 720, 19000],
  ['straight', '?stunt=1', 960, 720, 40000],
  ['sweeper', '?stunt=1', 960, 720, 36000],
  ['jump', '?elevated=1&seed=flow-probe-21', 960, 720, 4083],
  ['portrait', '?practice=1&seed=practice-1', 412, 839, 9000],
  ['desktop', '?seed=regression-0', 1280, 800, 9000],
]) {
  const [name, q, w, h, ms] = c;
  const page = await browser.newPage({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.clock.install({ time: new Date('2026-11-14T00:00:00Z') });
  await page.goto(base + '/game.html' + q);
  await page.waitForFunction(
    () => document.querySelector('#race')?.dataset.phase === 'ready'
  );
  await page.waitForFunction(
    () =>
      document.querySelector('#race')?.dataset.carLoad === 'ready' &&
      document.querySelector('#race')?.dataset.sceneryArt === 'kenney'
  );
  await page.clock.pauseAt(new Date('2026-11-14T00:01:00Z'));
  await page.locator('#start-button').click();
  await page.keyboard.down('Space');
  let actualMs = ms;
  if (name === 'jump') {
    actualMs = 3100;
    await page.clock.runFor(3100);
    for (let i = 0; i < 160; i++) {
      const d = await page.locator('#race').evaluate((e) => ({ ...e.dataset }));
      if (
        d.airborne === 'true' &&
        Number(d.carHeight) - Number(d.roadHeight) > 0.55
      )
        break;
      await page.clock.runFor(50);
      actualMs += 50;
    }
  } else await page.clock.runFor(ms);
  await page.screenshot({ path: `${dir}/${name}.png` });
  rows.push({
    name,
    q,
    w,
    h,
    ms: actualMs,
    errors,
    state: await page.locator('#race').evaluate((e) => ({ ...e.dataset })),
    progress: await page
      .locator('#lap-progress')
      .evaluate((e) => ({ value: e.value, max: e.max })),
  });
  await page.close();
}
await browser.close();
await writeFile(`${dir}/manifest.json`, JSON.stringify(rows, null, 2));
console.log(
  JSON.stringify(
    rows.map(({ name, errors, progress }) => ({ name, errors, progress }))
  )
);
