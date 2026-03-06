import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import PQueue from 'p-queue';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {
  OUTPUT_DIR,
  ROOT_DIR,
  PRIMARY_HOST,
  TARGET_HOSTS,
  ensureOfflineSupportFiles,
  getLocalPath,
  isTargetHost,
  normalizeRemoteUrl,
  rewriteCssContent,
  rewriteHtmlContent,
  rewriteJavascriptMapContent,
} from './mirror-utils.js';

chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SEED_FILE = path.join(ROOT_DIR, 'seed_urls.json');
const SEED_FILE = process.env.SCRAPER_SEED_FILE
  ? path.resolve(ROOT_DIR, process.env.SCRAPER_SEED_FILE)
  : DEFAULT_SEED_FILE;
const CONFIG_FILE = path.join(ROOT_DIR, 'logs', 'scraper_config.json');
const BASE_URL = `https://${PRIMARY_HOST}/`;
const PAGE_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 45000;
const NON_PAGE_PATH_PREFIXES = ['/applications/', '/interface/', '/plugins/', '/uploads/'];
const BLOCKED_PAGE_PATH_PREFIXES = ['/search/'];
const SERVER_OUTAGE_THRESHOLD = 5;
const SERVER_OUTAGE_PAUSE_MS = 5 * 60 * 1000;
const BLOCKED_DO_VALUES = new Set([
  'add',
  'addcomment',
  'comment',
  'email',
  'embed',
  'findcomment',
  'getlastcomment',
  'getnewcomment',
  'moderate',
  'nextunreadcomment',
  'preview',
  'quotecomment',
  'report',
  'reportcomment',
  'showcomment',
  'showrepliescomment',
  'showreactionscomment',
]);
const BLOCKED_QUERY_PAIRS = [
  ['recommended', 'comments'],
  ['controller', 'editor'],
  ['module', 'system'],
];
const PAGE_PRIORITIES = {
  seed: 0,
  discovered: 10,
  related: 20,
  pagination: 30,
};

let config = {
  downloadedCount: 0,
  currentJitter: 2000,
  maxConcurrency: PAGE_CONCURRENCY,
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = fs.readJsonSync(CONFIG_FILE);
    config = { ...config, ...saved, maxConcurrency: PAGE_CONCURRENCY };
  } catch {}
}

const pageQueue = new PQueue({ concurrency: PAGE_CONCURRENCY });
const assetQueue = new PQueue({ concurrency: PAGE_CONCURRENCY });
const queuedPages = new Set();
const visitedPages = new Set();
const queuedAssets = new Set();

let lastBatchTime = 0;
let requestsInCurrentBatch = 0;
const BATCH_SIZE = 2;
let consecutiveServerErrors = 0;

