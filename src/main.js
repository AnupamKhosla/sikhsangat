import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import axios from 'axios';
import PQueue from 'p-queue';

chromium.use(StealthPlugin());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs');
const SEED_FILE = path.join(ROOT_DIR, 'seed_urls.json');
const CONFIG_FILE = path.join(ROOT_DIR, 'logs', 'scraper_config.json');
const BASE_URL = 'https://www.sikhsangat.com';

// --- SYSTEM STATE ---
let config = { downloadedCount: 0, currentJitter: 2000, maxConcurrency: 2 };

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const saved = fs.readJsonSync(CONFIG_FILE);
        config = { ...config, ...saved };
    } catch(e) {}
}

const logAction = async (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `\x1b[1;34m[${timestamp}] [GOD-MODE] ${msg}\x1b[0m`;
    console.log(logMsg);
    try {
        const cleanMsg = msg.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        await axios.post('http://127.0.0.1:3000/log', { 
            msg: `[${timestamp}] ${cleanMsg}`,
            config: config 
        }, { timeout: 1000 }).catch(() => {});
    } catch(e) {}
};

const saveConfig = () => {
    fs.outputJsonSync(CONFIG_FILE, config, { spaces: 2 });
};

function getLocalPath(urlStr, isAsset = false) {
    try {
        const u = new URL(urlStr);
        let hostname = u.hostname;
        let pathname = u.pathname;
        if (pathname === '/' || pathname === '') pathname = '/index.html';
        if (!isAsset && pathname.includes('index.php') && u.search.startsWith('?/')) {
            const parts = u.search.substring(2).split('&')[0].split('/');
            pathname = parts.join('/');
        }
        let fullPath = path.join(OUTPUT_DIR, hostname, pathname);
        if (!isAsset && (!path.extname(pathname) || pathname.endsWith('/'))) {
            fullPath = path.join(fullPath, 'index.html');
        }
        return fullPath;
    } catch(e) { return path.join(OUTPUT_DIR, 'error.html'); }
}

function getRelativePath(fromUrlStr, toUrlStr, isAsset = false) {
    try {
        const fromLocal = getLocalPath(fromUrlStr, false);
        const toLocal = getLocalPath(toUrlStr, isAsset);
        let rel = path.posix.relative(path.posix.dirname(fromLocal), toLocal);
        if (!rel.startsWith('.')) rel = './' + rel;
        return rel;
    } catch (e) { return toUrlStr; }
}

async function validatePage(page, url) {
    const content = await page.content();
    const errorSigs = ['Internal Server Error', 'Database Error', 'Something went wrong', 'Link to database could not be established', '500 Error'];
    if (errorSigs.some(sig => content.includes(sig))) throw new Error(`Server Error Signature detected`);
    return true;
}

// --- JITTER PROTOCOL: 2 Requests then Wait ---
let lastBatchTime = 0;
let requestsInCurrentBatch = 0;
const BATCH_SIZE = 2;

const rateLimit = async () => {
    if (requestsInCurrentBatch >= BATCH_SIZE) {
        const now = Date.now();
        const timeSinceBatch = now - lastBatchTime;
        if (timeSinceBatch < config.currentJitter) {
            const waitTime = config.currentJitter - timeSinceBatch;
            await new Promise(r => setTimeout(r, waitTime));
        }
        lastBatchTime = Date.now();
        requestsInCurrentBatch = 0;
    }
    requestsInCurrentBatch++;
    if (lastBatchTime === 0) lastBatchTime = Date.now();
};

let consecutive500s = 0;
let queueReversed = false;

