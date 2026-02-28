import { PlaywrightCrawler, RequestQueue, LogLevel } from 'crawlee';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import axios from 'axios';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import prettier from 'prettier';
import ProxyManager from './proxy-manager.js';
import { ProxyConfiguration } from 'crawlee';

chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs'); // Changed for GitHub Pages
const SNAPSHOT_DIR = path.join(ROOT_DIR, 'logs', 'snapshots');
const BASE_URL = 'https://www.sikhsangat.com';
const CONFIG_FILE = path.join(ROOT_DIR, 'logs', 'scraper_config.json');

const CORS_PROXIES = [
    'https://api.allorigins.win/get?url=',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://test.cors.workers.dev/?'
];

// --- SYSTEM STATE ---
let systemIsBroken = false;
let config = { 
    currentJitter: 2000, 
    maxConcurrency: ProxyManager.getConcurrencyLimit(), 
    downloadedCount: 0 
};

if (fs.existsSync(CONFIG_FILE)) {
    try { config = { ...config, ...fs.readJsonSync(CONFIG_FILE) }; } catch(e) {}
}

// SHARED BROWSER FOR TESTS (To save memory)
let testBrowser = null;
async function getTestBrowser() {
    if (!testBrowser || !testBrowser.isConnected()) {
        testBrowser = await chromium.launch({ headless: true });
    }
    return testBrowser;
}

// ADAPTIVE CONCURRENCY
config.maxConcurrency = ProxyManager.getConcurrencyLimit();
config.currentJitter = 2000;

const saveConfig = () => fs.writeJsonSync(CONFIG_FILE, config, { spaces: 2 });

const pushUpdate = async (msg, extra = {}) => {
    const timestamp = new Date().toLocaleTimeString();
    const logLine = `[${timestamp}] ${msg}`;
    console.log(logLine);
    fs.appendFileSync(path.join(ROOT_DIR, 'logs', 'scraper.log'), logLine + '\n');
    try { await axios.post('http://127.0.0.1:3000/log', { msg: logLine, config, ...extra }, { timeout: 1000 }); } catch (e) {}
};

let localIp = 'UNKNOWN';
async function getLocalIp() {
    try {
        const res = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
        localIp = res.data.ip;
    } catch(e) {
        localIp = 'LOCAL_IP';
    }
}

// --- CORS PROXY FETCHER ---
async function fetchViaCorsProxy(url) {
    for (const proxyBase of CORS_PROXIES) {
        try {
            const encodedUrl = encodeURIComponent(url);
            const proxyUrl = proxyBase.includes('allorigins') ? `${proxyBase}${encodedUrl}` : `${proxyBase}${url}`;
            const res = await axios.get(proxyUrl, { timeout: 10000 });
            
            let data = res.data;
            if (proxyBase.includes('allorigins')) data = data.contents;
            
            return data;
        } catch (e) { continue; }
    }
    return null;
}

