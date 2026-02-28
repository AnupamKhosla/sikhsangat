import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'https://www.sikhsangat.com';
const OUTPUT_DIR = path.join(__dirname, 'archive');
const STATE_FILE = path.join(__dirname, 'crawl_state.json');

// --- WGET/HTTRACK STATE MANAGEMENT ---
let state = {
    queue: ['https://www.sikhsangat.com/'], // Start spidering from homepage
    visited: [],
    failed: []
};

// Load previous state to resume interrupted crawls
if (fs.existsSync(STATE_FILE)) {
    try {
        state = fs.readJsonSync(STATE_FILE);
        console.log(`[STATE] Resuming crawl. Queue: ${state.queue.length}, Visited: ${state.visited.length}`);
    } catch (e) {
        console.log("Failed to parse state file, starting fresh.");
    }
}

const saveState = () => fs.writeJsonSync(STATE_FILE, state, { spaces: 2 });
const log = msg => console.log(`[${new Date().toISOString().split('T')[1].slice(0,-1)}] ${msg}`);
const delay = ms => new Promise(r => setTimeout(r, ms));

// --- WGET/HTTRACK LINK CONVERSION ENGINE ---
function convertToRelativePath(sourceUrl, targetUrl) {
    try {
        const source = new URL(sourceUrl);
        const target = new URL(targetUrl, BASE_URL);

        // Don't convert external domains
        if (target.hostname !== new URL(BASE_URL).hostname) return targetUrl;

        // Strip queries/hashes for file paths unless necessary
        let targetPath = target.pathname;
        if (targetPath.endsWith('/')) targetPath += 'index.html';
        else if (!path.extname(targetPath)) targetPath += '/index.html';

        let sourcePath = source.pathname;
        if (sourcePath.endsWith('/')) sourcePath += 'index.html';
        else if (!path.extname(sourcePath)) sourcePath += '/index.html';

        const sourceDir = path.posix.dirname(sourcePath);
        let relativePath = path.posix.relative(sourceDir, targetPath);
        
        if (relativePath === '') relativePath = path.basename(targetPath);
        if (!relativePath.startsWith('.')) relativePath = './' + relativePath;

        return relativePath;
    } catch (e) {
        return targetUrl;
    }
}

async function scrapePage(browser, url) {
    if (state.visited.includes(url)) return;
    
    // Remove from queue, add to visited
    state.queue = state.queue.filter(u => u !== url);
    state.visited.push(url);
    saveState();

    const page = await browser.newPage({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });

    log(`[CRAWL] ${url}`);

    try {
        // --- ASSET MIRRORING (Intercepting network requests like HTTrack) ---
        page.on('response', async (response) => {
            const req = response.request();
            const resUrl = req.url();
            const resourceType = req.resourceType();
            
            // Only capture assets from the same domain
            if (resUrl.startsWith(BASE_URL) && ['stylesheet', 'image', 'font', 'script'].includes(resourceType)) {
                try {
                    const uObj = new URL(resUrl);
                    const localPath = path.join(OUTPUT_DIR, uObj.pathname);
                    if (!fs.existsSync(localPath)) {
                        const buffer = await response.body();
                        await fs.outputFile(localPath, buffer);
                    }
                } catch(e) { /* Ignore asset download failures to not crash crawler */ }
            }
        });

        // Load the page, wait for network to calm down (ensures JS runs)
        await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
        
        const html = await page.content();
        const $ = cheerio.load(html);

        // --- DISCOVERY & LINK REWRITING ---
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (!href) return;

            try {
                const targetObj = new URL(href, BASE_URL);
                const targetHref = targetObj.href.split('#')[0]; // Strip hashes

                // Internal Link Rules
                if (targetObj.hostname === new URL(BASE_URL).hostname) {
                    // Rewrite href to relative local path
                    $(el).attr('href', convertToRelativePath(url, targetHref));

                    // Discovery Rule: Add to queue if it's a valid internal page
                    // Exclude heavy dynamic endpoints
                    const skipPatterns = ['do=', 'sortby=', 'search/', 'login/', 'register/', 'lostpassword/'];
                    const shouldSkip = skipPatterns.some(p => targetHref.includes(p));

                    if (!shouldSkip && !state.visited.includes(targetHref) && !state.queue.includes(targetHref)) {
                        state.queue.push(targetHref);
                    }
                }
            } catch(e) {}
        });

        // Save the modified HTML
        const uO = new URL(url);
        let savePath = path.join(OUTPUT_DIR, uO.pathname);
        if (savePath.endsWith('/')) savePath = path.join(savePath, 'index.html');
        else if (!path.extname(savePath)) savePath = path.join(savePath, 'index.html');

        await fs.outputFile(savePath, $.html());
        log(`[SAVED] ${savePath.replace(OUTPUT_DIR, '')}`);

        // Polite delay mimicking human
        await delay(3000 + Math.random() * 4000);

    } catch (e) {
        log(`[ERROR] Failed ${url}: ${e.message}`);
        state.failed.push({ url, error: e.message });
        saveState();
    } finally {
        await page.close();
    }
}

async function main() {
    await fs.ensureDir(OUTPUT_DIR);
    const browser = await chromium.launch({ headless: true });
    
    log(`Starting Hybrid Crawler. Initial Queue: ${state.queue.length}`);

    // Process the queue iteratively (allows appending to queue during crawl)
    while (state.queue.length > 0) {
        // Take the first URL from the queue
        const currentUrl = state.queue[0];
        await scrapePage(browser, currentUrl);
    }

    log("Crawler finished queue.");
    await browser.close();
}

main().catch(err => log(`[FATAL] ${err.message}`));