async function run() {
    await fs.ensureDir(OUTPUT_DIR);
    await fs.ensureDir(path.dirname(CONFIG_FILE));
    logAction(`Initiating Divine Mirroring Engine (Jitter: ${config.currentJitter}ms | Workers: ${BATCH_SIZE})...`);

    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });
    
    let seeds = fs.existsSync(SEED_FILE) ? await fs.readJson(SEED_FILE) : [BASE_URL];
    
    const mainQueue = new PQueue({ concurrency: BATCH_SIZE });
    let visited = new Set();
    const savedAssets = new Set(); 

    const processUrl = async (url) => {
        if (visited.has(url)) return;
        visited.add(url);
        
        const fs_path = getLocalPath(url, false);
        if (await fs.pathExists(fs_path)) return;

        await rateLimit();

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true
        });
        
        const page = await context.newPage();
        try {
            await logAction(`[FETCHING] IP: LOCAL_IP | URL: ${url}`);
            
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            if (!response || !response.ok()) {
                const status = response ? response.status() : 'TIMEOUT';
                consecutive500s++;
                
                // ULTIMATE FALLBACK: Raw Axios
                try {
                    const rawRes = await axios.get(url, { timeout: 10000 });
                    if (rawRes.status === 200) {
                        const $ = cheerio.load(rawRes.data);
                        $('[src], [href]').each((i, el) => {
                            const attr = $(el).attr('href') ? 'href' : 'src';
                            const val = $(el).attr(attr);
                            if (val && val.includes('sikhsangat.com')) {
                                try {
                                    const full = new URL(val, url).href;
                                    $(el).attr(attr, getRelativePath(url, full, ['img','script','link'].includes(el.name)));
                                } catch(e) {}
                            }
                        });
                        await fs.outputFile(fs_path, $.html());
                        config.downloadedCount++;
                        saveConfig();
                        consecutive500s = 0;
                        await logAction(`\x1b[1;32m[SANCTIFIED-RAW]\x1b[0m (${config.downloadedCount}) ${url}`);
                        return;
                    }
                } catch(e) {}

                await logAction(`\x1b[1;33m[SKIPPED]\x1b[0m HTTP ${status}: ${url}`);

                // REVERSE PROTOCOL
                if (consecutive500s >= 5 && !queueReversed) {
                    await logAction(`[CRITICAL] 5 Consecutive failures. REVERSING QUEUE.`);
                    mainQueue.pause();
                    // This is a simplification; PQueue doesn't easily reverse. 
                    // But we can flip the seed logic for future additions.
                    queueReversed = true;
                    mainQueue.start();
                }
                return;
            }

            consecutive500s = 0;
            await page.evaluate(() => {
                document.querySelectorAll('[data-action="loadMore"], [data-role="tab"]').forEach(el => el.click());
            }).catch(() => {});
            await new Promise(r => setTimeout(r, 1000));

            const html = await page.content();
            const $ = cheerio.load(html);
            $('body').append(`<style>.ipsModal, #elRegisterForm, #elGuestSignIn, .ipsSticky { display: none !important; }</style>`);
            
            $('[src], [href]').each((i, el) => {
                const attr = $(el).attr('href') ? 'href' : 'src';
                const val = $(el).attr(attr);
                if (val && val.includes('sikhsangat.com')) {
                    try {
                        const full = new URL(val, url).href;
                        $(el).attr(attr, getRelativePath(url, full, ['img','script','link'].includes(el.name)));
                        const clean = full.split('#')[0];
                        if (el.name === 'a' && !visited.has(clean)) {
                            if (queueReversed) mainQueue.add(() => processUrl(clean), { priority: 1 });
                            else mainQueue.add(() => processUrl(clean));
                        }
                    } catch(e) {}
                }
            });

            await fs.outputFile(fs_path, $.html());
            config.downloadedCount++;
            saveConfig();
            await logAction(`\x1b[1;32m[SANCTIFIED]\x1b[0m (${config.downloadedCount}) ${url}`);

        } catch (err) {
            await logAction(`\x1b[1;31m[ERROR]\x1b[0m ${url}: ${err.message}`);
        } finally {
            await page.close().catch(() => {});
            await context.close().catch(() => {});
        }
    };

    const runSeeds = queueReversed ? [...seeds].reverse() : seeds;
    for (const url of runSeeds) mainQueue.add(() => processUrl(url));
    await mainQueue.onIdle();
}

run().catch(e => {
    console.error(`[FATAL] ${e.message}`);
    process.exit(1);
});
