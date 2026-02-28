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

let config = { downloadedCount: 0, currentJitter: 4000, maxConcurrency: 3 };

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const saved = fs.readJsonSync(CONFIG_FILE);
        config = { ...config, ...saved, maxConcurrency: 3 };
    } catch(e) {}
}

const logAction = async (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMsg = `\x1b[1;34m[${timestamp}] [FOREGROUND] ${msg}\x1b[0m`;
    console.log(logMsg);
    try {
        await axios.post('http://127.0.0.1:3000/log', { 
            msg: `[${timestamp}] ${msg}`,
            config: config 
        }, { timeout: 1000 });
    } catch(e) {}
};

const saveConfig = () => {
    fs.outputJsonSync(CONFIG_FILE, config, { spaces: 2 });
};

function getLocalPath(url) {
    try {
        const u = new URL(url);
        let hostname = u.hostname;
        let pathname = u.pathname;
        let search = u.search;
        if (pathname === '/' && !search) pathname = '/index.html';
        if (pathname.includes('index.php') && search) {
            let clean = search.replace(/^\?\//, '').replace(/[&?]/g, '_');
            pathname = '/' + clean;
        }
        if (!path.extname(pathname) || pathname.endsWith('/')) {
            pathname = path.join(pathname, 'index.html');
        }
        return path.join(OUTPUT_DIR, hostname, pathname);
    } catch(e) { return path.join(OUTPUT_DIR, 'error.html'); }
}

async function run() {
    await fs.ensureDir(OUTPUT_DIR);
    await fs.ensureDir(path.dirname(CONFIG_FILE));
    
    logAction(`Starting Resilient Scraper (3 Parallel Workers | 120s Timeout | 2s Max Retry Jitter)...`);

    const browser = await chromium.launch({ headless: true });
    const seeds = await fs.readJson(SEED_FILE);
    
    const queue = new PQueue({ concurrency: 3 });
    let visited = new Set();

    const processUrl = async (url) => {
        if (visited.has(url)) return;
        visited.add(url);

        const fs_path = getLocalPath(url);
        if (await fs.pathExists(fs_path)) return;

        // Pre-fetch Jitter (Randomly up to currentJitter config)
        const initialJitter = Math.floor(Math.random() * config.currentJitter);
        if (initialJitter > 0) {
            await new Promise(r => setTimeout(r, initialJitter));
        }

        const page = await browser.newPage();
        let success = false;
        let retries = 0;

        while (!success && retries < 2) {
            try {
                const startTime = Date.now();
                await logAction(`Fetching: ${url} (Try ${retries + 1})`);
                
                const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
                const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);
                
                if (!response || !response.ok()) {
                    const status = response?.status() || 'Unknown';
                    throw new Error(`HTTP ${status} after ${responseTime}s`);
                }

                await logAction(`[OK] ${url} responded in ${responseTime}s`);

                // Baking
                await page.evaluate(() => {
                    document.querySelectorAll('[data-action="loadMore"], [data-role="tab"]').forEach(el => el.click());
                }).catch(() => {});
                
                // Wait for animations/rendering
                await new Promise(r => setTimeout(r, 2000));

                const html = await page.content();
                const $ = cheerio.load(html);
                
                const newLinks = [];
                $('a[href], img[src], link[href], script[src]').each((i, el) => {
                    const attr = $(el).attr('href') ? 'href' : 'src';
                    const val = $(el).attr(attr);
                    if (val && val.includes('sikhsangat.com')) {
                        try {
                            const full = new URL(val, url).href;
                            const local = getLocalPath(full);
                            const rel = path.posix.relative(path.posix.dirname(fs_path), local);
                            $(el).attr(attr, rel);
                            if (el.name === 'a' && !val.includes('action=') && !visited.has(full)) {
                                newLinks.push(full);
                            }
                        } catch(e) {}
                    }
                });

                await fs.outputFile(fs_path, $.html());
                config.downloadedCount++;
                saveConfig();
                await logAction(`[SAVED] (${config.downloadedCount}) Path: ${url.replace('https://', '')}`);
                
                for (const link of newLinks) {
                    queue.add(() => processUrl(link));
                }
                
                success = true;
            } catch (err) {
                retries++;
                const backoff = 2000; // 2s base backoff
                const jitter = Math.floor(Math.random() * 2000); // 2s max jitter as requested
                const totalWait = backoff + jitter;
                
                await logAction(`[RETRYING] ${url} in ${totalWait}ms: ${err.message}`);
                await new Promise(r => setTimeout(r, totalWait));
            }
        }
        
        await page.close().catch(() => {});
    };

    for (const url of seeds) {
        queue.add(() => processUrl(url));
    }

    await queue.onIdle();
    await browser.close().catch(() => {});
    logAction("Mirroring Complete.");
}

run().catch(e => {
    console.error(`[FATAL] ${e.message}`);
    process.exit(1);
});
