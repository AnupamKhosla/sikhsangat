import { chromium } from 'playwright-extra';
import path from 'path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import fs from 'fs-extra';

const OUTPUT_DIR = path.join(process.cwd(), 'docs');

let browser = null;
let context = null;

async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  }
  return { browser, context };
}

function cropPng(source, width, height) {
  const target = new PNG({ width, height });
  PNG.bitblt(source, target, 0, 0, width, height, 0, 0);
  return target;
}

async function shutdown() {
  if (context) {
    await context.close().catch(() => {});
    context = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

async function runTest(url, localPath, liveScreenshotPath) {
  const { context: sharedContext } = await initBrowser();
  const page = await sharedContext.newPage();
  const relPath = path.relative(OUTPUT_DIR, localPath);

  try {
    await page.goto(`file://${localPath}`, { waitUntil: 'networkidle', timeout: 30000 });
    const mirrorScreenshotBuffer = await page.screenshot({ fullPage: true });

    const liveScreenshotBuffer = await fs.readFile(liveScreenshotPath);
    const livePng = PNG.sync.read(liveScreenshotBuffer);
    const mirrorPng = PNG.sync.read(mirrorScreenshotBuffer);

    const width = Math.min(livePng.width, mirrorPng.width);
    const height = Math.min(livePng.height, mirrorPng.height);
    const croppedLive = cropPng(livePng, width, height);
    const croppedMirror = cropPng(mirrorPng, width, height);

    const diffPixels = pixelmatch(
      croppedLive.data,
      croppedMirror.data,
      null,
      width,
      height,
      { threshold: 0.1 },
    );
    const score = ((width * height - diffPixels) / (width * height)) * 100;

    process.send?.({ type: 'RESULT', relPath, score: score.toFixed(2), url });
  } catch (error) {
    process.send?.({ type: 'ERROR', relPath, error: error.message, url });
  } finally {
    await page.close().catch(() => {});
    if (await fs.pathExists(liveScreenshotPath)) {
      await fs.remove(liveScreenshotPath);
    }
  }
}

process.on('message', async (message) => {
  if (message.type === 'SHUTDOWN') {
    await shutdown();
    process.exit(0);
  }

  if (message.url && message.localPath && message.liveScreenshotPath) {
    await runTest(message.url, message.localPath, message.liveScreenshotPath);
  }
});

process.on('disconnect', async () => {
  await shutdown();
  process.exit(0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await shutdown();
    process.exit(0);
  });
}
