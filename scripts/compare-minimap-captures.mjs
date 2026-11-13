// Read-only comparison of paired native screenshots and observed game metadata.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [beforeDir, afterDir, output] = process.argv.slice(2);
if (!output)
  throw new Error(
    'Usage: node scripts/compare-minimap-captures.mjs BEFORE AFTER NEW_REPORT.json'
  );
const before = JSON.parse(
  await readFile(join(beforeDir, 'manifest.json'), 'utf8')
);
const after = JSON.parse(
  await readFile(join(afterDir, 'manifest.json'), 'utf8')
);
const browser = await chromium.launch(),
  page = await browser.newPage();
const comparisons = [];
for (const a of after) {
  const b = before.find((r) => r.name === a.name);
  if (!b) throw new Error(`Missing baseline ${a.name}`);
  const oldImage = (await readFile(join(beforeDir, a.name + '.png'))).toString(
    'base64'
  );
  const newImage = (await readFile(join(afterDir, a.name + '.png'))).toString(
    'base64'
  );
  const pixels = await page.evaluate(
    async ({ oldImage, newImage, box }) => {
      async function decode(base64) {
        const image = new Image();
        image.src = 'data:image/png;base64,' + base64;
        await image.decode();
        return image;
      }
      const old = await decode(oldImage),
        current = await decode(newImage);
      if (old.width !== current.width || old.height !== current.height)
        throw new Error('Mismatched image sizes');
      const canvas = document.createElement('canvas');
      canvas.width = old.width;
      canvas.height = old.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(old, 0, 0);
      const first = context.getImageData(0, 0, old.width, old.height).data;
      context.drawImage(current, 0, 0);
      const second = context.getImageData(0, 0, old.width, old.height).data;
      let outsidePixels = 0,
        outsideChanged = 0,
        outsideChangedOver8 = 0,
        outsideMaximum = 0,
        insideChanged = 0;
      for (let i = 0; i < first.length; i += 4) {
        const x = (i / 4) % old.width,
          y = Math.floor(i / 4 / old.width);
        const inside =
          x >= Math.floor(box.x) - 1 &&
          x < Math.ceil(box.x + box.width) + 1 &&
          y >= Math.floor(box.y) - 1 &&
          y < Math.ceil(box.y + box.height) + 1;
        const difference = Math.max(
          Math.abs(first[i] - second[i]),
          Math.abs(first[i + 1] - second[i + 1]),
          Math.abs(first[i + 2] - second[i + 2])
        );
        if (inside) {
          if (difference) insideChanged++;
        } else {
          outsidePixels++;
          if (difference) outsideChanged++;
          if (difference > 8) outsideChangedOver8++;
          outsideMaximum = Math.max(outsideMaximum, difference);
        }
      }
      return {
        outsidePixels,
        outsideChanged,
        outsideChangedOver8,
        outsideMaximum,
        insideChanged,
      };
    },
    { oldImage, newImage, box: a.map.box }
  );
  comparisons.push({
    name: a.name,
    progressEqual: JSON.stringify(a.progress) === JSON.stringify(b.progress),
    drawCallsEqual: a.state.drawCalls === b.state.drawCalls,
    trianglesEqual: a.state.triangles === b.state.triangles,
    canvasesBefore: b.canvases,
    canvasesAfter: a.canvases,
    backendRequestsBefore: b.backendRequests,
    backendRequestsAfter: a.backendRequests,
    browserErrors: [...b.errors, ...a.errors],
    pixels,
  });
}
await browser.close();
await writeFile(
  output,
  JSON.stringify(
    {
      scope:
        'Same input/virtual clock/viewports; unmodified game captures. Pixel comparison excludes only the minimap rectangle plus a 1px border; no image is edited.',
      comparisons,
    },
    null,
    2
  ),
  { flag: 'wx' }
);
console.log(JSON.stringify(comparisons));
if (
  comparisons.some(
    (r) =>
      !r.progressEqual ||
      !r.drawCallsEqual ||
      !r.trianglesEqual ||
      r.canvasesBefore !== r.canvasesAfter ||
      r.browserErrors.length ||
      r.pixels.outsideChanged !== 0 ||
      r.pixels.insideChanged === 0 ||
      JSON.stringify(r.backendRequestsBefore) !==
        JSON.stringify(r.backendRequestsAfter)
  )
)
  process.exitCode = 1;
