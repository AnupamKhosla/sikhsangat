import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, '..', 'docs');
const LIVE_URL = 'https://www.sikhsangat.com/index.php?/topic/87696-whats-your-favourite-music-genre/';
const LOCAL_PATH = path.join(DOCS, 'www.sikhsangat.com/topic/87696-whats-your-favourite-music-genre/index.html');
const OUT = path.join(__dirname, '..', 'logs', 'diag');

async function dumpPageState(page, label) {
  const state = await page.evaluate(() => {
    const q = (sel) => [...document.querySelectorAll(sel)];
    return {
      title: document.title,
      url: location.href,
      tabs: q('[data-role="tab"], [role="tab"], .ipsTabs_item, [data-tab-href]').map(el => ({
        text: el.textContent?.trim().slice(0, 60),
        tag: el.tagName,
        classes: el.className?.slice?.(0, 100) || '',
        hidden: el.offsetParent === null,
      })),
      tabPanels: q('[data-role="tabPanel"], [role="tabpanel"], .ipsTabs_panel').map(el => ({
        id: el.id,
        hidden: el.hidden || el.offsetParent === null,
        childCount: el.children.length,
      })),
      buttons: q('button, [data-action], a.ipsButton, .ipsComment_button').map(el => ({
        text: el.textContent?.trim().slice(0, 50),
        action: el.getAttribute('data-action') || '',
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        classes: el.className?.slice?.(0, 80) || '',
      })).filter(b => b.text),
      forms: q('form').map(f => ({
        action: f.action,
        method: f.method,
        id: f.id,
      })),
      controllers: q('[data-controller]').map(el => el.getAttribute('data-controller')).filter((v, i, a) => a.indexOf(v) === i),
      pagination: q('.ipsPagination a, .ipsPagination__link').map(a => ({
        text: a.textContent?.trim(),
        href: a.getAttribute('href')?.slice(0, 80),
      })),
      loadMore: q('[data-action="loadMore"], .ipsLoadMore, [data-loadmore]').map(el => ({
        text: el.textContent?.trim().slice(0, 50),
        action: el.getAttribute('data-action'),
      })),
      images: q('img').length,
      brokenImages: q('img').filter(img => !img.complete || img.naturalWidth === 0).length,
      scripts: q('script[src]').map(s => s.src).filter(s => s.includes('sikhsangat') || s.includes('file://')),
      bodyClasses: document.body?.className?.slice(0, 200) || '',
      offlineAttr: document.body?.getAttribute('data-offline-mirror'),
    };
  });
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(state, null, 2));
  return state;
}

async function run() {
  await fs.ensureDir(OUT);
  const browser = await chromium.launch({ headless: true });

  console.log('--- LIVE PAGE ---');
  const liveCtx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1200 },
  });
  const livePage = await liveCtx.newPage();
  const liveErrors = [];
  livePage.on('console', msg => { if (msg.type() === 'error') liveErrors.push(msg.text().slice(0, 120)); });
  livePage.on('pageerror', err => liveErrors.push(err.message.slice(0, 120)));

  await livePage.goto(LIVE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await livePage.waitForTimeout(3000);
  const liveState = await dumpPageState(livePage, 'LIVE');
  await livePage.screenshot({ path: path.join(OUT, 'live.png'), fullPage: false });
  console.log(`Live JS errors: ${liveErrors.length}`);
  liveErrors.slice(0, 5).forEach(e => console.log(`  ERR: ${e}`));
  await liveCtx.close();

  console.log('\n--- CLONED PAGE ---');
  const localCtx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const localPage = await localCtx.newPage();
  const localErrors = [];
  localPage.on('console', msg => { if (msg.type() === 'error') localErrors.push(msg.text().slice(0, 120)); });
  localPage.on('pageerror', err => localErrors.push(err.message.slice(0, 120)));

  await localPage.goto(`file://${LOCAL_PATH}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await localPage.waitForTimeout(3000);
  const localState = await dumpPageState(localPage, 'CLONED');
  await localPage.screenshot({ path: path.join(OUT, 'cloned.png'), fullPage: false });
  console.log(`Cloned JS errors: ${localErrors.length}`);
  localErrors.slice(0, 10).forEach(e => console.log(`  ERR: ${e}`));
  await localCtx.close();

  console.log('\n--- COMPARISON ---');
  console.log(`Tabs: live=${liveState.tabs.length} cloned=${localState.tabs.length}`);
  console.log(`TabPanels: live=${liveState.tabPanels.length} cloned=${localState.tabPanels.length}`);
  console.log(`Buttons: live=${liveState.buttons.length} cloned=${localState.buttons.length}`);
  console.log(`Forms: live=${liveState.forms.length} cloned=${localState.forms.length}`);
  console.log(`Pagination: live=${liveState.pagination.length} cloned=${localState.pagination.length}`);
  console.log(`LoadMore: live=${liveState.loadMore.length} cloned=${localState.loadMore.length}`);
  console.log(`Images: live=${liveState.images} cloned=${localState.images}`);
  console.log(`Broken images (cloned): ${localState.brokenImages}`);
  console.log(`Controllers: live=${liveState.controllers.length} cloned=${localState.controllers.length}`);
  console.log(`Scripts (cloned): ${localState.scripts.length}`);
  console.log(`Offline attr: ${localState.offlineAttr}`);

  await fs.writeJson(path.join(OUT, 'comparison.json'), { live: liveState, cloned: localState, liveErrors, localErrors }, { spaces: 2 });
  console.log(`\nFull report: ${path.join(OUT, 'comparison.json')}`);
  console.log(`Screenshots: ${path.join(OUT, 'live.png')} / ${path.join(OUT, 'cloned.png')}`);

  await browser.close();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
