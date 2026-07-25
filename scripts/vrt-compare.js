import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, '..', 'docs');
const OUT = path.join(__dirname, '..', 'logs', 'vrt');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const VIEWPORT = { width: 1440, height: 1200 };

const PAGES = [
  {
    name: 'homepage',
    live: 'https://www.sikhsangat.com/',
    local: path.join(DOCS, 'www.sikhsangat.com/index.html'),
  },
  {
    name: 'forum-listing',
    live: 'https://www.sikhsangat.com/index.php?/forum/2-whats-happening/',
    local: path.join(DOCS, 'www.sikhsangat.com/forum/2-whats-happening/index.html'),
  },
  {
    name: 'topic-page',
    live: 'https://www.sikhsangat.com/index.php?/topic/87696-whats-your-favourite-music-genre/',
    local: path.join(DOCS, 'www.sikhsangat.com/topic/87696-whats-your-favourite-music-genre/index.html'),
  },
];

const OFFLINE_MASK_JS = `
(() => {
  const hide = (sel) => document.querySelectorAll(sel).forEach(el => { el.style.setProperty('display','none','important'); });
  hide('a[href*="login"], a[href*="register"], #elSignInButton, #elUserSignIn, .ipsSignIn');
  hide('[data-action="replyToTopic"], [data-action="quoteComment"], [data-action="reportComment"]');
  hide('.ipsComposeArea, #elFullpageReply, [data-role="replyForm"], [data-role="commentForm"]');
  hide('#elGuestTerms, [data-role="guestTermsBar"]');
  hide('[data-controller*="forums.front.topic.reply"], [data-controller*="cloud.front.realtime"]');
  hide('[data-action="dismissTerms"]');
  hide('[data-controller*="announcementBanner"], #elAnnouncement, .ipsAnnouncement, [data-role="announcementBanner"]');
})();
`;

async function screenshot(page, { liveUrl, localHtmlPath, outPngPath, mask = false }) {
  if (localHtmlPath) {
    await page.goto(`file://${localHtmlPath}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } else {
    await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await page.waitForTimeout(2500);
  if (mask) {
    await page.evaluate(OFFLINE_MASK_JS).catch(() => {});
    await page.waitForTimeout(300);
  }
  const buf = await page.screenshot({ fullPage: false });
  await fs.writeFile(outPngPath, buf);
  return buf;
}

function compareImages(liveBuf, cloneBuf, diffPath) {
  const live = PNG.sync.read(liveBuf);
  const clone = PNG.sync.read(cloneBuf);

  const width = Math.min(live.width, clone.width);
  const height = Math.min(live.height, clone.height);

  const liveCropped = cropPng(live, width, height);
  const cloneCropped = cropPng(clone, width, height);
  const diff = new PNG({ width, height });

  const mismatchedPixels = pixelmatch(
    liveCropped.data, cloneCropped.data, diff.data,
    width, height,
    { threshold: 0.15, includeAA: false },
  );

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const matchPercent = ((1 - mismatchedPixels / totalPixels) * 100).toFixed(2);
  return { mismatchedPixels, totalPixels, matchPercent, width, height };
}

function cropPng(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const cropped = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      cropped.data[dstIdx] = png.data[srcIdx];
      cropped.data[dstIdx + 1] = png.data[srcIdx + 1];
      cropped.data[dstIdx + 2] = png.data[srcIdx + 2];
      cropped.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return cropped;
}

async function run() {
  await fs.ensureDir(OUT);
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const pg of PAGES) {
    console.log(`\n=== ${pg.name} ===`);

    if (!fs.existsSync(pg.local)) {
      console.log(`  SKIP: local file not found`);
      results.push({ name: pg.name, status: 'SKIP' });
      continue;
    }

    const liveCtx = await browser.newContext({ userAgent: UA, viewport: VIEWPORT });
    const livePage = await liveCtx.newPage();
    const liveBuf = await screenshot(livePage, { liveUrl: pg.live, outPngPath: path.join(OUT, `${pg.name}-live.png`), mask: true });
    await liveCtx.close();

    const cloneCtx = await browser.newContext({ viewport: VIEWPORT });
    const clonePage = await cloneCtx.newPage();
    const cloneBuf = await screenshot(clonePage, { localHtmlPath: pg.local, outPngPath: path.join(OUT, `${pg.name}-clone.png`) });
    await cloneCtx.close();

    const cmp = compareImages(liveBuf, cloneBuf, path.join(OUT, `${pg.name}-diff.png`));
    console.log(`  Match: ${cmp.matchPercent}% (${cmp.mismatchedPixels}/${cmp.totalPixels} pixels differ)`);
    console.log(`  Screenshots: ${pg.name}-live.png / ${pg.name}-clone.png / ${pg.name}-diff.png`);
    results.push({ name: pg.name, ...cmp });

    await new Promise(r => setTimeout(r, 1000));
  }

  await browser.close();

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    if (r.status === 'SKIP') { console.log(`  ${r.name}: SKIPPED`); continue; }
    const grade = r.matchPercent >= 90 ? 'PASS' : r.matchPercent >= 70 ? 'WARN' : 'FAIL';
    console.log(`  ${grade} ${r.name}: ${r.matchPercent}% match`);
  }
  console.log(`\nAll outputs in: ${OUT}`);
  await fs.writeJson(path.join(OUT, 'results.json'), results, { spaces: 2 });
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
