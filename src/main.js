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

let config = { downloadedCount: 0, currentJitter: 5000, maxConcurrency: 1 };

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const saved = fs.readJsonSync(CONFIG_FILE);
        config = { ...config, ...saved, maxConcurrency: 1 };
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

async function downloadAsset(page, url) {
    const fs_path = getLocalPath(url);
    if (await fs.pathExists(fs_path)) return;
    try {
        const response = await page.context().request.get(url);
        if (response.ok()) {
            const buffer = await response.body();
            await fs.outputFile(fs_path, buffer);
            
            // If it's CSS, we need to deep-scan it for fonts/images
            if (url.endsWith('.css')) {
                await processCss(page, url, buffer.toString());
            }
        }
    } catch (e) {
        // console.error(`[ASSET FAIL] ${url}: ${e.message}`);
    }
}

async function processCss(page, cssUrl, content) {
    const fontRegex = /url\(['"]?([^'")]+\.(?:woff2|woff|ttf|eot|svg|otf|png|jpg|jpeg|gif)(?:\?[^'")]*)?)['"]?\)/gi;
    let match;
    let newContent = content;
    const assets = [];

    while ((match = fontRegex.exec(content)) !== null) {
        try {
            const assetUrl = new URL(match[1], cssUrl).href;
            if (assetUrl.includes('sikhsangat.com')) {
                assets.push(assetUrl);
                const relPath = path.posix.relative(path.posix.dirname(getLocalPath(cssUrl)), getLocalPath(assetUrl));
                newContent = newContent.replace(match[1], relPath);
            }
        } catch (e) {}
    }

    if (newContent !== content) {
        await fs.outputFile(getLocalPath(cssUrl), newContent);
    }

    // Recursively download discovered assets
    for (const asset of assets) {
        await downloadAsset(page, asset);
    }
}

async function run() {
    await fs.ensureDir(OUTPUT_DIR);
    await fs.ensureDir(path.dirname(CONFIG_FILE));
    
    logAction(`Starting Deep-Fidelity Scraper (Fonts Fix + Modal Scrubbing)...`);

    const browser = await chromium.launch({ headless: true });
    const seeds = await fs.readJson(SEED_FILE);
    
    const mainQueue = new PQueue({ concurrency: 1 });
    const assetQueue = new PQueue({ concurrency: 3 });
    
    let visited = new Set();
    let lastMainFetchTime = 0;

    const fetchTask = async (url, isAsset = false) => {
        if (visited.has(url)) return;
        visited.add(url);

        const fs_path = getLocalPath(url);
        if (await fs.pathExists(fs_path)) return;

        if (!isAsset) {
            const now = Date.now();
            const timeSinceLast = now - lastMainFetchTime;
            if (timeSinceLast < 10000) await new Promise(r => setTimeout(r, 10000 - timeSinceLast));
            lastMainFetchTime = Date.now();
        }

        const page = await browser.newPage();
        try {
            await logAction(`Fetching: ${url}`);
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
            
            if (!response || !response.ok()) throw new Error(`HTTP ${response?.status()}`);

            if (!isAsset) {
                // --- BAKE TABS ---
                await page.evaluate(async () => {
                    const tabs = document.querySelectorAll('[data-role="tab"]');
                    for (const tab of tabs) {
                        tab.click();
                        await new Promise(r => setTimeout(r, 1500));
                    }
                });

                // --- INJECT FIXES (Modals & Fonts) ---
                const html = await page.content();
                const $ = cheerio.load(html);
                
                // 1. Force hide the Registration Trap & Guest Bars
                $('body').append(`
                    <style>
                        /* Hide guest terms bar, registration widgets, and modals by default */
                        #elGuestTerms, [data-blockid*="guestSignUp"], .ipsModal, #elRegisterForm, #elGuestSignIn, .ipsSticky { 
                            display: none !important; 
                        }
                        /* Ensure the site is scrollable even if a modal was "open" during capture */
                        body.ipsModal_open, body.cWithGuestTerms { 
                            overflow: visible !important; 
                            padding-bottom: 0 !important;
                        }
                        /* Fix for the persistent bottom bar */
                        [data-role="guestTermsBar"] { display: none !important; }
                    </style>
                `);

                // 2. Relativize Links & Discovery
                const assetTasks = [];
                $('a, img, link, script').each((i, el) => {
                    const attr = $(el).attr('href') ? 'href' : 'src';
                    const val = $(el).attr(attr);
                    if (val && val.includes('sikhsangat.com')) {
                        try {
                            const full = new URL(val, url).href;
                            const rel = path.posix.relative(path.posix.dirname(fs_path), getLocalPath(full));
                            $(el).attr(attr, rel);
                            
                            if (el.name === 'a' && !val.includes('action=') && !visited.has(full)) {
                                mainQueue.add(() => fetchTask(full, false));
                            } else if (el.name !== 'a') {
                                assetTasks.push(downloadAsset(page, full));
                            }
                        } catch(e) {}
                    }
                });

                await Promise.all(assetTasks);
                await fs.outputFile(fs_path, $.html());
                config.downloadedCount++;
                saveConfig();
                await logAction(`[SAVED] (${config.downloadedCount}) Path: ${url.replace('https://', '')}`);
            } else {
                // Asset handled by downloadAsset if called from elsewhere, 
                // but if it's a direct seed, save it here.
                const buffer = await response.body();
                await fs.outputFile(fs_path, buffer);
                if (url.endsWith('.css')) await processCss(page, url, buffer.toString());
            }
        } catch (err) {
            console.error(`[ERROR] ${url}: ${err.message}`);
        } finally {
            await page.close().catch(() => {});
        }
    };

    for (const url of seeds) {
        mainQueue.add(() => fetchTask(url, false));
    }

    await Promise.all([mainQueue.onIdle(), assetQueue.onIdle()]);
    await browser.close().catch(() => {});
}

run().catch(e => {
    console.error(`[FATAL] ${e.message}`);
    process.exit(1);
});