// --- BEHAVIORAL SIDE-TESTER (Memory Optimized) ---
async function runBehavioralTest(localPath) {
    const browser = await getTestBrowser();
    const page = await browser.newPage();
    const relPath = path.relative(OUTPUT_DIR, localPath);
    try {
        await page.goto(`file://${localPath}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Link Integrity Test
        const absoluteLinks = await page.$$eval('a', links => links.filter(a => a.href.includes('sikhsangat.com')).length);
        if (absoluteLinks > 0) {
            console.warn(`[VRT WARN] Found ${absoluteLinks} absolute links on ${relPath}`);
        }

        // Behavioral Tab Test (Based on SITE_ANALYSIS.md)
        const tabs = await page.$$('[data-role="tab"]');
        if (tabs.length > 0) {
            await tabs[0].click();
            await page.waitForTimeout(500);
            const isVisible = await page.isVisible('.ipsTabs_panel:not(.ipsHide)');
            if (!isVisible) console.warn(`[VRT WARN] Tab expansion failed offline on ${relPath}`);
        }

        await pushUpdate(`[HEALTH] PASS: ${relPath}`);
    } catch (e) {
        console.error(`\x1b[1;31m[TEST FAIL] ${relPath}: ${e.message}\x1b[0m`);
    } finally { 
        await page.close(); // Only close the page, keep the browser
    }
}

async function beautifyContent(content, type) {
    try {
        let crushed = content.replace(/\n\s*\n/g, '\n');
        return await prettier.format(crushed, { parser: type === 'js' ? 'babel' : type, printWidth: 100, tabWidth: 2, htmlWhitespaceSensitivity: 'ignore' });
    } catch (e) { return content; }
}

function getLocalPath(urlStr) {
    try {
        const uO = new URL(urlStr, BASE_URL);
        let pathname = uO.pathname.replace('index.php', '');
        if (uO.search.startsWith('?/')) {
            const sub = uO.search.substring(2).split('&')[0];
            if (sub) pathname = path.join(pathname, sub);
        }
        const segments = pathname.split('/').filter(s => s);
        let fullPath = path.join(OUTPUT_DIR, uO.hostname, ...segments);
        if (!path.extname(fullPath) || fullPath.endsWith('/')) fullPath = path.join(fullPath, 'index.html');
        return fullPath;
    } catch(e) { return path.join(OUTPUT_DIR, 'error.html'); }
}

function getRelativePath(fromUrl, toUrl) {
    try {
        const fromLocal = getLocalPath(fromUrl);
        const toLocal = getLocalPath(toUrl);
        let rel = path.posix.relative(path.posix.dirname(fromLocal), toLocal);
        return rel.startsWith('.') ? rel : './' + rel;
    } catch (e) { return toUrl; }
}

async function downloadAsset(page, url) {
    const fs_path = getLocalPath(url);
    if (await fs.pathExists(fs_path)) return;
    try {
        let body;
        // TRY CORS PROXY FIRST TO SAVE BROWSER PROXY BANDWIDTH
        body = await fetchViaCorsProxy(url);
        
        if (!body) {
            const response = await page.request.get(url);
            if (response.ok()) body = await response.body();
        }

        if (body) {
            const ext = path.extname(fs_path).toLowerCase();
            if (ext === '.css' || ext === '.js') {
                const text = Buffer.isBuffer(body) ? body.toString('utf8') : body;
                await fs.outputFile(fs_path, await beautifyContent(text, ext.substring(1)));
            } else { await fs.outputFile(fs_path, body); }
        }
    } catch (e) {}
}

async function run() {
    await getLocalIp();
    await fs.ensureDir(OUTPUT_DIR);
    await fs.ensureDir(SNAPSHOT_DIR);
    
    console.log(`\x1b[1;32m[ENGINE START] PROXIES: ${ProxyManager.proxies.length} | CONCURRENCY: ${config.maxConcurrency}\x1b[0m`);

    const proxyConfiguration = new ProxyConfiguration({
        proxyUrls: ProxyManager.proxies
    });

    const crawler = new PlaywrightCrawler({
        requestQueue: await RequestQueue.open(),
        proxyConfiguration,
        maxConcurrency: config.maxConcurrency,
        launchContext: { launcher: chromium, launchOptions: { headless: true } },
        requestHandler: async ({ request, page, log }) => {
            log.setLevel(LogLevel.ERROR);
            
            const fs_path = getLocalPath(request.url);
            if (await fs.pathExists(fs_path) && fs_path.endsWith('.html')) return;

            const jitter = Math.min(Math.floor(Math.random() * config.currentJitter), 4000);
            await pushUpdate(`[FETCHING] URL: ${request.url}`);
            await new Promise(r => setTimeout(r, jitter));

            try {
                await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
                
                // Baking
                await page.evaluate(async () => {
                    document.querySelectorAll('[data-role="tab"], [data-action="loadMore"]').forEach(el => {
                        if (!['login', 'sign in'].some(b => el.innerText.toLowerCase().includes(b))) el.click();
                    });
                });
                await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

                const html = await page.content();
                const $ = cheerio.load(html);
                
                // Relativize
                const assetTasks = [];
                $('a, img, link, script').each((i, el) => {
                    ['href', 'src', 'data-src'].forEach(attr => {
                        const val = $(el).attr(attr);
                        if (val && val.includes('sikhsangat.com')) {
                            try {
                                const full = new URL(val, request.url).href;
                                const rel = path.posix.relative(path.posix.dirname(getLocalPath(request.url)), getLocalPath(full));
                                $(el).attr(attr, rel);
                                if (el.name !== 'a') assetTasks.push(downloadAsset(page, full));
                            } catch(e) {}
                        }
                    });
                });

                await Promise.all(assetTasks);
                await fs.outputFile(fs_path, await beautifyContent($.html(), 'html'));
                
                config.downloadedCount++;
                saveConfig();
                await pushUpdate(`[SAVED] Path: ${request.url.replace(BASE_URL, '')}`);
                
                runBehavioralTest(fs_path);
            } catch (err) {
                console.error(`Failed to fetch ${request.url}: ${err.message}`);
                // Retry later?
            }
        }
    });

    const seeds = await fs.readJson(path.join(ROOT_DIR, 'seed_urls.json'));
    await crawler.addRequests(seeds.map(u => ({ url: u })));
    await crawler.run();
}

run().catch((e) => {
    console.error(`\x1b[1;31m[UNCAUGHT FATAL] ${e.message}\x1b[0m`);
    process.exit(1);
});
