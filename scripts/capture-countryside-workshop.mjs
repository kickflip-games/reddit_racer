// Actual local-development renders and native-input motion, without scene overrides.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = process.argv[2];
if (!output) throw new Error('Provide a new evidence directory');
await mkdir(output, { recursive: false });
const base = process.env.CAPTURE_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (e) => {
  if (e.type() === 'error') errors.push(e.text());
});
await page.goto(`${base}/environment-gallery.html`);
await page.locator('#environment-status[data-state=ready]').waitFor();
await page.locator('#wind').uncheck();
await page.locator('#course').selectOption('classic');
await page.locator('#seed').fill('showcase-3');
await page.locator('#progress').fill('18');
await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
await page.locator('#environment-status[data-state=ready]').waitFor();
await page
  .locator('#environment-canvas')
  .screenshot({ path: `${output}/soft-light.png` });
await page.locator('#lighting').selectOption('toon');
await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
await page.locator('#environment-status[data-state=ready]').waitFor();
await page
  .locator('#environment-canvas')
  .screenshot({ path: `${output}/toon-light.png` });
await page.locator('#lighting').selectOption('soft');
await page.locator('#course').selectOption('elevated');
await page.locator('#seed').fill('flow-probe-21');
await page.locator('#progress').fill('6');
for (const overlay of ['regions', 'clearance', 'none']) {
  await page.locator('#overlay').selectOption(overlay);
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await page.locator('#environment-status[data-state=ready]').waitFor();
  if (overlay !== 'none')
    await page
      .locator('#environment-canvas')
      .screenshot({ path: `${output}/${overlay}.png` });
}
await page.locator('#gallery-button').click();
await page
  .locator('#environment-gallery[data-state=complete]')
  .waitFor({ timeout: 90000 });
await page
  .locator('#environment-gallery')
  .screenshot({ path: `${output}/twelve-seeds.png` });
await page.screenshot({ path: `${output}/workshop.png`, fullPage: true });
const seeds = await page
  .locator('.environment-card')
  .evaluateAll((nodes) => nodes.map((n) => n.dataset.seed));
await page.close();
const clips = [];
for (const [name, width, height] of [
  ['portrait-motion', 412, 839],
  ['desktop-motion', 960, 720],
]) {
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: output, size: { width, height } },
  });
  const game = await context.newPage();
  game.on('pageerror', (e) => errors.push(e.message));
  await game.goto(
    `${base}/game.html?practice=1&seed=practice-1&sceneryQuality=standard`
  );
  await game.waitForFunction(
    () =>
      document.querySelector('#race')?.dataset.phase === 'ready' &&
      document.querySelector('#race')?.dataset.sceneryArt === 'kenney'
  );
  await game.locator('#start-button').click();
  await game.keyboard.down('Space');
  await game.waitForTimeout(15000);
  await game.keyboard.up('Space');
  const state = await game.locator('#race').evaluate((e) => ({ ...e.dataset }));
  const video = game.video();
  await context.close();
  await video.saveAs(`${output}/${name}.webm`);
  await video.delete();
  clips.push({ name, width, height, state });
}
await browser.close();
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      scope:
        'Actual development previews; twelve canonical seeds; motion clips use real-time native Space input, scripted rather than human playtesting',
      seeds,
      clips,
      errors,
    },
    null,
    2
  )
);
console.log(JSON.stringify({ seeds, errors }));
