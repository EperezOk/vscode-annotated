// Renders media/logo.svg -> media/logo.png (256x256) using Playwright's chromium.
// Self-verifies output size and corner transparency; exits non-zero on failure.
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const svgUrl = new URL('../media/logo.svg', import.meta.url);
const pngUrl = new URL('../media/logo.png', import.meta.url);

const svg = await readFile(svgUrl, 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 256, height: 256 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!DOCTYPE html><html><head><style>
      html, body { margin: 0; background: transparent; }
      svg { display: block; width: 256px; height: 256px; }
    </style></head><body>${svg}</body></html>`,
  );
  const png = await page.screenshot({ omitBackground: true });

  // Decode the PNG back in the page to assert size + corner alpha.
  const { width, height, cornerAlpha } = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return {
      width: img.width,
      height: img.height,
      cornerAlpha: ctx.getImageData(0, 0, 1, 1).data[3],
    };
  }, png.toString('base64'));

  if (width !== 256 || height !== 256) {
    throw new Error(`expected 256x256, got ${width}x${height}`);
  }
  if (cornerAlpha !== 0) {
    throw new Error(`corner pixel not transparent (alpha=${cornerAlpha})`);
  }
  await writeFile(pngUrl, png);
  console.log('media/logo.png written (256x256, transparent corners)');
} finally {
  await browser.close();
}