function cleanAnsi(value = '') {
  return value.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

async function logAction(message) {
  const timestamp = new Date().toLocaleTimeString();
  const decorated = `\x1b[1;34m[${timestamp}] [MIRROR] ${message}\x1b[0m`;
  console.log(decorated);

  try {
    await axios.post(
      'http://127.0.0.1:3000/log',
      {
        msg: `[${timestamp}] ${cleanAnsi(message)}`,
        config,
      },
      { timeout: 1000 },
    );
  } catch {}
}

function saveConfig() {
  fs.outputJsonSync(CONFIG_FILE, config, { spaces: 2 });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function rateLimit() {
  if (requestsInCurrentBatch >= BATCH_SIZE) {
    const now = Date.now();
    const elapsed = now - lastBatchTime;
    if (elapsed < config.currentJitter) {
      await sleep(config.currentJitter - elapsed);
    }
    lastBatchTime = Date.now();
    requestsInCurrentBatch = 0;
  }

  requestsInCurrentBatch += 1;
  if (lastBatchTime === 0) {
    lastBatchTime = Date.now();
  }
}

function splitRouteAndParams(url) {
  let pathname = url.pathname || '/';
  let params = new URLSearchParams(url.search);

  if (pathname === '/index.php' && url.search.startsWith('?/')) {
    const routed = url.search.slice(2);
    const ampIndex = routed.indexOf('&');
    const routePart = ampIndex === -1 ? routed : routed.slice(0, ampIndex);
    pathname = `/${routePart.replace(/^\/+/, '')}`;
    params = new URLSearchParams(ampIndex === -1 ? '' : routed.slice(ampIndex + 1));
  }

  pathname = pathname.replace(/\/+/g, '/');
  if (!pathname.startsWith('/')) {
    pathname = `/${pathname}`;
  }

  return { pathname, params };
}

function hasBlockedPageParams(params) {
  const doValue = params.get('do');
  if (doValue && BLOCKED_DO_VALUES.has(doValue.toLowerCase())) {
    return true;
  }

  return BLOCKED_QUERY_PAIRS.some(([key, value]) => {
    const paramValue = params.get(key);
    return paramValue && paramValue.toLowerCase() === value;
  });
}

function shouldIgnoreUrl(url) {
  const normalized = normalizeRemoteUrl(url, BASE_URL);
  if (!normalized) {
    return true;
  }

  const parsed = new URL(normalized);
  if (!isTargetHost(parsed.hostname)) {
    return true;
  }

  const { pathname, params } = splitRouteAndParams(parsed);
  const loweredPathname = pathname.toLowerCase().replace(/\/+$/, '') || '/';

  if (BLOCKED_PAGE_PATH_PREFIXES.some((prefix) => loweredPathname.startsWith(prefix))) {
    return true;
  }

  if (hasBlockedPageParams(params)) {
    return true;
  }

  return loweredPathname === '/browserconfig.xml' || loweredPathname === '/site.webmanifest';
}

async function applyServerBackoff(url, statusOrReason) {
  consecutiveServerErrors += 1;
  const backoffMs = Math.max(config.currentJitter * 2, Math.min(30000, consecutiveServerErrors * 5000));
  lastBatchTime = Date.now();
  requestsInCurrentBatch = 0;
  await logAction(`[BACKOFF] ${url} after ${statusOrReason}; sleeping ${backoffMs}ms`);
  await sleep(backoffMs);

  if (consecutiveServerErrors >= SERVER_OUTAGE_THRESHOLD) {
    await logAction(
      `[PAUSE] ${consecutiveServerErrors} consecutive server errors; sleeping ${SERVER_OUTAGE_PAUSE_MS}ms before retrying the frontier.`,
    );
    await sleep(SERVER_OUTAGE_PAUSE_MS);
    consecutiveServerErrors = 0;
  }
}

function clearServerBackoff() {
  consecutiveServerErrors = 0;
}

function isPageUrl(url) {
  const normalized = normalizeRemoteUrl(url, BASE_URL);
  if (!normalized) {
    return false;
  }
  const parsed = new URL(normalized);
  if (!isTargetHost(parsed.hostname) || parsed.hostname === 'files.sikhsangat.com') {
    return false;
  }

  const { pathname, params } = splitRouteAndParams(parsed);
  const loweredPathname = pathname.toLowerCase();
  const extension = path.extname(pathname);
  if (NON_PAGE_PATH_PREFIXES.some((prefix) => loweredPathname.startsWith(prefix))) {
    return false;
  }

  if (BLOCKED_PAGE_PATH_PREFIXES.some((prefix) => loweredPathname.startsWith(prefix))) {
    return false;
  }

  if (hasBlockedPageParams(params)) {
    return false;
  }

  return (
    loweredPathname === '/' ||
    loweredPathname === '/index.php' ||
    loweredPathname.endsWith('/index.php') ||
    extension === '.html' ||
    extension === '.htm' ||
    !extension
  );
}

function isPaginationUrl(url) {
  const normalized = normalizeRemoteUrl(url, BASE_URL);
  if (!normalized) {
    return false;
  }

  return /\/page\/\d+(?:\/|$)|(?:[?&](?:page|p)=\d+\b)/i.test(normalized);
}

function getPageGroup(url) {
  const normalized = normalizeRemoteUrl(url, BASE_URL);
  if (!normalized) {
    return '';
  }

  return normalized
    .replace(/\/page\/\d+(?=\/|$).*/i, '')
    .replace(/([?&](?:page|p)=)\d+\b/gi, '$1');
}

function getPagePriority(url, sourceUrl = null) {
  if (!sourceUrl) {
    return PAGE_PRIORITIES.seed;
  }

  if (isPaginationUrl(url)) {
    return PAGE_PRIORITIES.pagination;
  }

  return getPageGroup(url) === getPageGroup(sourceUrl)
    ? PAGE_PRIORITIES.related
    : PAGE_PRIORITIES.discovered;
}

function queuePage(url, options = {}) {
  const normalized = normalizeRemoteUrl(url, BASE_URL);
  const priority = Number.isFinite(options.priority) ? options.priority : PAGE_PRIORITIES.seed;
  if (!normalized || shouldIgnoreUrl(normalized) || !isPageUrl(normalized) || visitedPages.has(normalized)) {
    return;
  }

  if (queuedPages.has(normalized)) {
    try {
      pageQueue.setPriority(normalized, priority);
    } catch {}
    return;
  }

  queuedPages.add(normalized);
  pageQueue.add(() => processPage(normalized), { priority, id: normalized }).catch((error) => {
    queuedPages.delete(normalized);
    logAction(`[ERROR] Failed to queue page ${normalized}: ${error.message}`);
  });
}

function queueAsset(url, sourceUrl = null) {
  const normalized = normalizeRemoteUrl(url, BASE_URL);
  if (!normalized || shouldIgnoreUrl(normalized)) {
    return;
  }

  if (isPageUrl(normalized)) {
    queuePage(normalized, { priority: getPagePriority(normalized, sourceUrl) });
    return;
  }

  const parsed = new URL(normalized);
  if (!TARGET_HOSTS.has(parsed.hostname) || queuedAssets.has(normalized)) {
    return;
  }

  queuedAssets.add(normalized);
  assetQueue.add(() => downloadAsset(normalized)).catch((error) => {
    queuedAssets.delete(normalized);
    logAction(`[ERROR] Failed to queue asset ${normalized}: ${error.message}`);
  });
}

async function writeAssetFile(url, body, headers = {}) {
  const filePath = getLocalPath(url, { isAsset: true });
  const contentType = (headers['content-type'] || '').toLowerCase();

  await fs.ensureDir(path.dirname(filePath));

  if (contentType.includes('text/css') || filePath.endsWith('.css')) {
    const cssContent = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    const rewritten = rewriteCssContent(cssContent, url);
    await fs.writeFile(filePath, rewritten.content, 'utf8');
    rewritten.assetUrls.forEach((assetUrl) => queueAsset(assetUrl, url));
    return;
  }

  if (filePath.endsWith(`${path.sep}javascript_global${path.sep}root_map.js`)) {
    const textContent = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    const rewritten = rewriteJavascriptMapContent(textContent, url);
    await fs.writeFile(filePath, rewritten, 'utf8');
    return;
  }

  if (
    contentType.startsWith('text/') ||
    contentType.includes('javascript') ||
    contentType.includes('json') ||
    contentType.includes('xml')
  ) {
    const textContent = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    await fs.writeFile(filePath, textContent, 'utf8');
    return;
  }

  await fs.writeFile(filePath, Buffer.isBuffer(body) ? body : Buffer.from(body));
}

async function downloadAsset(url) {
  if (isPageUrl(url)) {
    queuePage(url, { priority: PAGE_PRIORITIES.discovered });
    return;
  }

  const filePath = getLocalPath(url, { isAsset: true });
  if (await fs.pathExists(filePath)) {
    return;
  }

  await rateLimit();

  try {
    await logAction(`[ASSET] ${url}`);
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const contentType = (response.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('text/html')) {
      queuePage(url, { priority: PAGE_PRIORITIES.discovered });
      queuedAssets.delete(url);
      await logAction(`[WARN] Skipping HTML response in asset queue ${url}`);
      return;
    }

    await writeAssetFile(url, response.data, response.headers);
  } catch (error) {
    queuedAssets.delete(url);
    await logAction(`[WARN] Asset download failed ${url}: ${error.message}`);
  }
}

async function smoothScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let current = 0;
      const step = 320;
      const max = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      const timer = setInterval(() => {
        window.scrollTo({ top: current, behavior: 'instant' });
        current += step;
        if (current >= max + step) {
          clearInterval(timer);
          window.scrollTo({ top: 0, behavior: 'instant' });
          resolve();
        }
      }, 60);
    });
  });
}

async function clickDynamicTargets(page) {
  const handles = await page
    .locator(
      [
        '[data-action="loadMore"]',
        '[data-role="tab"]',
        '[role="tab"]',
        '[data-action="expandTabs"]',
        '[data-action="getChildren"]',
        '[aria-controls]',
        'a[href^="#"]',
      ].join(','),
    )
    .elementHandles();

  const seen = new Set();

  for (const handle of handles) {
    const descriptor = await handle
      .evaluate((node) => ({
        text: (node.textContent || '').trim().slice(0, 80),
        action: node.getAttribute('data-action') || '',
        href: node.getAttribute('href') || '',
        hidden: !(node instanceof HTMLElement) || node.offsetParent === null,
        disabled:
          node instanceof HTMLButtonElement || node instanceof HTMLInputElement
            ? node.disabled
            : node.getAttribute('aria-disabled') === 'true',
      }))
      .catch(() => null);

    if (!descriptor || descriptor.hidden || descriptor.disabled) {
      continue;
    }

    if (descriptor.action === 'dismissTerms' || descriptor.action === 'close') {
      continue;
    }

    const key = `${descriptor.action}|${descriptor.href}|${descriptor.text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    await handle.click({ timeout: 2500 }).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => page.waitForTimeout(800));
  }
}

async function bakeDynamicState(page) {
  await page.waitForTimeout(1500);
  await smoothScroll(page);
  await clickDynamicTargets(page);
  await smoothScroll(page);
}

async function persistResponseAsset(response) {
  const normalized = normalizeRemoteUrl(response.url(), BASE_URL);
  if (!normalized) {
    return;
  }

  const parsed = new URL(normalized);
  const resourceType = response.request().resourceType();
  if (!response.ok() || !TARGET_HOSTS.has(parsed.hostname)) {
    return;
  }

  if (!['stylesheet', 'script', 'image', 'font', 'media'].includes(resourceType)) {
    return;
  }

  const filePath = getLocalPath(normalized, { isAsset: true });
  if (await fs.pathExists(filePath)) {
    return;
  }

  const body = await response.body().catch(() => null);
  if (!body) {
    return;
  }

  await writeAssetFile(normalized, body, response.headers());
}

async function validatePage(page, url) {
  const content = await page.content();
  const errorSignatures = [
    'Internal Server Error',
    'Database Error',
    'Something went wrong',
    'Link to database could not be established',
    '500 Error',
  ];

  if (errorSignatures.some((signature) => content.includes(signature))) {
    throw new Error(`Server error signature detected for ${url}`);
  }
}

async function processPage(url) {
  visitedPages.add(url);

  const filePath = getLocalPath(url);
  if (await fs.pathExists(filePath)) {
    return;
  }

  await rateLimit();

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
  });

  const page = await context.newPage();
  const responseTasks = [];
  page.on('response', (response) => {
    responseTasks.push(
      persistResponseAsset(response).catch((error) =>
        logAction(`[WARN] Failed to persist response asset ${response.url()}: ${error.message}`),
      ),
    );
  });

  try {
    await logAction(`[FETCH] ${url}`);
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT_MS });
    if (!response || !response.ok()) {
      const status = response ? response.status() : 'TIMEOUT';
      if (typeof status === 'number' && status >= 500) {
        await applyServerBackoff(url, `HTTP ${status}`);
      }
      throw new Error(`HTTP ${status}`);
    }

    await validatePage(page, url);
    await bakeDynamicState(page);

    const html = await page.content();
    const rewritten = rewriteHtmlContent(html, url);

    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, rewritten.html, 'utf8');

    config.downloadedCount += 1;
    saveConfig();
    clearServerBackoff();

    rewritten.assetUrls.forEach((assetUrl) => queueAsset(assetUrl, url));
    rewritten.discoveredPageUrls.forEach((pageUrl) =>
      queuePage(pageUrl, { priority: getPagePriority(pageUrl, url) }),
    );

    await logAction(`[SAVED] (${config.downloadedCount}) ${url}`);
  } catch (error) {
    if (/Server error signature detected/i.test(error.message)) {
      await applyServerBackoff(url, 'server error signature');
    }
    await logAction(`[ERROR] ${url}: ${error.message}`);
  } finally {
    await Promise.allSettled(responseTasks);
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

let browser;

function normalizeSeedEntries(rawSeeds) {
  const entries = Array.isArray(rawSeeds) ? rawSeeds : [rawSeeds];
  const seeds = [];
  let skipped = 0;

  for (const entry of entries) {
    if (typeof entry === 'string') {
      seeds.push(entry);
      continue;
    }

    if (!entry || typeof entry !== 'object') {
      skipped += 1;
      continue;
    }

    const url = typeof entry.url === 'string' ? entry.url : null;
    const shouldSkip = entry.disabled || entry.skip || entry.known500 || entry.always500;

    if (!url || shouldSkip) {
      skipped += 1;
      continue;
    }

    seeds.push(url);
  }

  return {
    seeds: seeds.reverse(),
    skipped,
  };
}

async function run() {
  await fs.ensureDir(OUTPUT_DIR);
  await fs.ensureDir(path.dirname(CONFIG_FILE));
  await ensureOfflineSupportFiles();

  const rawSeeds = (await fs.pathExists(SEED_FILE)) ? await fs.readJson(SEED_FILE) : [BASE_URL];
  const { seeds, skipped } = normalizeSeedEntries(rawSeeds);
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  await logAction(`Starting scraper with ${PAGE_CONCURRENCY} workers and ${config.currentJitter}ms jitter.`);
  await logAction(`Loaded ${seeds.length} seeds in reverse order${skipped ? `, skipped ${skipped} flagged/invalid entries` : ''}.`);

  (seeds.length ? seeds : [BASE_URL]).forEach((seedUrl) =>
    queuePage(seedUrl, { priority: PAGE_PRIORITIES.seed }),
  );
  await pageQueue.onIdle();
  await assetQueue.onIdle();

  await logAction('Scrape pass complete.');
  await browser.close();
}

run().catch(async (error) => {
  console.error(`[FATAL] ${error.message}`);
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(1);
});
